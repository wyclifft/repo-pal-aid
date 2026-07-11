/**
 * v2.11.0 — Payments API service (client)
 *
 * Talks to the additive backend endpoints:
 *   GET  /api/payments/payable?period=day|week|month|season
 *   POST /api/payments/process    { farmer_codes: string[], period: string }
 *   GET  /api/payments/history?farmer_code=&from=&to=
 *
 * The backend routes call services/saccoPaymentService.js which is a mock
 * today and will be swapped for the real SACCO API without any client change.
 *
 * If the backend endpoint is not yet deployed (404) or the device is offline,
 * `getPayable()` transparently falls back to a client-side computation over
 * the local transactions cache so the module remains usable during rollout.
 */
import { API_CONFIG } from '@/config/api';
import { resilientFetch } from '@/utils/resilientFetch';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { computePayableFromLocal, markLocalTransactionsPaid } from './localPaymentsFallback';

const BASE = `${API_CONFIG.MYSQL_API_URL}/api/payments`;

export type PaymentPeriod = 'day' | 'week' | 'month' | 'season';

export interface PayableFarmer {
  farmer_code: string;
  farmer_name: string;
  total_payable: number;
  unpaid_count: number;
  payment_status: 'unpaid' | 'partial';
}

export interface PaymentResult {
  farmer_code: string;
  payment_reference: string;
  amount: number;
  status: 'success' | 'failed' | 'pending';
  external_transaction_id?: string;
  error?: string;
}

export interface PaymentHistoryEntry {
  payment_id: number | string;
  payment_reference: string;
  farmer_code: string;
  amount: number;
  status: 'pending' | 'success' | 'failed';
  payment_date: string;
  external_transaction_id?: string | null;
}

export interface PaymentAccessIdentity {
  userid: string;
}

async function safeJson(res: Response) {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
}

async function paymentAccessParams(identity: PaymentAccessIdentity): Promise<URLSearchParams> {
  const deviceFingerprint = await generateDeviceFingerprint();
  const params = new URLSearchParams();
  params.set('uniquedevcode', deviceFingerprint);
  params.set('userid', identity.userid);
  return params;
}

export async function getPayable(period: PaymentPeriod, identity: PaymentAccessIdentity): Promise<PayableFarmer[]> {
  console.log('[PAY][PAYABLE] period=', period);
  if (navigator.onLine) {
    try {
      const params = await paymentAccessParams(identity);
      params.set('period', period);
      const res = await resilientFetch(`${BASE}/payable?${params.toString()}`, { method: 'GET' });
      if (res.ok) {
        const body = await safeJson(res);
        if (body?.success && Array.isArray(body.data)) return body.data as PayableFarmer[];
      }
      if (res.status === 404) {
        console.warn('[PAY][PAYABLE] backend endpoint 404 — falling back to local cache');
      }
    } catch (e) {
      console.warn('[PAY][PAYABLE] backend call failed, using local fallback', e);
    }
  }
  return computePayableFromLocal(period);
}

export async function processPayments(
  farmerCodes: string[],
  period: PaymentPeriod,
  identity: PaymentAccessIdentity
): Promise<PaymentResult[]> {
  console.log('[PAY][PROCESS] farmers=', farmerCodes.length, 'period=', period);
  if (!navigator.onLine) {
    throw new Error('Payments require an internet connection.');
  }
  try {
    const deviceFingerprint = await generateDeviceFingerprint();
    const res = await resilientFetch(`${BASE}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        farmer_codes: farmerCodes,
        period,
        device_fingerprint: deviceFingerprint,
        userid: identity.userid,
      }),
    });
    if (res.ok) {
      const body = await safeJson(res);
      if (body?.success && Array.isArray(body.data)) {
        return body.data as PaymentResult[];
      }
      throw new Error(body?.error || 'Payment failed');
    }
    if (res.status === 404) {
      // Backend not deployed yet — use the CLIENT mock so the workflow is
      // exercisable end-to-end during rollout. The swap point is the backend
      // service; the client contract does not change.
      console.warn('[PAY][SACCO:MOCK] backend endpoint 404 — running client-side mock');
      return runClientSideMock(farmerCodes, period);
    }
    const body = await safeJson(res);
    throw new Error(body?.error || `Payment failed (HTTP ${res.status})`);
  } catch (e: any) {
    if (e?.message?.includes('internet')) throw e;
    // Any transport error while online: also run the mock, but ONLY if the
    // user opted in via the mock env flag. Otherwise surface the error.
    if ((import.meta as any).env?.VITE_PAYMENTS_MOCK === '1') {
      console.warn('[PAY][SACCO:MOCK] transport error — client mock via env flag', e);
      return runClientSideMock(farmerCodes, period);
    }
    throw e;
  }
}

export async function getHistory(
  farmerCode?: string,
  from?: string,
  to?: string,
  identity?: PaymentAccessIdentity
): Promise<PaymentHistoryEntry[]> {
  if (!navigator.onLine) return [];
  if (!identity?.userid) return [];
  const params = await paymentAccessParams(identity);
  if (farmerCode) params.set('farmer_code', farmerCode);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  try {
    const res = await resilientFetch(`${BASE}/history?${params.toString()}`, { method: 'GET' });
    if (!res.ok) return [];
    const body = await safeJson(res);
    return body?.success && Array.isArray(body.data) ? (body.data as PaymentHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

// ── Client-side mock (fallback until backend endpoints are deployed) ─────────
async function runClientSideMock(
  farmerCodes: string[],
  period: PaymentPeriod
): Promise<PaymentResult[]> {
  const payable = await computePayableFromLocal(period);
  const byCode = new Map<string, PayableFarmer>(payable.map(p => [p.farmer_code, p]));
  const results: PaymentResult[] = [];
  const yymmdd = new Date().toISOString().slice(2, 10).replace(/-/g, '');

  for (let i = 0; i < farmerCodes.length; i++) {
    const code = farmerCodes[i];
    const row = byCode.get(code);
    if (!row) {
      results.push({
        farmer_code: code,
        payment_reference: '',
        amount: 0,
        status: 'failed',
        error: 'No unpaid transactions for selected period',
      });
      continue;
    }
    // Simulate SACCO latency
    await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
    const ref = `PMT-MOCK-${yymmdd}-${String(Date.now()).slice(-6)}-${i + 1}`;
    const extId = `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    try {
      await markLocalTransactionsPaid(code, period, ref);
      results.push({
        farmer_code: code,
        payment_reference: ref,
        amount: row.total_payable,
        status: 'success',
        external_transaction_id: extId,
      });
      console.log('[PAY][SACCO:MOCK] success farmer=', code, 'ref=', ref, 'amount=', row.total_payable);
    } catch (e: any) {
      results.push({
        farmer_code: code,
        payment_reference: ref,
        amount: row.total_payable,
        status: 'failed',
        error: e?.message || 'Local update failed',
      });
    }
  }
  return results;
}
