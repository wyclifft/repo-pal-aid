import { useState, useEffect, useCallback, useRef } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useSyncManager, deduplicateReceipts } from '@/hooks/useSyncManager';
import { mysqlApi } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { toast } from 'sonner';

// Get offlineFirstMode from localStorage (cached from useAppSettings)
const getOfflineFirstMode = (): boolean => {
  try {
    const cached = localStorage.getItem('app_settings');
    if (cached) {
      const settings = JSON.parse(cached);
      return settings.online === 1; // online=1 means offline-first mode
    }
  } catch (e) {
    console.warn('Failed to read offline mode setting:', e);
  }
  return false; // Default to background sync
};

export const useDataSync = () => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  // Member sync state for banner display
  const [isSyncingMembers, setIsSyncingMembers] = useState(false);
  const [memberSyncCount, setMemberSyncCount] = useState(0);
  // Offline-first mode from psettings.online
  const [offlineFirstMode, setOfflineFirstMode] = useState(getOfflineFirstMode);
  const mountedRef = useRef(true);
  const periodicSyncRef = useRef<NodeJS.Timeout | null>(null);
  const syncInProgressRef = useRef(false); // Extra guard against concurrent syncs
  
  const { 
    saveFarmers, 
    saveItems, 
    saveZReport, 
    savePeriodicReport,
    saveRoutes,
    saveSessions,
    getUnsyncedReceipts,
    deleteReceipt,
    isReady 
  } = useIndexedDB();

  const { acquireLock, releaseLock, registerOnlineHandler } = useSyncManager();

  // Update offlineFirstMode when settings change
  useEffect(() => {
    const checkSettings = () => {
      if (mountedRef.current) {
        setOfflineFirstMode(getOfflineFirstMode());
      }
    };
    
    // Check on mount and when storage changes
    checkSettings();
    window.addEventListener('storage', checkSettings);
    return () => window.removeEventListener('storage', checkSettings);
  }, []);

  // Sync offline receipts TO backend with deduplication
  // In offline-first mode (online=1), this is only triggered manually or on explicit sync
  // In background sync mode (online=0), this runs automatically
  const syncOfflineReceipts = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (!isReady || !navigator.onLine) {
      console.log('[SYNC] Sync skipped: not ready or offline');
      return { synced: 0, failed: 0 };
    }

    try {
      const rawReceipts = await getUnsyncedReceipts();
      
      // Filter out invalid entries (like PRINTED_RECEIPTS storage)
      const validReceipts = rawReceipts.filter((r: any) => {
        // Skip non-receipt entries
        if (r.orderId === 'PRINTED_RECEIPTS') return false;
        // Skip sale records
        if (r.type === 'sale') return false;
        // Must have required fields
        if (!r.reference_no || !r.farmer_id || !r.weight) return false;
        return true;
      });
      
      // Deduplicate
      const unsyncedReceipts = deduplicateReceipts(validReceipts);
      
      if (unsyncedReceipts.length === 0) {
        if (mountedRef.current) {
          setPendingCount(0);
        }
        console.log('[SYNC] No pending receipts to sync');
        return { synced: 0, failed: 0 };
      }

      console.log(`[SYNC] Syncing ${unsyncedReceipts.length} offline receipts...`);
      
      // Dispatch sync start event
      window.dispatchEvent(new CustomEvent('syncStart'));
      
      let synced = 0;
      let failed = 0;

      const deviceFingerprint = await generateDeviceFingerprint();
      
      for (const receipt of unsyncedReceipts) {
        if (!mountedRef.current) break; // Stop if unmounted

        try {
          console.log(`[SYNC] Attempting to sync: ${receipt.reference_no}`);

          // Normalize session to AM/PM - handle legacy data that might have description
          let normalizedSession: 'AM' | 'PM' = 'AM';
          const sessionVal = String(receipt.session || '').trim().toUpperCase();
          if (sessionVal === 'PM' || sessionVal.includes('PM') || sessionVal.includes('EVENING') || sessionVal.includes('AFTERNOON')) {
            normalizedSession = 'PM';
          }

          // Client-side FINAL GUARD for multOpt=0 during background sync
          if (receipt.multOpt === 0) {
            const receiptDate = new Date(receipt.collection_date).toISOString().split('T')[0];
            try {
              const existing = await mysqlApi.milkCollection.getByFarmerSessionDate(
                String(receipt.farmer_id || '').replace(/^#/, '').trim(),
                normalizedSession,
                receiptDate,
                receiptDate,
                deviceFingerprint
              );

              if (existing) {
                console.log(`[SKIP] Skipping multOpt=0 duplicate (already exists): ${receipt.reference_no}`);
                if (receipt.orderId && typeof receipt.orderId === 'number') {
                  await deleteReceipt(receipt.orderId);
                }
                synced++;
                continue;
              }
            } catch (checkErr) {
              console.warn('[SYNC] Duplicate check failed, proceeding with sync:', checkErr);
            }
          }

          const result = await mysqlApi.milkCollection.create({
            reference_no: receipt.reference_no,
            uploadrefno: receipt.uploadrefno, // Include milkId for approval workflow
            farmer_id: String(receipt.farmer_id || '').replace(/^#/, '').trim(),
            farmer_name: String(receipt.farmer_name || '').trim(),
            route: String(receipt.route || '').trim(),
            session: normalizedSession,
            weight: receipt.weight,
            user_id: receipt.user_id, // Login user_id for DB userId column
            clerk_name: receipt.clerk_name, // Display name for clerk column
            collection_date: receipt.collection_date,
            device_fingerprint: deviceFingerprint,
            entry_type: receipt.entry_type, // Pass entry_type to backend
            product_code: receipt.product_code, // Pass selected product icode
            season: receipt.season, // Pass season for coffee orgtypes (saved to CAN column)
          });

          console.log(`[API] Response for ${receipt.reference_no}:`, result);

          // Check if sync was successful - API returns { success: true/false, reference_no: string }
          if (result.success) {
            if (receipt.orderId && typeof receipt.orderId === 'number') {
              await deleteReceipt(receipt.orderId);
              console.log(`[DB] Deleted local receipt: ${receipt.orderId}`);
            }
            synced++;
            console.log(`[SUCCESS] Synced successfully: ${receipt.reference_no}`);
          } else {
            failed++;
            console.warn(`[WARN] Sync failed for: ${receipt.reference_no}`, result);
          }
        } catch (err: any) {
          console.error(`[ERROR] Exception syncing ${receipt.reference_no}:`, err);
          
          // Check if it's a duplicate error (already exists in DB)
          const errorMsg = err?.message?.toLowerCase() || '';
          if (errorMsg.includes('duplicate') || errorMsg.includes('already exists') || errorMsg.includes('unique')) {
            console.log(`[SKIP] Already synced (duplicate): ${receipt.reference_no}`);
            if (receipt.orderId && typeof receipt.orderId === 'number') {
              await deleteReceipt(receipt.orderId);
            }
            synced++;
          } else {
            failed++;
          }
        }
      }
      
      // Dispatch sync complete event
      window.dispatchEvent(new CustomEvent('syncComplete'));

      if (mountedRef.current) {
        setPendingCount(failed);
      }
      
      console.log(`[SYNC] Sync complete: ${synced} synced, ${failed} failed`);
      return { synced, failed };
    } catch (err) {
      console.error('[SYNC] Sync failed:', err);
      window.dispatchEvent(new CustomEvent('syncComplete'));
      return { synced: 0, failed: 0 };
    }
  }, [isReady, getUnsyncedReceipts, deleteReceipt]);

  // Update pending count
  const updatePendingCount = useCallback(async () => {
    if (!isReady) return;
    try {
      const unsynced = await getUnsyncedReceipts();
      // Filter out non-receipt entries and sales
      const receiptsOnly = unsynced.filter((r: any) => {
        if (r.orderId === 'PRINTED_RECEIPTS') return false;
        if (r.type === 'sale') return false;
        return true;
      });
      if (mountedRef.current) {
        setPendingCount(receiptsOnly.length);
      }
    } catch (err) {
      console.error('Pending count error:', err);
    }
  }, [isReady, getUnsyncedReceipts]);

  const syncAllData = useCallback(async (silent = false, showMemberBanner = false) => {
    // Use global lock to prevent concurrent syncs
    if (!acquireLock()) {
      return false;
    }

    if (!navigator.onLine) {
      releaseLock();
      if (!silent) toast.info('Working offline');
      await updatePendingCount();
      return false;
    }

    if (!isReady) {
      releaseLock();
      return false;
    }

    if (mountedRef.current) setIsSyncing(true);
    let syncedCount = 0;
    let hasAuthError = false;

    try {
      const deviceFingerprint = await generateDeviceFingerprint();

      // 1. Sync offline receipts first
      const offlineSync = await syncOfflineReceipts();
      if (offlineSync.synced > 0 && !silent) {
        toast.success(`Synced ${offlineSync.synced} collection${offlineSync.synced !== 1 ? 's' : ''}`);
      }

      // 2. Fetch and cache routes (only if ccode has routes configured)
      try {
        const routesResponse = await mysqlApi.routes.getByDevice(deviceFingerprint);
        if (routesResponse.success && routesResponse.data && routesResponse.data.length > 0) {
          await saveRoutes(routesResponse.data);
          syncedCount++;
          console.log(`[SUCCESS] Synced ${routesResponse.data.length} routes`);
        }
      } catch (err) {
        console.warn('Routes sync skipped:', err);
      }

      // 3. Fetch and cache sessions (only if ccode has sessions configured)
      try {
        const sessionsResponse = await mysqlApi.sessions.getByDevice(deviceFingerprint);
        if (sessionsResponse.success && sessionsResponse.data && sessionsResponse.data.length > 0) {
          await saveSessions(sessionsResponse.data);
          syncedCount++;
          console.log(`[SUCCESS] Synced ${sessionsResponse.data.length} sessions`);
        }
      } catch (err) {
        console.warn('Sessions sync skipped:', err);
      }

      // 4. Fetch and cache ALL farmers for offline use (with progress banner only when requested)
      try {
        if (mountedRef.current && showMemberBanner) {
          setIsSyncingMembers(true);
          setMemberSyncCount(0);
        }
        
        // Fetch ALL farmers for the device's ccode (no route filter for full offline cache)
        const response = await mysqlApi.farmers.getByDevice(deviceFingerprint);
        if (response.success && response.data && response.data.length > 0) {
          // Save all farmers to IndexedDB for offline use
          await saveFarmers(response.data);
          
          if (mountedRef.current && showMemberBanner) {
            setMemberSyncCount(response.data.length);
          }
          
          syncedCount++;
          console.log(`[SUCCESS] Synced ALL ${response.data.length} farmers for offline use`);
        } else if (response.message?.includes('not authorized')) {
          hasAuthError = true;
        }
      } catch (err) {
        console.warn('Farmers sync skipped:', err);
      } finally {
        // Small delay to show final count before hiding banner
        if (mountedRef.current) {
          setTimeout(() => {
            if (mountedRef.current) {
              setIsSyncingMembers(false);
            }
          }, 800);
        }
      }

      // 5. Fetch and cache items (only if ccode has items configured)
      try {
        const itemsResponse = await mysqlApi.items.getAll(deviceFingerprint);
        if (itemsResponse.success && itemsResponse.data && itemsResponse.data.length > 0) {
          await saveItems(itemsResponse.data);
          syncedCount++;
          console.log(`[SUCCESS] Synced ${itemsResponse.data.length} items`);
        }
      } catch (err) {
        console.warn('Items sync skipped:', err);
      }

      // 6. Cache today's Z report
      try {
        const today = new Date().toISOString().split('T')[0];
        const zReportData = await mysqlApi.zReport.get(today, deviceFingerprint);
        if (zReportData) {
          // Ensure safe data structure
          const safeData = {
            date: zReportData.date || today,
            totals: zReportData.totals || { liters: 0, farmers: 0, entries: 0 },
            byRoute: zReportData.byRoute || {},
            bySession: zReportData.bySession || { AM: { entries: 0, liters: 0 }, PM: { entries: 0, liters: 0 } },
            byCollector: zReportData.byCollector || {},
            collections: zReportData.collections || []
          };
          await saveZReport(today, safeData);
          syncedCount++;
        }
      } catch (err) {
        // Silently log - don't break sync for Z report errors
        console.warn('Z Report sync skipped:', err);
      }

      // 7. Cache current month's periodic report
      try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const startDate = monthStart.toISOString().split('T')[0];
        const endDate = monthEnd.toISOString().split('T')[0];
        
        const periodicResponse = await mysqlApi.periodicReport.get(startDate, endDate, deviceFingerprint);
        if (periodicResponse.success && periodicResponse.data) {
          await savePeriodicReport(`${startDate}_${endDate}_`, periodicResponse.data);
          syncedCount++;
        }
      } catch (err) {
        console.warn('Periodic Report sync skipped:', err);
      }

      if (mountedRef.current) {
        setLastSyncTime(new Date());
        await updatePendingCount();
        
        if (!silent) {
          if (hasAuthError && syncedCount === 0) {
            toast.warning('Device not authorized');
          } else if (syncedCount > 0) {
            toast.success('Data synced');
          }
        }
      }
      
      return syncedCount > 0 || !hasAuthError;
    } catch (err) {
      console.error('Sync error:', err);
      if (!silent) toast.error('Sync failed');
      return false;
    } finally {
      releaseLock();
      if (mountedRef.current) setIsSyncing(false);
    }
  }, [isReady, acquireLock, releaseLock, saveFarmers, saveItems, saveZReport, savePeriodicReport, saveRoutes, saveSessions, syncOfflineReceipts, updatePendingCount]);

  // Initial sync on mount - show banner only on first launch
  useEffect(() => {
    if (!navigator.onLine || !isReady) return;
    
    // Check if this is first launch (no sync time stored)
    const isFirstLaunch = !localStorage.getItem('lastSyncTime');
    
    // Sync immediately on mount, show member banner only on first launch
    if (mountedRef.current) {
      syncAllData(true, isFirstLaunch).then(() => {
        localStorage.setItem('lastSyncTime', Date.now().toString());
      });
    }
  }, [isReady]); // Only depend on isReady

  // Register centralized online handler
  // In offline-first mode (online=1), auto-sync is disabled - user must manually trigger
  useEffect(() => {
    // Skip auto-sync on reconnect in offline-first mode
    if (offlineFirstMode) {
      console.log('[OFFLINE] Offline-first mode: auto-sync on reconnect disabled');
      return;
    }
    
    const unregister = registerOnlineHandler(() => {
      if (mountedRef.current && isReady) {
        console.log('[ONLINE] Online handler triggered (background mode)');
        syncAllData(false, false); // Don't show member banner on auto-reconnect
      }
    });

    return unregister;
  }, [isReady, registerOnlineHandler, syncAllData, offlineFirstMode]);

  // Periodic sync every 5 minutes (only in background sync mode, online=0)
  useEffect(() => {
    if (!isReady) return;
    
    // Skip periodic sync in offline-first mode
    if (offlineFirstMode) {
      console.log('[OFFLINE] Offline-first mode: periodic sync disabled');
      return;
    }

    periodicSyncRef.current = setInterval(() => {
      if (navigator.onLine && mountedRef.current) {
        console.log('[SYNC] Periodic sync (background mode)');
        syncAllData(true, false); // Don't show member banner on periodic sync
      }
    }, 5 * 60 * 1000);

    return () => {
      if (periodicSyncRef.current) {
        clearInterval(periodicSyncRef.current);
      }
    };
  }, [isReady, offlineFirstMode]); // Only depend on isReady and offlineFirstMode

  // Update pending count on mount
  useEffect(() => {
    if (isReady) updatePendingCount();
  }, [isReady, updatePendingCount]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    syncAllData,
    syncOfflineReceipts,
    isSyncing,
    lastSyncTime,
    pendingCount,
    updatePendingCount,
    // Member sync state for banner
    isSyncingMembers,
    memberSyncCount,
    // Expose offline-first mode for UI components
    offlineFirstMode
  };
};
