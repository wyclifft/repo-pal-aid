import { useState, useEffect, useCallback, useRef } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { mysqlApi } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { toast } from 'sonner';

export const useDataSync = () => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const syncInProgress = useRef(false);
  
  const { 
    saveFarmers, 
    saveItems, 
    saveZReport, 
    savePeriodicReport,
    getUnsyncedReceipts,
    deleteReceipt,
    isReady 
  } = useIndexedDB();

  // Sync offline receipts TO backend
  const syncOfflineReceipts = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (!isReady || !navigator.onLine) {
      return { synced: 0, failed: 0 };
    }

    try {
      const unsyncedReceipts = await getUnsyncedReceipts();
      if (unsyncedReceipts.length === 0) {
        setPendingCount(0);
        return { synced: 0, failed: 0 };
      }

      console.log(`📤 Syncing ${unsyncedReceipts.length} offline receipts to backend...`);
      let synced = 0;
      let failed = 0;

      for (const receipt of unsyncedReceipts) {
        // Skip non-milk collection records (like sales)
        if ((receipt as any).type === 'sale') continue;

        try {
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

          if (result.success && receipt.orderId) {
            await deleteReceipt(receipt.orderId);
            synced++;
            console.log(`✅ Synced receipt ${receipt.reference_no}`);
          } else {
            failed++;
            console.warn(`⚠️ Failed to sync receipt ${receipt.reference_no}`);
          }
        } catch (err) {
          failed++;
          console.error(`❌ Error syncing receipt:`, err);
        }
      }

      setPendingCount(failed);
      return { synced, failed };
    } catch (err) {
      console.error('Failed to sync offline receipts:', err);
      return { synced: 0, failed: 0 };
    }
  }, [isReady, getUnsyncedReceipts, deleteReceipt]);

  // Update pending count periodically
  const updatePendingCount = useCallback(async () => {
    if (!isReady) return;
    try {
      const unsynced = await getUnsyncedReceipts();
      // Filter out non-receipt items like sales
      const receiptsOnly = unsynced.filter((r: any) => r.type !== 'sale');
      setPendingCount(receiptsOnly.length);
    } catch (err) {
      console.error('Failed to get pending count:', err);
    }
  }, [isReady, getUnsyncedReceipts]);

  const syncAllData = useCallback(async (silent = false) => {
    // Prevent multiple simultaneous syncs
    if (syncInProgress.current) {
      console.log('⏸️ Sync already in progress, skipping...');
      return false;
    }

    if (!navigator.onLine) {
      console.log('⚠️ Cannot sync: offline');
      if (!silent) {
        toast.info('Working offline - using cached data');
      }
      await updatePendingCount();
      return false;
    }

    if (!isReady) {
      console.log('⚠️ Cannot sync: IndexedDB not ready');
      return false;
    }

    syncInProgress.current = true;
    setIsSyncing(true);
    let syncedCount = 0;
    let hasAuthError = false;

    try {
      const deviceFingerprint = await generateDeviceFingerprint();

      // 0. First, sync any offline receipts TO the backend
      const offlineSync = await syncOfflineReceipts();
      if (offlineSync.synced > 0) {
        console.log(`📤 Synced ${offlineSync.synced} offline receipts to backend`);
        if (!silent) {
          toast.success(`Synced ${offlineSync.synced} offline collection${offlineSync.synced !== 1 ? 's' : ''} to server`);
        }
      }

      // 1. Sync farmers
      try {
        const response = await mysqlApi.farmers.getByDevice(deviceFingerprint);
        if (response.success && response.data) {
          await saveFarmers(response.data);
          console.log(`✅ Cached ${response.data.length} farmers`);
          syncedCount++;
        } else if (response.message?.includes('not authorized')) {
          hasAuthError = true;
          console.warn('⚠️ Device not authorized - working offline');
        }
      } catch (err) {
        console.error('Failed to sync farmers:', err);
      }

      // 2. Sync store items
      try {
        const itemsResponse = await mysqlApi.items.getAll(deviceFingerprint);
        if (itemsResponse.success && itemsResponse.data) {
          await saveItems(itemsResponse.data);
          console.log(`✅ Cached ${itemsResponse.data.length} store items`);
          syncedCount++;
        } else if (itemsResponse.message?.includes('not authorized')) {
          hasAuthError = true;
        }
      } catch (err) {
        console.error('Failed to sync store items:', err);
      }

      // 3. Sync today's Z report
      try {
        const today = new Date().toISOString().split('T')[0];
        const zReportData = await mysqlApi.zReport.get(today, deviceFingerprint);
        if (zReportData) {
          await saveZReport(today, zReportData);
          console.log(`✅ Cached Z Report for ${today}`);
          syncedCount++;
        }
      } catch (err) {
        console.error('Failed to sync Z Report:', err);
      }

      // 4. Sync periodic report for current month
      try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const startDate = monthStart.toISOString().split('T')[0];
        const endDate = monthEnd.toISOString().split('T')[0];
        
        const periodicResponse = await mysqlApi.periodicReport.get(
          startDate,
          endDate,
          deviceFingerprint
        );
        if (periodicResponse.success && periodicResponse.data) {
          const cacheKey = `${startDate}_${endDate}_`;
          await savePeriodicReport(cacheKey, periodicResponse.data);
          console.log(`✅ Cached Periodic Report for ${startDate} to ${endDate}`);
          syncedCount++;
        }
      } catch (err) {
        console.error('Failed to sync Periodic Report:', err);
      }

      setLastSyncTime(new Date());
      await updatePendingCount();
      
      if (!silent) {
        if (hasAuthError && syncedCount === 0) {
          toast.warning('Device not authorized - working with cached data');
        } else if (syncedCount > 0) {
          toast.success(`Data synced: ${syncedCount} datasets cached`);
        }
      }
      
      console.log(`✅ Data sync completed: ${syncedCount} datasets cached`);
      return syncedCount > 0 || !hasAuthError;
    } catch (err) {
      console.error('Error during data sync:', err);
      if (!silent) {
        toast.error('Sync failed - working with cached data');
      }
      return false;
    } finally {
      syncInProgress.current = false;
      setIsSyncing(false);
    }
  }, [isReady, saveFarmers, saveItems, saveZReport, savePeriodicReport, syncOfflineReceipts, updatePendingCount]);

  // Auto-sync on mount when online (with small delay to ensure DB is ready)
  useEffect(() => {
    if (!navigator.onLine || !isReady) return;

    const timer = setTimeout(() => {
      console.log('🔄 Initial data sync on mount');
      syncAllData(true);
    }, 500); // Small delay to ensure DB is fully initialized

    return () => clearTimeout(timer);
  }, [isReady, syncAllData]);

  // Auto-sync when coming back online
  useEffect(() => {
    const handleOnline = async () => {
      console.log('📡 Back online. Syncing data...');
      await syncAllData(false);
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [syncAllData]);

  // Periodic background sync every 5 minutes when online
  useEffect(() => {
    if (!navigator.onLine || !isReady) return;

    const interval = setInterval(() => {
      if (navigator.onLine && isReady) {
        console.log('🔄 Periodic background sync');
        syncAllData(true);
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [isReady, syncAllData]);

  // Update pending count on mount
  useEffect(() => {
    if (isReady) {
      updatePendingCount();
    }
  }, [isReady, updatePendingCount]);

  return {
    syncAllData,
    syncOfflineReceipts,
    isSyncing,
    lastSyncTime,
    pendingCount,
    updatePendingCount
  };
};
