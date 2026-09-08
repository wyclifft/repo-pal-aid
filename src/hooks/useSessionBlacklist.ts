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

export interface BlacklistDetail {
  route?: string;
  devcode?: string;
  reference_no?: string;
}

export const useSessionBlacklist = (
  activeSessionTimeFrom?: number,
  activeSeasonCode?: string // v2.10.60: SCODE for coffee orgs (e.g. 'S0002')
) => {
  const [blacklistedFarmerIds, setBlacklistedFarmerIds] = useState<Set<string>>(new Set());
  const [blacklistedFarmerDetails, setBlacklistedFarmerDetails] = useState<Map<string, BlacklistDetail>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const { getRecentReceipts } = useIndexedDB();

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
      setBlacklistedFarmerDetails(new Map());
      return;
    }

    setIsLoading(true);
    const blacklist = new Set<string>();
    const detailsMap = new Map<string, BlacklistDetail>();
    const today = getTodayDate();
    const sessionType = getSessionType();
    const coffee = isCoffeeOrg();
    const seasonCode = String(activeSeasonCode || '').trim();
    // v2.10.63: surface the coffee-org SCODE-missing bug instead of failing silently.
    if (coffee && !seasonCode) {
      console.warn('[WARN] Coffee org with empty seasonCode — using date-only fallback for duplicate blacklist');
    }

    try {
      // 1. Check IndexedDB for recent receipts (both synced and unsynced)
      // v2.12.41: Keeps farmers blacklisted even after successful sync/restart while offline.
      try {
        const recentReceipts = await getRecentReceipts();
        recentReceipts.forEach((r: MilkCollection) => {
          const cleanId = String(r.farmer_id || '').replace(/^#/, '').trim();
          // Use local date (not UTC) — prevents EAT midnight rollover false-negatives.
          const receiptDate = r.collection_date
            ? getLocalDateString(new Date(r.collection_date))
            : today;

          if (receiptDate !== today) return;

          let sessionMatches = false;
          if (coffee) {
            // Coffee: compare receipt's season_code (preferred) or session against active SCODE.
            const rCode = String((r as any).season_code || r.session || '').trim();
            if (seasonCode) {
              sessionMatches = rCode === seasonCode;
            } else {
              sessionMatches = true; // date already matched above
            }
          } else {
            // Dairy: AM/PM. Tolerate legacy stamps like 'AM SESSION', 'MORNING', etc.
            const rSession = String(r.session || '').trim().toUpperCase();
            sessionMatches = rSession === sessionType || rSession.includes(sessionType);
          }

          if (sessionMatches) {
            // v2.12.41: Trust multOpt on the record itself if cache is missing/stale
            if (r.multOpt === 0 || farmersWithMultOptZero.has(cleanId)) {
              blacklist.add(cleanId);
              detailsMap.set(cleanId, {
                route: r.route,
                devcode: (r as any).devcode || (r as any).device || localStorage.getItem('devcode') || 'Device',
                reference_no: r.reference_no,
              });
            }
          }
        });
      } catch (e) {
        console.warn('Could not check IndexedDB for blacklist:', e);
      }

      // 2. Check online API if connected (synced submissions)
      // v2.12.40: Use bulk fetch instead of per-farmer loop for better performance
      if (navigator.onLine) {
        try {
          const deviceFingerprint = await generateDeviceFingerprint();
          const apiSession = coffee ? (seasonCode || sessionType) : sessionType;

          const recentCollections = await mysqlApi.milkCollection.getAll({
            session: apiSession,
            dateFrom: today,
            dateTo: today,
            uniquedevcode: deviceFingerprint
          });

          recentCollections.forEach(c => {
            const fId = String(c.farmer_id || '').replace(/^#/, '').trim();
            if (farmersWithMultOptZero.has(fId)) {
              blacklist.add(fId);
              detailsMap.set(fId, {
                route: c.route,
                devcode: c.devcode || 'Device',
                reference_no: c.reference_no,
              });
            }
          });
        } catch (e) {
          console.warn('Online bulk blacklist check failed:', e);
        }
      }

      setBlacklistedFarmerIds(blacklist);
      setBlacklistedFarmerDetails(detailsMap);
      console.log(`🚫 Blacklisted ${blacklist.size} farmers for ${coffee ? `coffee/${seasonCode}` : sessionType} session:`, Array.from(blacklist));
    } catch (error) {
      console.error('Failed to refresh blacklist:', error);
    } finally {
      setIsLoading(false);
    }
  }, [getSessionType, getRecentReceipts, activeSeasonCode]);

  // Add a farmer to the blacklist (called after successful submission, not capture)
  const addToBlacklist = useCallback((farmerId: string, details?: BlacklistDetail) => {
    const cleanId = farmerId.replace(/^#/, '').trim();
    setBlacklistedFarmerIds(prev => new Set([...prev, cleanId]));
    if (details) {
      setBlacklistedFarmerDetails(prev => {
        const next = new Map(prev);
        next.set(cleanId, details);
        return next;
      });
    }
    console.log(`🚫 Added ${cleanId} to session blacklist`, details);
  }, []);

  // Helper to look up blacklist details for a given farmer
  const getBlacklistDetail = useCallback((farmerId: string): BlacklistDetail | null => {
    const cleanId = farmerId.replace(/^#/, '').trim();
    return blacklistedFarmerDetails.get(cleanId) || null;
  }, [blacklistedFarmerDetails]);

  // Check if a farmer is blacklisted
  const isBlacklisted = useCallback((farmerId: string): boolean => {
    const cleanId = farmerId.replace(/^#/, '').trim();
    return blacklistedFarmerIds.has(cleanId);
  }, [blacklistedFarmerIds]);

  // Clear blacklist (e.g., when session changes)
  const clearBlacklist = useCallback(() => {
    setBlacklistedFarmerIds(new Set());
    setBlacklistedFarmerDetails(new Map());
  }, []);

  return {
    blacklistedFarmerIds,
    blacklistedFarmerDetails,
    getBlacklistDetail,
    isBlacklisted,
    addToBlacklist,
    refreshBlacklist,
    clearBlacklist,
    isLoading,
    getSessionType,
  };
};
