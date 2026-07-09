/**
 * Boost Ledger client — Farmer Boost Phase 1
 *
 * Read-only in Phase 1. Write paths (DISBURSE, PURCHASE, RECOVER, etc.)
 * land in Phase 2+ once the officer disbursement UI ships.
 *
 * The backing table `boost_ledger` is append-only: corrections are
 * REVERSAL / ADJUST entries, never in-place edits. This client mirrors
 * that contract — no update()/delete() helpers exist here on purpose.
 *
 * v2.11.0
 */

import { API_CONFIG } from '@/config/api';
import { resilientFetch } from '@/utils/resilientFetch';

const API_BASE_URL = `${API_CONFIG.MYSQL_API_URL}/api`;

export type BoostEntryType =
  | 'DISBURSE'
  | 'PURCHASE'
  | 'RECOVER'
  | 'SETTLE'
  | 'ADJUST'
  | 'WRITEOFF'
  | 'REVERSAL';

export interface BoostLedgerEntry {
  id: number;
  ccode: string;
  farmer_id: string;
  entry_type: BoostEntryType;
  amount: number;              // signed
  ref_no: string;
  // Phase 3: server returns both `mercode` (canonical) and `mcode` (alias).
  mercode: string | null;
  mcode: string | null;
  related_transrefno: string | null;
  payout_run_id: string | null;
  reverses_id: number | null;
  device_code: string | null;
  operator: string | null>

  related_transrefno: string | null;
  payout_run_id: string | null;
  reverses_id: number | null;
  device_code: string | null;
  operator: string | null;
  notes: string | null;
  ts: string;
}

/**
 * Fetch ledger entries for one farmer, most recent first. Paginated —
 * callers pass an optional limit (server caps at 500 defensively).
 */
export async function getFarmerLedger(
  farmerId: string,
  uniquedevcode: string,
  limit = 100,
  timeoutMs = 6000
): Promise<BoostLedgerEntry[]> {
  if (!navigator.onLine) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url =
      `${API_BASE_URL}/boost/ledger/${encodeURIComponent(farmerId)}` +
      `?uniquedevcode=${encodeURIComponent(uniquedevcode)}` +
      `&limit=${Math.max(1, Math.min(500, limit))}`;
    const res = await resilientFetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) return [];
    const body = await res.json();
    if (!body?.success || !Array.isArray(body?.data)) return [];
    return body.data as BoostLedgerEntry[];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Summarise a ledger to running balances by entry type. Used by future
 * `/boost/farmer/:id` 360° screen.
 */
export function summariseLedger(entries: BoostLedgerEntry[]) {
  const totals: Record<BoostEntryType, number> = {
    DISBURSE: 0, PURCHASE: 0, RECOVER: 0, SETTLE: 0,
    ADJUST: 0, WRITEOFF: 0, REVERSAL: 0,
  };
  let outstanding = 0;
  for (const e of entries) {
    const amt = Number(e.amount) || 0;
    totals[e.entry_type] = (totals[e.entry_type] || 0) + amt;
    // Outstanding = disbursed + purchased - recovered - writeoff (± adjust/reversal).
    if (e.entry_type === 'DISBURSE' || e.entry_type === 'PURCHASE') outstanding += amt;
    else if (e.entry_type === 'RECOVER' || e.entry_type === 'WRITEOFF') outstanding -= Math.abs(amt);
    else outstanding += amt; // ADJUST/REVERSAL are pre-signed
  }
  return {
    totals,
    outstanding: Math.round(outstanding * 100) / 100,
    count: entries.length,
  };
}

// ============================================================
// v2.11.1 — Phase 2 + 3 write helpers.
// All writes are idempotent server-side via (ccode, ref_no) /
// (ccode, pref_no) uniques. Callers get { ok, error? } and never crash.
// ============================================================

export interface BoostAccountRow {
  farmer_id: string;
  ccode: string;
  credit_limit: number;
  outstanding: number;
  hold_amount: number;
  status: 'INACTIVE' | 'ACTIVE' | 'FROZEN' | 'WRITEOFF';
  score: number | null;
  set_by: string | null;
  notes: string | null;
  updated_at: string;
}

export async function listBoostAccounts(uniquedevcode: string): Promise<BoostAccountRow[]> {
  if (!navigator.onLine) return [];
  try {
    const res = await resilientFetch(
      `${API_BASE_URL}/boost/accounts?uniquedevcode=${encodeURIComponent(uniquedevcode)}`,
      { method: 'GET' }
    );
    if (!res.ok) return [];
    const body = await res.json();
    return body?.success && Array.isArray(body?.data) ? (body.data as BoostAccountRow[]) : [];
  } catch { return []; }
}

export async function setCreditLimit(args: {
  uniquedevcode: string;
  farmer_id: string;
  credit_limit: number;
  operator?: string;
  device_code?: string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await resilientFetch(`${API_BASE_URL}/boost/limit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) return { ok: false, error: body?.error || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e: any) { return { ok: false, error: e?.message || 'Network error' }; }
}

export async function disburseCredit(args: {
  uniquedevcode: string;
  farmer_id: string;
  amount: number;
  ref_no: string;
  operator?: string;
  device_code?: string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string; ledger_id?: number }> {
  try {
    const res = await resilientFetch(`${API_BASE_URL}/boost/disburse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) return { ok: false, error: body?.error || `HTTP ${res.status}` };
    return { ok: true, ledger_id: body?.data?.ledger_id };
  } catch (e: any) { return { ok: false, error: e?.message || 'Network error' }; }
}

export async function postBoostPurchase(args: {
  uniquedevcode: string;
  farmer_id: string;
  mcode: string;
  amount: number;
  pref_no: string;
  items?: Array<{ name: string; qty: number; unit_price: number }>;
  related_transrefno?: string;
  operator?: string;
  device_code?: string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string; ledger_id?: number }> {
  try {
    const res = await resilientFetch(`${API_BASE_URL}/boost/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) return { ok: false, error: body?.error || `HTTP ${res.status}` };
    return { ok: true, ledger_id: body?.data?.ledger_id };
  } catch (e: any) { return { ok: false, error: e?.message || 'Network error' }; }
}

/** Client-side pref_no generator. Mirrors transrefno spirit but distinct namespace. */
export function generatePrefNo(deviceCode: string, clientFetch: number | string): string {
  const seq = Math.floor(Date.now() % 100000000).toString().padStart(8, '0');
  return `BP-${(deviceCode || 'DEV').toUpperCase()}${String(clientFetch || 0)}${seq}`;
}

