import { useState, useEffect, useCallback, useRef } from 'react';
import { type Session } from '@/services/mysqlApi';

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
  checkIntervalMs = 60000, // Check every minute
}: UseSessionExpirationOptions): UseSessionExpirationResult => {
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
    if (!sess.datefrom || !sess.dateto) {
      return true; // No date restrictions
    }
    const today = new Date().toISOString().split('T')[0];
    return today >= sess.datefrom && today <= sess.dateto;
  }, []);

  // Check if session is currently active (within time window)
  const isSessionActive = useCallback((sess: Session): boolean => {
    // First check date range
    if (!isDateEnabled(sess)) {
      return false;
    }

    const timeFrom = toHour(sess.time_from);
    const timeTo = toHour(sess.time_to);

    if (timeFrom === null || timeTo === null) {
      return false;
    }

    const now = new Date();
    const currentHour = now.getHours();

    // Handle sessions that span midnight (e.g., 22-6)
    if (timeTo < timeFrom) {
      return currentHour >= timeFrom || currentHour < timeTo;
    }

    return currentHour >= timeFrom && currentHour < timeTo;
  }, [isDateEnabled]);

  // Calculate minutes until session expires
  const calculateExpiresInMinutes = useCallback((sess: Session): number | null => {
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
  }, []);

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
    if (!enabled || !session) {
      setExpiresInMinutes(null);
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

      // Trigger expiration only if session WAS active and is now NOT active
      if (wasActiveRef.current && !currentlyActive) {
        console.log('[SESSION EXPIRATION] Session expired:', session.descript);
        setIsExpired(true);
      }
    };

    // Initial check
    checkExpiration();

    // Set up interval for periodic checks
    const interval = setInterval(checkExpiration, checkIntervalMs);

    return () => clearInterval(interval);
  }, [session, enabled, checkIntervalMs, isSessionActive, calculateExpiresInMinutes]);

  return {
    isExpired,
    expiresInMinutes,
    acknowledgeExpiration,
    resetExpiration,
  };
};
