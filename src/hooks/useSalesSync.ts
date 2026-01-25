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

      console.log(`[SYNC] Starting sync of ${pendingSales.length} pending sales/AI transactions...`);
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

      const batchEntries = Object.entries(storeBatches);
      
      // Sync store batches (grouped by uploadrefno)
      for (let i = 0; i < batchEntries.length; i++) {
        const [uploadrefno, batchSales] = batchEntries[i];
        
        if (!mountedRef.current) {
          console.warn(`[SYNC] Component unmounted at batch ${i + 1}/${batchEntries.length}, stopping sync`);
          break;
        }

        console.log(`[SYNC] Processing batch ${i + 1}/${batchEntries.length}: ${uploadrefno} (${batchSales.length} items)`);

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
                try {
                  await deleteSale(sale.orderId);
                } catch (deleteErr) {
                  console.warn(`[WARN] Failed to delete synced sale ${sale.orderId}:`, deleteErr);
                }
              }
            }
            synced += batchSales.length;
            console.log(`[SUCCESS] Synced batch ${i + 1}/${batchEntries.length}: ${uploadrefno} (${batchSales.length} items)`);
          } else {
            // Check for duplicate - if so, still delete local
            const errorMsg = (result.error || '').toLowerCase();
            if (errorMsg.includes('duplicate') || errorMsg.includes('already exists')) {
              for (const sale of batchSales) {
                if (sale.orderId) {
                  try {
                    await deleteSale(sale.orderId);
                  } catch (deleteErr) {
                    console.warn(`[WARN] Failed to delete duplicate sale ${sale.orderId}:`, deleteErr);
                  }
                }
              }
              synced += batchSales.length;
              console.log(`[SKIP] Batch already synced (duplicate): ${uploadrefno}`);
            } else {
              failed += batchSales.length;
              console.warn(`[WARN] Batch sync failed for ${uploadrefno}: ${result.error || 'Unknown error'}`);
            }
          }
        } catch (error: any) {
          console.error(`[ERROR] Batch sync exception for ${uploadrefno}:`, error);
          const errorMsg = (error?.message || '').toLowerCase();
          if (errorMsg.includes('duplicate') || errorMsg.includes('already exists')) {
            for (const sale of batchSales) {
              if (sale.orderId) {
                try {
                  await deleteSale(sale.orderId);
                } catch (deleteErr) {
                  console.warn(`[WARN] Failed to delete duplicate sale ${sale.orderId}:`, deleteErr);
                }
              }
            }
            synced += batchSales.length;
          } else {
            failed += batchSales.length;
          }
        }
        
        // Small delay between batches
        if (i < batchEntries.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Sync AI sales individually
      for (let i = 0; i < aiSales.length; i++) {
        const saleRecord = aiSales[i];
        
        if (!mountedRef.current) {
          console.warn(`[SYNC] Component unmounted at AI sale ${i + 1}/${aiSales.length}, stopping sync`);
          break;
        }

        console.log(`[SYNC] Processing AI sale ${i + 1}/${aiSales.length}: ${saleRecord.transrefno || saleRecord.orderId}`);

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
            try {
              await deleteSale(saleRecord.orderId);
            } catch (deleteErr) {
              console.warn(`[WARN] Failed to delete synced AI sale ${saleRecord.orderId}:`, deleteErr);
            }
            synced++;
            console.log(`[SUCCESS] Synced AI ${i + 1}/${aiSales.length}: ${saleRecord.transrefno || saleRecord.orderId}`);
          } else {
            failed++;
            console.warn(`[WARN] AI sync failed for ${saleRecord.transrefno || saleRecord.orderId}`);
          }
        } catch (error: any) {
          console.error(`[ERROR] AI sync exception for ${saleRecord.transrefno || saleRecord.orderId}:`, error);
          const errorMsg = (error?.message || '').toLowerCase();
          if (errorMsg.includes('duplicate') || errorMsg.includes('already exists')) {
            if (saleRecord.orderId) {
              try {
                await deleteSale(saleRecord.orderId);
              } catch (deleteErr) {
                console.warn(`[WARN] Failed to delete duplicate AI sale ${saleRecord.orderId}:`, deleteErr);
              }
            }
            synced++;
          } else {
            failed++;
          }
        }
        
        // Small delay between AI sales
        if (i < aiSales.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`[SYNC] Sales sync complete: ${synced} synced, ${failed} failed out of ${pendingSales.length} total`);
      return { synced, failed };
    } catch (error) {
      console.error('[SYNC] Fatal sales sync error:', error);
      return { synced, failed };
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
