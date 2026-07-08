/**
 * Credit Engine — Farmer Boost Phase 1
 *
 * Pure client-side helpers around the /api/boost/* backend endpoints.
 * NO IndexedDB writes, NO UI side-effects in Phase 1 — this is a thin
 * scaffold consumed by future Phase 2/3 screens.
 *
 * Feature gate: every consumer MUST check isBoostEnabled(ccode) before
 * rendering UI. Backend endpoints are safe to call regardless (they
 * return 200 with disabled=true), but we short-circuit on the client
 * to avoid unnecessary network calls when the coop hasn't opted in.
 *
 * v2.11.0
 */

import { API_CONFIG } from '@/config/api';
import { resilientFetch } from '@/utils/resilientFetch';

const API_BASE_URL = `${API_CONFIG.MYSQL_API_URL}/api`;

export interface BoostAccount {
  farmer_id: string;
  ccode: string;
  credit_limit: number;
  outstanding: number;
  hold_amount: number;
  available: number; // credit_limit - outstanding - hold_amount
  status: 'INACTIVE' | 'ACTIVE' | 'FROZEN' | 'WRITEOFF';
  score: number | null;
  updated_at: string;
}

export interface BoostPolicy {
  ccode: string;
  boost_enabled: boolean;
  recovery_cap_pct: number;
  limit_mode: 'MANUAL' | 'AUTO_90D' | 'AUTO_SEASON' | 'HYBRID';
}

/**
 * Fetch a single farmer's boost account. Returns null when offline
 * or the endpoint is unreachable — callers must degrade gracefully.
 */
export async function getBoostAccount(
  farmerId: string,
  uniquedevcode: string,
  timeoutMs = 4000
): Promise<BoostAccount | null> {
  if (!navigator.onLine) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${API_BASE_URL}/boost/account/${encodeURIComponent(farmerId)}?uniquedevcode=${encodeURIComponent(uniquedevcode)}`;
    const res = await resilientFetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.success || !body?.data) return null;
    const d = body.data;
    return {
      ...d,
      available: Math.max(0, Number(d.credit_limit) - Number(d.outstanding) - Number(d.hold_amount)),
    } as BoostAccount;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the coop's boost policy (feature flag + recovery cap + limit mode).
 * Safe to poll; server-side caching should be added when call volume grows.
 */
export async function getBoostPolicy(
  uniquedevcode: string,
  timeoutMs = 4000
): Promise<BoostPolicy | null> {
  if (!navigator.onLine) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${API_BASE_URL}/boost/policy?uniquedevcode=${encodeURIComponent(uniquedevcode)}`;
    const res = await resilientFetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.success || !body?.data) return null;
    return body.data as BoostPolicy;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compute recovery for a single farmer payout line. Server-authoritative
 * copy of this same formula lives in the Payout Engine (Phase 4). We keep
 * a client-side mirror here so Preview screens can show the same numbers
 * without a round-trip per farmer.
 *
 *   recovered = min(outstanding, gross * cap_pct / 100)
 *   net       = gross - recovered
 */
export function computeRecovery(
  gross: number,
  outstanding: number,
  recoveryCapPct: number
): { recovered: number; net: number } {
  const g = Math.max(0, Number(gross) || 0);
  const o = Math.max(0, Number(outstanding) || 0);
  const cap = Math.max(0, Math.min(100, Number(recoveryCapPct) || 0));
  const maxRecoverable = (g * cap) / 100;
  const recovered = Math.min(o, maxRecoverable);
  const net = Math.max(0, g - recovered);
  // Round to 2dp defensively — matches server-side DECIMAL(12,2).
  return {
    recovered: Math.round(recovered * 100) / 100,
    net: Math.round(net * 100) / 100,
  };
}

/**
 * Feature-flag check. Cached at the module level for the session so we
 * don't hammer the backend during renders. First failure = disabled.
 */
let _cachedFlag: { ccode: string; enabled: boolean; ts: number } | null = null;
const FLAG_TTL_MS = 5 * 60 * 1000;

export async function isBoostEnabled(uniquedevcode: string): Promise<boolean> {
  const now = Date.now();
  if (_cachedFlag && now - _cachedFlag.ts < FLAG_TTL_MS) {
    return _cachedFlag.enabled;
  }
  const policy = await getBoostPolicy(uniquedevcode);
  const enabled = !!policy?.boost_enabled;
  _cachedFlag = { ccode: policy?.ccode || '', enabled, ts: now };
  return enabled;
}

export function clearBoostFlagCache() {
  _cachedFlag = null;
}
