/**
 * v2.11.0 — Local Payments fallback
 *
 * Used only when the backend `/api/payments/*` endpoints are not yet deployed
 * or the device is offline. The authoritative source of truth remains the
 * MySQL `transactions` table joined with the new `payments` table on the
 * server. This fallback is a graceful degradation, NOT a parallel system:
 *
 *   - `computePayableFromLocal()` returns an empty list and logs a warning
 *     so the operator knows the module cannot yet compute payables client-
 *     side. This prevents any risk of the app double-paying or reporting
 *     stale amounts from partial IndexedDB caches.
 *   - `markLocalTransactionsPaid()` is a no-op (backend is the source of
 *     truth for payment_status). The client mock in paymentsApi.ts uses it
 *     as a placeholder; the real backend route updates the transactions
 *     table atomically inside the payment SQL transaction.
 *
 * Once the backend routes are deployed this file continues to exist as a
 * safety net but is never actually invoked (the fetch succeeds and takes
 * precedence).
 */
import type { PayableFarmer, PaymentPeriod } from './paymentsApi';

export async function computePayableFromLocal(
  period: PaymentPeriod
): Promise<PayableFarmer[]> {
  console.warn(
    '[PAY][FALLBACK] Backend /api/payments/payable not available. ' +
    'Local fallback returns empty list to avoid stale/duplicate payments. ' +
    'Deploy the payments backend routes to enable this module. period=', period
  );
  return [];
}

export async function markLocalTransactionsPaid(
  farmerCode: string,
  period: PaymentPeriod,
  paymentReference: string
): Promise<void> {
  // No-op: the backend is the source of truth for payment_status. When the
  // real /api/payments/process route runs, it updates the transactions table
  // inside the same DB transaction as the payments insert.
  console.log('[PAY][FALLBACK] markLocalTransactionsPaid noop', { farmerCode, period, paymentReference });
}
