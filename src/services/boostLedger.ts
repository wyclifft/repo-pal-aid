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
  mcode: string | null;
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
