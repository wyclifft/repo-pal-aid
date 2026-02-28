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

// Get today's date in YYYY-MM-DD format
export const getTodayDate = (): string => {
  return new Date().toISOString().split('T')[0];
};

export const useSessionBlacklist = (activeSessionTimeFrom?: number) => {
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

    try {
      // 1. Check IndexedDB for unsynced receipts (offline submissions that were submitted but not synced)
      try {
        const unsyncedReceipts = await getUnsyncedReceipts();
        unsyncedReceipts.forEach((r: MilkCollection) => {
          const cleanId = r.farmer_id.replace(/^#/, '').trim();
          const receiptDate = new Date(r.collection_date).toISOString().split('T')[0];
          if (
            farmersWithMultOptZero.has(cleanId) &&
            r.session === sessionType &&
            receiptDate === today
          ) {
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
          for (let i = 0; i < unchecked.length; i += CONCURRENCY) {
            const batch = unchecked.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
              batch.map(async (fId) => {
                const existing = await mysqlApi.milkCollection.getByFarmerSessionDate(
                  fId, sessionType, today, today, deviceFingerprint
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
      console.log(`🚫 Blacklisted ${blacklist.size} farmers for ${sessionType} session:`, Array.from(blacklist));
    } catch (error) {
      console.error('Failed to refresh blacklist:', error);
    } finally {
      setIsLoading(false);
    }
  }, [getSessionType, getUnsyncedReceipts]);

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
