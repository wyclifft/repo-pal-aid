/**
 * Merchants service — Farmer Boost Phase 2
 *
 * Officer-managed list of approved input suppliers. Read + upsert only in
 * Phase 2; suspension is an upsert with status='SUSPENDED'. No delete —
 * merchants may have historical ledger rows that must remain resolvable.
 *
 * All requests carry uniquedevcode; the server resolves ccode via
 * approved_devices/devsettings so this client never sees ccode directly.
 *
 * v2.11.1
 */

import { API_CONFIG } from '@/config/api';
import { resilientFetch } from '@/utils/resilientFetch';

const API = `${API_CONFIG.MYSQL_API_URL}/api`;

export type MerchantStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface Merchant {
  /** Phase 3: canonical code column. */
  mercode: string;
  /** @deprecated alias returned by server; use `mercode`. */
  mcode?: string;
  ccode: string;
  name: string;
  kra_pin: string | null;
  phone: string | null;
  till_paybill: string | null;
  bank_name: string | null;
  bank_acc: string | null;
  status: MerchantStatus;
  orgtype?: string;
  updated_at: string;
}

export async function listMerchants(
  uniquedevcode: string,
  opts?: { allCoops?: boolean }
): Promise<Merchant[]> {
  if (!navigator.onLine) return [];
  try {
    const url = new URL(`${API}/boost/merchants`);
    url.searchParams.set('uniquedevcode', uniquedevcode);
    if (opts?.allCoops) url.searchParams.set('all_coops', '1');
    const res = await resilientFetch(url.toString(), { method: 'GET' });
    if (!res.ok) return [];
    const body = await res.json();
    if (!(body?.success && Array.isArray(body?.data))) return [];
    // Normalise: ensure `mercode` is present even on servers that still
    // return the legacy `mcode` field.
    return (body.data as any[]).map((m) => ({
      ...m,
      mercode: m.mercode || m.mcode,
    })) as Merchant[];
  } catch { return []; }
}

export async function upsertMerchant(
  uniquedevcode: string,
  m: Partial<Merchant> & { mercode: string; name: string; ccode?: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await resilientFetch(`${API}/boost/merchants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uniquedevcode, ...m }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      return { ok: false, error: body?.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}

