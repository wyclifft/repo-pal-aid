import { useCallback, useRef, useEffect } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useSyncManager, deduplicateReceipts } from '@/hooks/useSyncManager';
import { mysqlApi, type Sale, type BatchSaleRequest } from '@/services/mysqlApi';
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
 * Supports batch sync: groups items by uploadrefno for efficient upload
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

  // Sync all pending store and AI sales
  // Groups store items by uploadrefno for batch sync
  const syncPendingSales = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (!navigator.onLine || !isReady) {
      return { synced: 0, failed: 0 };
    }

    if (!acquireLock()) {
      console.log('[SYNC] Sale sync locked - another sync in progress');
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

      console.log(`[SYNC] Syncing ${pendingSales.length} pending sales/AI transactions...`);
      const deviceFingerprint = await generateDeviceFingerprint();

      // Group store sales by uploadrefno for batch sync
      const storeBatches: Record<string, typeof pendingSales> = {};
      const aiSales: typeof pendingSales = [];

      for (const sale of pendingSales) {
        if (sale.transtype === 3) {
          aiSales.push(sale);
        } else if (sale.uploadrefno) {
          if (!storeBatches[sale.uploadrefno]) {
            storeBatches[sale.uploadrefno] = [];
          }
          storeBatches[sale.uploadrefno].push(sale);
        } else {
          // No uploadrefno - sync individually
          aiSales.push(sale);
        }
      }

      // Sync store batches (grouped by uploadrefno)
      for (const [uploadrefno, batchSales] of Object.entries(storeBatches)) {
        if (!mountedRef.current) break;

        try {
          const firstSale = batchSales[0];
          
          // Build batch request with ALL required fields including user_id, route, season, and transrefno
          const batchRequest: BatchSaleRequest = {
            uploadrefno,
            transtype: 2,
            farmer_id: String(firstSale.farmer_id || '').replace(/^#/, '').trim(),
            farmer_name: String(firstSale.farmer_name || '').trim(),
            route: String(firstSale.route || '').trim(), // Include route for DB
            user_id: String(firstSale.user_id || '').trim(), // Login user_id → DB: userId
            sold_by: String(firstSale.sold_by || '').trim(), // Display name → DB: clerk
            device_fingerprint: deviceFingerprint,
            photo: firstSale.photo, // ONE photo for batch
            season: String(firstSale.season || '').trim(), // Session SCODE → DB: CAN
            items: batchSales.map(sale => ({
              transrefno: sale.transrefno || '', // Preserve original transrefno generated offline
              item_code: String(sale.item_code || '').trim(),
              item_name: String(sale.item_name || '').trim(),
              quantity: Number(sale.quantity) || 0,
              price: Number(sale.price) || 0,
            })),
          };

          const result = await mysqlApi.sales.createBatch(batchRequest);
          
          if (result.success) {
            // Delete all items in this batch
            for (const sale of batchSales) {
              if (sale.orderId) {
                await deleteSale(sale.orderId);
              }
            }
            synced += batchSales.length;
            console.log(`[SUCCESS] Synced batch: ${uploadrefno} (${batchSales.length} items)`);
          } else {
            // Check for duplicate - if so, still delete local
            const errorMsg = result.error?.toLowerCase() || '';
            if (errorMsg.includes('duplicate') || errorMsg.includes('already exists')) {
              for (const sale of batchSales) {
                if (sale.orderId) {
                  await deleteSale(sale.orderId);
                }
              }
              synced += batchSales.length;
            } else {
              failed += batchSales.length;
            }
          }
        } catch (error: any) {
          console.error('[SYNC] Batch sync error:', error);
          const errorMsg = error?.message?.toLowerCase() || '';
          if (errorMsg.includes('duplicate') || errorMsg.includes('already exists')) {
            for (const sale of batchSales) {
              if (sale.orderId) {
                await deleteSale(sale.orderId);
              }
            }
            synced += batchSales.length;
          } else {
            failed += batchSales.length;
          }
        }
      }

      // Sync AI sales individually
      for (const saleRecord of aiSales) {
        if (!mountedRef.current) break;

        try {
          const cleanSale: Sale = {
            farmer_id: String(saleRecord.farmer_id || '').replace(/^#/, '').trim(),
            farmer_name: String(saleRecord.farmer_name || '').trim(),
            item_code: String(saleRecord.item_code || '').trim(),
            item_name: String(saleRecord.item_name || '').trim(),
            quantity: Number(saleRecord.quantity) || 0,
            price: Number(saleRecord.price) || 0,
            route: String(saleRecord.route || '').trim(), // Include route for DB
            user_id: String(saleRecord.user_id || '').trim(), // Login user_id → DB: userId
            sold_by: String(saleRecord.sold_by || '').trim(), // Display name → DB: clerk
            device_fingerprint: deviceFingerprint,
            season: String(saleRecord.season || '').trim(), // Session SCODE → DB: CAN
            ...(saleRecord.photo && { photo: saleRecord.photo }),
            ...(saleRecord.transrefno && { transrefno: saleRecord.transrefno }), // Preserve original transrefno
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
            console.log(`[SUCCESS] Synced AI: ${saleRecord.transrefno || saleRecord.orderId}`);
          } else {
            failed++;
          }
        } catch (error: any) {
          console.error('[SYNC] AI sync error:', error);
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
        console.log(`[SYNC] Sales sync complete: ${synced} synced, ${failed} failed`);
      }

      return { synced, failed };
    } catch (error) {
      console.error('[SYNC] Failed to sync sales:', error);
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
