import { useCallback, useRef, useEffect } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useSyncManager } from '@/hooks/useSyncManager';
import { syncSalesFromDB } from '@/utils/salesSyncEngine';
import { toast } from 'sonner';

import type { Sale } from '@/services/mysqlApi';

interface AITransaction extends Sale {
  transrefno?: string;
  uploadrefno?: string;
  transtype?: number;
  route_tcode?: string;
  cow_name?: string;
  cow_breed?: string;
  number_of_calves?: string;
  other_details?: string;
}

/**
 * Unified hook for syncing Store and AI transactions
 * Delegates core sync logic to salesSyncEngine utility
 * v2.10.21: Engine extracted so useDataSync can also trigger sales sync globally
 */
export const useSalesSync = () => {
  const mountedRef = useRef(true);
  const { saveSale, getUnsyncedSales, deleteSale, isReady } = useIndexedDB();
  const { acquireLock, releaseLock, registerOnlineHandler } = useSyncManager();

  // Save a store or AI sale for offline sync
  const saveOfflineSale = useCallback(async (sale: Sale | AITransaction): Promise<boolean> => {
    if (!isReady) {
      console.warn('IndexedDB not ready, cannot save offline sale');
      return false;
    }

    try {
      await saveSale({
        ...sale,
        synced: false,
        type: (sale as AITransaction).transtype === 3 ? 'ai' : 'sale',
      });
      console.log(`[OFFLINE] Saved offline ${(sale as AITransaction).transtype === 3 ? 'AI' : 'store'} sale`);
      return true;
    } catch (error) {
      console.error('[OFFLINE] Failed to save offline sale:', error);
      return false;
    }
  }, [isReady, saveSale]);

  // Sync all pending store and AI sales using shared engine
  const syncPendingSales = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (!navigator.onLine || !isReady) {
      return { synced: 0, failed: 0 };
    }

    if (!acquireLock()) {
      console.log('[SYNC] Sale sync locked - another sync in progress');
      return { synced: 0, failed: 0 };
    }

    try {
      const result = await syncSalesFromDB(
        getUnsyncedSales,
        deleteSale,
        () => !mountedRef.current
      );
      return result;
    } finally {
      releaseLock();
    }
  }, [isReady, acquireLock, releaseLock, getUnsyncedSales, deleteSale]);

  // Get count of pending sales
  const getPendingSalesCount = useCallback(async (): Promise<number> => {
    if (!isReady) return 0;
    try {
      const sales = await getUnsyncedSales();
      return sales.filter((r: any) => r.type === 'sale' || r.type === 'ai').length;
    } catch {
      return 0;
    }
  }, [isReady, getUnsyncedSales]);

  // Register online handler for auto-sync
  useEffect(() => {
    const unregister = registerOnlineHandler(() => {
      if (mountedRef.current && isReady && navigator.onLine) {
        console.log('[ONLINE] Syncing pending sales');
        syncPendingSales().then(({ synced }) => {
          if (synced > 0) {
            toast.success(`Synced ${synced} offline sale${synced !== 1 ? 's' : ''}`);
          }
        });
      }
    });

    return unregister;
  }, [isReady, registerOnlineHandler, syncPendingSales]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    saveOfflineSale,
    syncPendingSales,
    getPendingSalesCount,
  };
};
