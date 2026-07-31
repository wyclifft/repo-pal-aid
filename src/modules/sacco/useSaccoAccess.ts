/**
 * v2.12.0 — Yetu Sacco module access gate.
 *
 * The module is visible only when ALL of these hold:
 *   1. psettings.orgtype === 'S'        (Sacco organization type)
 *   2. psettings.payments_active === 1  (company-level activation)
 *   3. user.can_access_payments === true (per-user permission)
 *
 * When visible, the app runs in "portal mode": only the Sacco portal is
 * reachable and all unrelated modules/navigation are hidden.
 */
import { useAppSettings } from '@/hooks/useAppSettings';
import { useAuth } from '@/contexts/AuthContext';

export const useSaccoAccess = (): {
  isSacco: boolean;
  paymentsActive: boolean;
  canAccessPayments: boolean;
  visible: boolean;
  portalMode: boolean;
} => {
  const { isSacco, paymentsActive } = useAppSettings();
  const { currentUser } = useAuth();
  const canAccessPayments = currentUser?.can_access_payments === true;
  const visible = isSacco && paymentsActive && canAccessPayments;
  return {
    isSacco,
    paymentsActive,
    canAccessPayments,
    visible,
    // Sacco installs are dedicated member portals — nothing else is shown.
    portalMode: isSacco,
  };
};
