import { useState, useEffect, useCallback } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { mysqlApi } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { toast } from 'sonner';

export const useDataSync = () => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const { 
    saveFarmers, 
    saveItems, 
    saveZReport, 
    savePeriodicReport,
    isReady 
  } = useIndexedDB();

  const syncAllData = useCallback(async (silent = false) => {
    if (!navigator.onLine) {
      console.log('⚠️ Cannot sync: offline');
      if (!silent) {
        toast.info('Working offline - using cached data');
      }
      return false;
    }

    if (!isReady) {
      console.log('⚠️ Cannot sync: IndexedDB not ready');
      return false;
    }

    setIsSyncing(true);
    let syncedCount = 0;
    let hasAuthError = false;

    try {
      const deviceFingerprint = await generateDeviceFingerprint();

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
      
      if (!silent) {
        if (hasAuthError && syncedCount === 0) {
          toast.warning('Device not authorized - working with cached data');
        } else if (syncedCount > 0) {
          toast.success(`Data synced: ${syncedCount} datasets cached`);
        } else {
          toast.info('No new data to sync');
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
      setIsSyncing(false);
    }
  }, [isReady, saveFarmers, saveItems, saveZReport, savePeriodicReport]);

  // Auto-sync on mount when online
  useEffect(() => {
    if (navigator.onLine && isReady) {
      console.log('🔄 Initial data sync on mount');
      syncAllData(true);
    }
  }, [isReady]);

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
    if (!navigator.onLine) return;

    const interval = setInterval(() => {
      if (navigator.onLine) {
        console.log('🔄 Periodic background sync');
        syncAllData(true);
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [syncAllData]);

  return {
    syncAllData,
    isSyncing,
    lastSyncTime
  };
};
