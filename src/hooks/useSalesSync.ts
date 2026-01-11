import { useCallback, useRef, useEffect } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useSyncManager, deduplicateReceipts } from '@/hooks/useSyncManager';
import { mysqlApi, type Sale } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { toast } from 'sonner';

interface AITransaction extends Sale {
  transrefno?: string;
  uploadrefno?: string;
  transtype?: number;
  cow_name?: string;
  cow_breed?: string;
  number_of_calves?: string;
  other_details?: string;
}

/**
 * Unified hook for syncing Store and AI transactions
 * Centralizes offline storage and background sync logic
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
      console.log(`💾 Saved offline ${(sale as AITransaction).transtype === 3 ? 'AI' : 'store'} sale`);
      return true;
    } catch (error) {
      console.error('Failed to save offline sale:', error);
      return false;
    }
  }, [isReady, saveSale]);

  // Sync all pending store and AI sales
  const syncPendingSales = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (!navigator.onLine || !isReady) {
      return { synced: 0, failed: 0 };
    }

    if (!acquireLock()) {
      console.log('⏸️ Sale sync locked - another sync in progress');
      return { synced: 0, failed: 0 };
    }

    let synced = 0;
    let failed = 0;

    try {
      const allRecords = await getUnsyncedSales();
      
      // Filter for only sale/AI types
      const pendingSales = allRecords.filter((r: any) => 
        r.type === 'sale' || r.type === 'ai'
      );

      if (pendingSales.length === 0) {
        releaseLock();
        return { synced: 0, failed: 0 };
      }

      console.log(`📤 Syncing ${pendingSales.length} pending sales/AI transactions...`);
      const deviceFingerprint = await generateDeviceFingerprint();

      for (const saleRecord of pendingSales) {
        if (!mountedRef.current) break;

        try {
          // Clean up sale data before sending
          const cleanSale: Sale = {
            farmer_id: String(saleRecord.farmer_id || '').replace(/^#/, '').trim(),
            farmer_name: String(saleRecord.farmer_name || '').trim(),
            item_code: String(saleRecord.item_code || '').trim(),
            item_name: String(saleRecord.item_name || '').trim(),
            quantity: Number(saleRecord.quantity) || 0,
            price: Number(saleRecord.price) || 0,
            sold_by: String(saleRecord.sold_by || '').trim(),
            device_fingerprint: deviceFingerprint,
            ...(saleRecord.photo && { photo: saleRecord.photo }),
            ...(saleRecord.transrefno && { transrefno: saleRecord.transrefno }),
            ...(saleRecord.uploadrefno && { uploadrefno: saleRecord.uploadrefno }),
            ...(saleRecord.transtype && { transtype: saleRecord.transtype }),
            // AI-specific fields
            ...(saleRecord.cow_name && { cow_name: saleRecord.cow_name }),
            ...(saleRecord.cow_breed && { cow_breed: saleRecord.cow_breed }),
            ...(saleRecord.number_of_calves && { number_of_calves: saleRecord.number_of_calves }),
            ...(saleRecord.other_details && { other_details: saleRecord.other_details }),
          };

          const success = await mysqlApi.sales.create(cleanSale);
          if (success && saleRecord.orderId) {
            await deleteSale(saleRecord.orderId);
            synced++;
            console.log(`✅ Synced ${saleRecord.type || 'sale'}: ${saleRecord.transrefno || saleRecord.orderId}`);
          } else {
            failed++;
          }
        } catch (error: any) {
          console.error('Sync error for sale:', error);
          // Check for duplicate error
          const errorMsg = error?.message?.toLowerCase() || '';
          if (errorMsg.includes('duplicate') || errorMsg.includes('already exists')) {
            if (saleRecord.orderId) {
              await deleteSale(saleRecord.orderId);
            }
            synced++;
          } else {
            failed++;
          }
        }
      }

      if (synced > 0) {
        console.log(`📊 Sales sync complete: ${synced} synced, ${failed} failed`);
      }

      return { synced, failed };
    } catch (error) {
      console.error('Failed to sync sales:', error);
      return { synced: 0, failed: 0 };
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
        console.log('📡 Online - syncing pending sales');
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
