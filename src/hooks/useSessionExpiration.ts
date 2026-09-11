import { useState, useEffect, useCallback, useRef } from 'react';
import { type Session } from '@/services/mysqlApi';
import { useAppSettings } from '@/hooks/useAppSettings';

interface UseSessionExpirationOptions {
  session: Session | null;
  enabled?: boolean;
  checkIntervalMs?: number;
}

interface UseSessionExpirationResult {
  isExpired: boolean;
  expiresInMinutes: number | null;
  acknowledgeExpiration: () => void;
  resetExpiration: () => void;
}

/**
 * Hook to monitor session expiration based on time_from/time_to and date range.
 * Triggers when a previously active session's time window expires.
 * Does NOT interfere with data sync operations.
 */
export const useSessionExpiration = ({
  session,
  enabled = true,
  checkIntervalMs = 15000, // Check every 15 seconds
}: UseSessionExpirationOptions): UseSessionExpirationResult => {
  const { isCoffee } = useAppSettings();
  const [isExpired, setIsExpired] = useState(false);
  const [expiresInMinutes, setExpiresInMinutes] = useState<number | null>(null);
  const wasActiveRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

  // Convert time_from/time_to to integer hour
  const toHour = (value: any): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  };

  // Check if session is within its date range
  const isDateEnabled = useCallback((sess: Session): boolean => {
    if (sess.dateEnabled !== undefined) {
      return sess.dateEnabled;
    }
    if (!sess.datefrom) {
      return true; // No date restrictions
    }
    const today = new Date().toISOString().split('T')[0];
    if (isCoffee) {
      // FOR ORGTYPE = C ONLY: allow current AND past seasons (datefrom <= today).
      return sess.datefrom <= today;
    }
    if (!sess.dateto) {
      return true;
    }
    return today >= sess.datefrom && today <= sess.dateto;
  }, [isCoffee]);

  // Check if session is currently active (within time window)
  const isSessionActive = useCallback((sess: Session): boolean => {
    // First check date range
    if (!isDateEnabled(sess)) {
      return false;
    }

    // v2.10.71: Coffee orgs bypass time validation — validation is date-only.
    if (isCoffee) {
      return true;
    }

    const timeFrom = toHour(sess.time_from);
    const timeTo = toHour(sess.time_to);

    // v2.12.6: seasons carry no time window — date validation already passed,
    // so treat them as active instead of expiring them immediately.
    if (timeFrom === null || timeTo === null) {
      return true;
    }


    const now = new Date();
    const currentHour = now.getHours();

    // Handle sessions that span midnight (e.g., 22-6)
    if (timeTo < timeFrom) {
      return currentHour >= timeFrom || currentHour < timeTo;
    }

    return currentHour >= timeFrom && currentHour < timeTo;
  }, [isDateEnabled, isCoffee]);

  // Calculate minutes until session expires
  const calculateExpiresInMinutes = useCallback((sess: Session): number | null => {
    // v2.10.71: Coffee orgs have no time-based expiration.
    if (isCoffee) return null;

    const timeTo = toHour(sess.time_to);
    if (timeTo === null) return null;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinutes = now.getMinutes();

    // If session ends at midnight or later, handle wrap-around
    let hoursUntilExpiry = timeTo - currentHour;
    if (hoursUntilExpiry < 0) {
      hoursUntilExpiry += 24;
    }

    // Convert to minutes and subtract current minutes past the hour
    const minutesUntilExpiry = (hoursUntilExpiry * 60) - currentMinutes;
    return Math.max(0, minutesUntilExpiry);
  }, [isCoffee]);

  // Acknowledge the expiration (dismiss the modal, but session remains expired)
  const acknowledgeExpiration = useCallback(() => {
    setIsExpired(false);
  }, []);

  // Reset expiration state (when user selects a new session)
  const resetExpiration = useCallback(() => {
    setIsExpired(false);
    wasActiveRef.current = false;
    sessionIdRef.current = null;
  }, []);

  // Monitor session for expiration
  useEffect(() => {
    if (isCoffee || !enabled || !session) {
      setExpiresInMinutes(null);
      setIsExpired(false);
      return;
    }

    const sessionKey = session.id ? String(session.id) : session.descript;

    // If session changed, reset tracking
    if (sessionIdRef.current !== sessionKey) {
      sessionIdRef.current = sessionKey;
      wasActiveRef.current = false;
      setIsExpired(false);
    }

    const checkExpiration = () => {
      const currentlyActive = isSessionActive(session);

      // Track if session was ever active
      if (currentlyActive && !wasActiveRef.current) {
        wasActiveRef.current = true;
      }

      // Calculate time until expiration
      if (currentlyActive) {
        const minutes = calculateExpiresInMinutes(session);
        setExpiresInMinutes(minutes);
      } else {
        setExpiresInMinutes(null);
      }

      // Trigger expiration if enabled and the active session is no longer active for current time
      if (!currentlyActive) {
        console.log('[SESSION EXPIRATION] Session expired/inactive:', session.descript);
        setIsExpired(true);
      }
    };

    // Initial check
    checkExpiration();

    // Set up interval for periodic checks (default 15s)
    const interval = setInterval(checkExpiration, checkIntervalMs);

    // Event listeners for app visibility & focus changes (app resume)
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' || document.hasFocus()) {
        console.log('[SESSION EXPIRATION] App resumed/focused — re-checking session expiry');
        checkExpiration();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    // Capacitor App state change listener (native android app resume)
    let appStateListener: any = null;
    import('@capacitor/app').then(({ App }) => {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          console.log('[SESSION EXPIRATION] Native app state active — re-checking session expiry');
          checkExpiration();
        }
      }).then(listener => {
        appStateListener = listener;
      }).catch(err => {
        console.warn('[SESSION EXPIRATION] Capacitor App listener error:', err);
      });
    }).catch(() => {
      // Not on native platform or plugin unavailable
    });

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      if (appStateListener && typeof appStateListener.remove === 'function') {
        appStateListener.remove();
      }
    };
  }, [session, enabled, checkIntervalMs, isSessionActive, calculateExpiresInMinutes]);

  return {
    isExpired,
    expiresInMinutes,
    acknowledgeExpiration,
    resetExpiration,
  };
};
