import { useState, useEffect, useCallback } from 'react';
import { useIndexedDB } from './useIndexedDB';
import { mysqlApi } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { type MilkCollection } from '@/lib/supabase';

interface BlacklistEntry {
  farmerId: string;
  session: 'AM' | 'PM';
  date: string; // YYYY-MM-DD
}

// Get current session type based on time (before 12:00 = AM, after = PM)
export const getCurrentSessionType = (): 'AM' | 'PM' => {
  const hour = new Date().getHours();
  return hour < 12 ? 'AM' : 'PM';
};

// v2.10.60: local-date helper (YYYY-MM-DD) per timezone-date-integrity-standard.
// Replaces toISOString().split('T')[0] which shifts dates in EAT around midnight.
const getLocalDateString = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// Get today's date in YYYY-MM-DD format (local time)
export const getTodayDate = (): string => {
  return getLocalDateString(new Date());
};

// v2.10.60: Org-type detection from cached app_settings
const isCoffeeOrg = (): boolean => {
  try {
    const cached = localStorage.getItem('app_settings');
    if (!cached) return false;
    const s = JSON.parse(cached);
    return s?.orgtype === 'C';
  } catch {
    return false;
  }
};

export const useSessionBlacklist = (
  activeSessionTimeFrom?: number,
  activeSeasonCode?: string // v2.10.60: SCODE for coffee orgs (e.g. 'S0002')
) => {
  const [blacklistedFarmerIds, setBlacklistedFarmerIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const { getUnsyncedReceipts } = useIndexedDB();

  // Derive session from activeSession's time_from if provided, otherwise use current time
  const getSessionType = useCallback((): 'AM' | 'PM' => {
    if (activeSessionTimeFrom !== undefined) {
      // Some backends store session time_from as HHMM (e.g., 600, 1400) while others store hour (e.g., 6, 14).
      // Normalize to an hour before deciding AM/PM to avoid false PM classification.
      const hour = activeSessionTimeFrom >= 100
        ? Math.floor(activeSessionTimeFrom / 100)
        : activeSessionTimeFrom;
      return hour >= 12 ? 'PM' : 'AM';
    }
    return getCurrentSessionType();
  }, [activeSessionTimeFrom]);

  // Build blacklist from IndexedDB (unsynced submissions) and online API (synced submissions)
  // NOTE: We do NOT check capturedCollections - blacklisting only applies AFTER successful submission
  const refreshBlacklist = useCallback(async (
    _capturedCollections: MilkCollection[], // Ignored - kept for backwards compatibility
    farmersWithMultOptZero: Set<string>
  ) => {
    if (farmersWithMultOptZero.size === 0) {
      setBlacklistedFarmerIds(new Set());
      return;
    }

    setIsLoading(true);
    const blacklist = new Set<string>();
    const today = getTodayDate();
    const sessionType = getSessionType();
    const coffee = isCoffeeOrg();
    const seasonCode = String(activeSeasonCode || '').trim();

    try {
      // 1. Check IndexedDB for unsynced receipts (offline submissions that were submitted but not synced)
      // v2.10.60: Org-aware session matching — fixes coffee blind-spot and dairy 'AM SESSION' legacy stamps.
      try {
        const unsyncedReceipts = await getUnsyncedReceipts();
        unsyncedReceipts.forEach((r: MilkCollection) => {
          const cleanId = String(r.farmer_id || '').replace(/^#/, '').trim();
          // Use local date (not UTC) — prevents EAT midnight rollover false-negatives.
          const receiptDate = r.collection_date
            ? getLocalDateString(new Date(r.collection_date))
            : today;

          if (!farmersWithMultOptZero.has(cleanId)) return;
          if (receiptDate !== today) return;

          let sessionMatches = false;
          if (coffee) {
            // Coffee: compare receipt's season_code (preferred) or session against active SCODE.
            const rCode = String((r as any).season_code || r.session || '').trim();
            sessionMatches = !!seasonCode && rCode === seasonCode;
          } else {
            // Dairy: AM/PM. Tolerate legacy stamps like 'AM SESSION', 'MORNING', etc.
            const rSession = String(r.session || '').trim().toUpperCase();
            sessionMatches = rSession === sessionType || rSession.includes(sessionType);
          }

          if (sessionMatches) {
            blacklist.add(cleanId);
          }
        });
      } catch (e) {
        console.warn('Could not check IndexedDB for blacklist:', e);
      }

      // 2. Check online API if connected (synced submissions)
      if (navigator.onLine) {
        try {
          const deviceFingerprint = await generateDeviceFingerprint();
          
          // Batch check multOpt=0 farmers with concurrency limit
          const unchecked = Array.from(farmersWithMultOptZero).filter(id => !blacklist.has(id));
          const CONCURRENCY = 5;
          // For coffee, the backend session value is the SCODE; for dairy it's AM/PM.
          const apiSession = coffee ? (seasonCode || sessionType) : sessionType;
          for (let i = 0; i < unchecked.length; i += CONCURRENCY) {
            const batch = unchecked.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
              batch.map(async (fId) => {
                const existing = await mysqlApi.milkCollection.getByFarmerSessionDate(
                  fId, apiSession, today, today, deviceFingerprint
                );
                if (existing) blacklist.add(fId);
              })
            );
          }
        } catch (e) {
          console.warn('Online blacklist check failed:', e);
        }
      }

      setBlacklistedFarmerIds(blacklist);
      console.log(`🚫 Blacklisted ${blacklist.size} farmers for ${coffee ? `coffee/${seasonCode}` : sessionType} session:`, Array.from(blacklist));
    } catch (error) {
      console.error('Failed to refresh blacklist:', error);
    } finally {
      setIsLoading(false);
    }
  }, [getSessionType, getUnsyncedReceipts, activeSeasonCode]);

  // Add a farmer to the blacklist (called after successful submission, not capture)
  const addToBlacklist = useCallback((farmerId: string) => {
    const cleanId = farmerId.replace(/^#/, '').trim();
    setBlacklistedFarmerIds(prev => new Set([...prev, cleanId]));
    console.log(`🚫 Added ${cleanId} to session blacklist`);
  }, []);

  // Check if a farmer is blacklisted
  const isBlacklisted = useCallback((farmerId: string): boolean => {
    const cleanId = farmerId.replace(/^#/, '').trim();
    return blacklistedFarmerIds.has(cleanId);
  }, [blacklistedFarmerIds]);

  // Clear blacklist (e.g., when session changes)
  const clearBlacklist = useCallback(() => {
    setBlacklistedFarmerIds(new Set());
  }, []);

  return {
    blacklistedFarmerIds,
    isBlacklisted,
    addToBlacklist,
    refreshBlacklist,
    clearBlacklist,
    isLoading,
    getSessionType,
  };
};
