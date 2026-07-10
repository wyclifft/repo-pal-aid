/**
 * v2.11.0 — Payments module access gate
 *
 * Payments menu + route are visible only when BOTH:
 *   1. psettings.payments_active === 1 (company-level flag)
 *   2. users.can_access_payments === true (per-user permission)
 *
 * Either flag missing/0 → module hidden entirely (no menu, no route).
 * Deep-link `/payments` is redirected to the dashboard by the route guard.
 */
import { useAppSettings } from '@/hooks/useAppSettings';
import { useAuth } from '@/contexts/AuthContext';

export const usePaymentsAccess = (): {
  paymentsActive: boolean;
  canAccessPayments: boolean;
  visible: boolean;
} => {
  const { paymentsActive } = useAppSettings();
  const { currentUser } = useAuth();
  const canAccessPayments = currentUser?.can_access_payments === true;
  return {
    paymentsActive,
    canAccessPayments,
    visible: paymentsActive && canAccessPayments,
  };
};
