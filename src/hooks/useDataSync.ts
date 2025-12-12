import { useState, useEffect, useCallback, useRef } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useSyncManager, deduplicateReceipts } from '@/hooks/useSyncManager';
import { mysqlApi } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { toast } from 'sonner';

export const useDataSync = () => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const mountedRef = useRef(true);
  const periodicSyncRef = useRef<NodeJS.Timeout | null>(null);
  
  const { 
    saveFarmers, 
    saveItems, 
    saveZReport, 
    savePeriodicReport,
    getUnsyncedReceipts,
    deleteReceipt,
    isReady 
  } = useIndexedDB();

  const { acquireLock, releaseLock, registerOnlineHandler } = useSyncManager();

  // Sync offline receipts TO backend with deduplication
  const syncOfflineReceipts = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (!isReady || !navigator.onLine) {
      console.log('📴 Sync skipped: not ready or offline');
      return { synced: 0, failed: 0 };
    }

    try {
      const rawReceipts = await getUnsyncedReceipts();
      // Filter and deduplicate
      const unsyncedReceipts = deduplicateReceipts(
        rawReceipts.filter((r: any) => r.type !== 'sale')
      );
      
      if (unsyncedReceipts.length === 0) {
        setPendingCount(0);
        console.log('✅ No pending receipts to sync');
        return { synced: 0, failed: 0 };
      }

      console.log(`📤 Syncing ${unsyncedReceipts.length} offline receipts...`);
      
      // Dispatch sync start event
      window.dispatchEvent(new CustomEvent('syncStart'));
      
      let synced = 0;
      let failed = 0;

      for (const receipt of unsyncedReceipts) {
        if (!mountedRef.current) break; // Stop if unmounted

        try {
          console.log(`🔄 Attempting to sync: ${receipt.reference_no}`);
          
          const result = await mysqlApi.milkCollection.create({
            reference_no: receipt.reference_no,
            farmer_id: receipt.farmer_id,
            farmer_name: receipt.farmer_name,
            route: receipt.route,
            session: receipt.session as 'AM' | 'PM',
            weight: receipt.weight,
            clerk_name: receipt.clerk_name,
            collection_date: receipt.collection_date,
          });

          console.log(`📨 API response for ${receipt.reference_no}:`, result);

          // Check if sync was successful - API returns { success: true/false, reference_no: string }
          if (result.success) {
            if (receipt.orderId) {
              await deleteReceipt(receipt.orderId);
              console.log(`🗑️ Deleted local receipt: ${receipt.orderId}`);
            }
            synced++;
            console.log(`✅ Synced successfully: ${receipt.reference_no}`);
          } else {
            failed++;
            console.warn(`⚠️ Sync failed for: ${receipt.reference_no}`, result);
          }
        } catch (err: any) {
          console.error(`❌ Exception syncing ${receipt.reference_no}:`, err);
          
          // Check if it's a duplicate error (already exists in DB)
          const errorMsg = err?.message?.toLowerCase() || '';
          if (errorMsg.includes('duplicate') || errorMsg.includes('already exists') || errorMsg.includes('unique')) {
            console.log(`⏭️ Already synced (duplicate): ${receipt.reference_no}`);
            if (receipt.orderId) {
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
      
      console.log(`📊 Sync complete: ${synced} synced, ${failed} failed`);
      return { synced, failed };
    } catch (err) {
      console.error('Sync failed:', err);
      window.dispatchEvent(new CustomEvent('syncComplete'));
      return { synced: 0, failed: 0 };
    }
  }, [isReady, getUnsyncedReceipts, deleteReceipt]);

  // Update pending count
  const updatePendingCount = useCallback(async () => {
    if (!isReady) return;
    try {
      const unsynced = await getUnsyncedReceipts();
      const receiptsOnly = unsynced.filter((r: any) => r.type !== 'sale');
      if (mountedRef.current) {
        setPendingCount(receiptsOnly.length);
      }
    } catch (err) {
      console.error('Pending count error:', err);
    }
  }, [isReady, getUnsyncedReceipts]);

  const syncAllData = useCallback(async (silent = false) => {
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

      // 2. Fetch and cache farmers
      try {
        const response = await mysqlApi.farmers.getByDevice(deviceFingerprint);
        if (response.success && response.data) {
          await saveFarmers(response.data);
          syncedCount++;
        } else if (response.message?.includes('not authorized')) {
          hasAuthError = true;
        }
      } catch (err) {
        console.error('Farmers sync error:', err);
      }

      // 3. Fetch and cache items
      try {
        const itemsResponse = await mysqlApi.items.getAll(deviceFingerprint);
        if (itemsResponse.success && itemsResponse.data) {
          await saveItems(itemsResponse.data);
          syncedCount++;
        }
      } catch (err) {
        console.error('Items sync error:', err);
      }

      // 4. Cache today's Z report
      try {
        const today = new Date().toISOString().split('T')[0];
        const zReportData = await mysqlApi.zReport.get(today, deviceFingerprint);
        if (zReportData) {
          await saveZReport(today, zReportData);
          syncedCount++;
        }
      } catch (err) {
        console.error('Z Report sync error:', err);
      }

      // 5. Cache current month's periodic report
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
        console.error('Periodic Report sync error:', err);
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
  }, [isReady, acquireLock, releaseLock, saveFarmers, saveItems, saveZReport, savePeriodicReport, syncOfflineReceipts, updatePendingCount]);

  // Initial sync on mount - immediate without delay
  useEffect(() => {
    if (!navigator.onLine || !isReady) return;
    
    // Sync immediately on mount for faster startup
    if (mountedRef.current) {
      syncAllData(true);
    }
  }, [isReady]); // Only depend on isReady

  // Register centralized online handler
  useEffect(() => {
    const unregister = registerOnlineHandler(() => {
      if (mountedRef.current && isReady) {
        console.log('📡 Online handler triggered');
        syncAllData(false);
      }
    });

    return unregister;
  }, [isReady, registerOnlineHandler, syncAllData]);

  // Periodic sync every 5 minutes
  useEffect(() => {
    if (!isReady) return;

    periodicSyncRef.current = setInterval(() => {
      if (navigator.onLine && mountedRef.current) {
        console.log('🔄 Periodic sync');
        syncAllData(true);
      }
    }, 5 * 60 * 1000);

    return () => {
      if (periodicSyncRef.current) {
        clearInterval(periodicSyncRef.current);
      }
    };
  }, [isReady]); // Only depend on isReady

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
    updatePendingCount
  };
};
