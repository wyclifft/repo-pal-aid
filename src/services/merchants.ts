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
  mcode: string;
  ccode: string;
  name: string;
  kra_pin: string | null;
  phone: string | null;
  till_paybill: string | null;
  bank_name: string | null;
  bank_acc: string | null;
  status: MerchantStatus;
  updated_at: string;
}

export async function listMerchants(uniquedevcode: string): Promise<Merchant[]> {
  if (!navigator.onLine) return [];
  try {
    const res = await resilientFetch(
      `${API}/boost/merchants?uniquedevcode=${encodeURIComponent(uniquedevcode)}`,
      { method: 'GET' }
    );
    if (!res.ok) return [];
    const body = await res.json();
    return body?.success && Array.isArray(body?.data) ? (body.data as Merchant[]) : [];
  } catch { return []; }
}

export async function upsertMerchant(
  uniquedevcode: string,
  m: Partial<Merchant> & { mcode: string; name: string }
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
