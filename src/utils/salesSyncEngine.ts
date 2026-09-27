import { mysqlApi, type Sale, type BatchSaleRequest } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { resolveSessionMetadata } from '@/utils/sessionMetadata';
import { markNativeRecordSynced, isNativeStorageAvailable, getUnsyncedFromLocalDB } from '@/services/offlineStorage';

interface SaleRecord extends Sale {
  orderId?: number;
  type?: string;
  transrefno?: string;
  uploadrefno?: string;
  transtype?: number;
  route_tcode?: string;
  session_label?: string;
  cow_name?: string;
  cow_breed?: string;
  number_of_calves?: string;
  other_details?: string;
  fromNative?: boolean;
}

// Module-level guard to prevent concurrent executions of the sales sync engine
let isSalesSyncActive = false;

/**
 * Shared sales sync engine — used by both useDataSync (global) and useSalesSync (page-level).
 * Groups store items by uploadrefno for batch upload; syncs AI items individually.
 * Handles duplicate detection, concurrent execution guarding, and thorough local DB cleanup.
 */
export const syncSalesFromDB = async (
  getUnsyncedSales: () => Promise<any[]>,
  deleteSale: (orderId: number) => Promise<void>,
  abortCheck?: () => boolean
): Promise<{ synced: number; failed: number }> => {
  if (isSalesSyncActive) {
    console.log('[SYNC-ENGINE] Sales sync already active in another thread, skipping');
    return { synced: 0, failed: 0 };
  }

  isSalesSyncActive = true;
  let synced = 0;
  let failed = 0;

  try {
    const allRecords = await getUnsyncedSales();
    const idbSales: SaleRecord[] = allRecords.filter(
      (r: any) => r.type === 'sale' || r.type === 'ai'
    );

    const pendingSales: SaleRecord[] = [];
    const seenRefs = new Set<string>();

    // 1. Add IndexedDB records with deduplication by transrefno
    for (const sale of idbSales) {
      const refKey = (sale.transrefno || sale.uploadrefno || '').trim().toUpperCase();
      if (refKey) {
        if (seenRefs.has(refKey)) {
          // Clean up duplicate IndexedDB row
          if (sale.orderId) {
            deleteSale(sale.orderId).catch(() => {});
          }
          continue;
        }
        seenRefs.add(refKey);
      }
      pendingSales.push(sale);
    }

    // 2. Combine with native SQLite storage sales (store_sale and ai_sale) if available
    if (isNativeStorageAvailable()) {
      try {
        const nativeStoreRaw = await getUnsyncedFromLocalDB('store_sale');
        const nativeAIRaw = await getUnsyncedFromLocalDB('ai_sale');
        const nativeCombined = [...nativeStoreRaw, ...nativeAIRaw];

        for (const record of nativeCombined) {
          try {
            const payload = typeof record.payload === 'string' ? JSON.parse(record.payload) : record.payload;
            const ref = (payload.transrefno || record.referenceNo || '').trim().toUpperCase();
            if (ref && !seenRefs.has(ref)) {
              seenRefs.add(ref);
              pendingSales.push({
                ...payload,
                transrefno: payload.transrefno || record.referenceNo,
                type: record.recordType === 'ai_sale' ? 'ai' : 'sale',
                fromNative: true,
              });
            } else if (ref && seenRefs.has(ref)) {
              // Already covered in IDB, mark native as synced
              markNativeRecordSynced(ref).catch(() => {});
            }
          } catch (pErr) {
            console.warn('[SYNC-ENGINE] Failed to parse native sale record:', pErr);
          }
        }
      } catch (natErr) {
        console.warn('[SYNC-ENGINE] Failed to fetch native sales records:', natErr);
      }
    }

    if (pendingSales.length === 0) {
      return { synced: 0, failed: 0 };
    }

    console.log(`[SYNC-ENGINE] Starting sync of ${pendingSales.length} pending sales/AI transactions...`);
    const deviceFingerprint = await generateDeviceFingerprint();

    // Group store sales by uploadrefno for batch sync
    const storeBatches: Record<string, SaleRecord[]> = {};
    const aiSales: SaleRecord[] = [];

    for (const sale of pendingSales) {
      if (sale.transtype === 3) {
        aiSales.push(sale);
      } else if (sale.uploadrefno) {
        if (!storeBatches[sale.uploadrefno]) {
          storeBatches[sale.uploadrefno] = [];
        }
        // Ensure no duplicate items within the same uploadrefno batch
        const batchArr = storeBatches[sale.uploadrefno];
        const existingItemIndex = batchArr.findIndex(
          b => (b.transrefno && sale.transrefno && b.transrefno === sale.transrefno) ||
               (b.item_code === sale.item_code && b.quantity === sale.quantity)
        );
        if (existingItemIndex === -1) {
          batchArr.push(sale);
        } else {
          // If duplicate in batch array, delete the duplicate orderId if available
          if (sale.orderId) {
            deleteSale(sale.orderId).catch(() => {});
          }
        }
      } else {
        // No uploadrefno — sync individually
        aiSales.push(sale);
      }
    }

    const batchEntries = Object.entries(storeBatches);

    // Helper function to thoroughly clean up local storage for synced/duplicate sales
    const cleanupBatchSales = async (salesList: SaleRecord[]) => {
      for (const sale of salesList) {
        if (sale.transrefno) {
          markNativeRecordSynced(sale.transrefno).catch(() => {});
        }
        if (sale.uploadrefno) {
          markNativeRecordSynced(sale.uploadrefno).catch(() => {});
        }
        if (sale.orderId) {
          try {
            await deleteSale(sale.orderId);
          } catch (e) {
            console.warn(`[WARN] Failed to delete synced sale ${sale.orderId}:`, e);
          }
        }
        // Also check if any matching record in IndexedDB exists with the same transrefno
        const matchingIdb = allRecords.find(
          r => r.transrefno && sale.transrefno && r.transrefno === sale.transrefno && r.orderId !== sale.orderId
        );
        if (matchingIdb?.orderId) {
          deleteSale(matchingIdb.orderId).catch(() => {});
        }
      }
    };

    // Sync store batches (grouped by uploadrefno)
    for (let i = 0; i < batchEntries.length; i++) {
      const [uploadrefno, batchSales] = batchEntries[i];

      if (typeof abortCheck === 'function' && abortCheck()) {
        console.warn(`[SYNC-ENGINE] Aborted at batch ${i + 1}/${batchEntries.length}`);
        break;
      }

      console.log(`[SYNC-ENGINE] Batch ${i + 1}/${batchEntries.length}: ${uploadrefno} (${batchSales.length} items)`);

      try {
        const firstSale = batchSales[0];

        // Best-effort enrichment for legacy offline records
        const rawSeason = String(firstSale.season || '').trim();
        const rawSessionLabel = String(firstSale.session_label || '').trim();
        const needsEnrichment = !rawSeason || !rawSessionLabel;
        const enriched = needsEnrichment ? resolveSessionMetadata(null) : null;
        const finalSeason = rawSeason || enriched?.season || '';

        let orgIsCoffee = false;
        try {
          const s = JSON.parse(localStorage.getItem('app_settings') || '{}');
          orgIsCoffee = s?.orgtype === 'C';
        } catch { /* ignore */ }

        const finalSessionLabel = orgIsCoffee
          ? (finalSeason || rawSessionLabel || enriched?.session_label || '')
          : (rawSessionLabel || enriched?.session_label || '');

        const batchRequest: BatchSaleRequest = {
          uploadrefno,
          transtype: 2,
          farmer_id: String(firstSale.farmer_id || '').replace(/^#/, '').trim(),
          farmer_name: String(firstSale.farmer_name || '').trim(),
          route: String(firstSale.route_tcode || firstSale.route || '').trim(),
          route_tcode: String(firstSale.route_tcode || '').trim(),
          user_id: String(firstSale.user_id || '').trim(),
          sold_by: String(firstSale.sold_by || '').trim(),
          device_fingerprint: deviceFingerprint,
          transdate: firstSale.transdate || (firstSale.sale_date ? firstSale.sale_date.split('T')[0] : undefined),
          transtime: firstSale.transtime,
          photo: firstSale.photo,
          season: finalSeason,
          session_label: finalSessionLabel,
          items: batchSales.map(sale => ({
            transrefno: sale.transrefno || '',
            item_code: String(sale.item_code || '').trim(),
            item_name: String(sale.item_name || '').trim(),
            quantity: Number(sale.quantity) || 0,
            price: Number(sale.price) || 0,
            transdate: sale.transdate || (sale.sale_date ? sale.sale_date.split('T')[0] : undefined),
            transtime: sale.transtime,
          })),
        };

        const result = await mysqlApi.sales.createBatch(batchRequest);

        if (result.success) {
          await cleanupBatchSales(batchSales);
          synced += batchSales.length;
          console.log(`[SUCCESS] Synced batch ${uploadrefno} (${batchSales.length} items)`);
        } else {
          const errorMsg = (result.error || result.message || '').toLowerCase();
          if (errorMsg.includes('duplicate') || errorMsg.includes('already exists') || errorMsg.includes('already synced')) {
            await cleanupBatchSales(batchSales);
            synced += batchSales.length;
            console.log(`[SKIP] Batch already synced (duplicate): ${uploadrefno}`);
          } else {
            failed += batchSales.length;
            console.warn(`[WARN] Batch sync failed for ${uploadrefno}: ${result.error || result.message || 'Unknown error'}`);
          }
        }
      } catch (error: any) {
        const errorMsg = (error?.message || '').toLowerCase();
        if (errorMsg.includes('duplicate') || errorMsg.includes('already exists') || errorMsg.includes('already synced')) {
          await cleanupBatchSales(batchSales);
          synced += batchSales.length;
        } else {
          failed += batchSales.length;
          console.error(`[ERROR] Batch sync exception for ${uploadrefno}:`, error);
        }
      }

      if (i < batchEntries.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Sync AI sales individually
    for (let i = 0; i < aiSales.length; i++) {
      const saleRecord = aiSales[i];

      if (typeof abortCheck === 'function' && abortCheck()) {
        console.warn(`[SYNC-ENGINE] Aborted at AI sale ${i + 1}/${aiSales.length}`);
        break;
      }

      console.log(`[SYNC-ENGINE] AI sale ${i + 1}/${aiSales.length}: ${saleRecord.transrefno || saleRecord.orderId}`);

      try {
        const rawSeason = String(saleRecord.season || '').trim();
        const rawSessionLabel = String(saleRecord.session_label || '').trim();
        const needsEnrichment = !rawSeason || !rawSessionLabel;
        const enriched = needsEnrichment ? resolveSessionMetadata(null) : null;
        const finalSeason = rawSeason || enriched?.season || '';
        let aiOrgIsCoffee = false;
        try {
          const s = JSON.parse(localStorage.getItem('app_settings') || '{}');
          aiOrgIsCoffee = s?.orgtype === 'C';
        } catch { /* ignore */ }
        const finalSessionLabel = aiOrgIsCoffee
          ? (finalSeason || rawSessionLabel || enriched?.session_label || '')
          : (rawSessionLabel || enriched?.session_label || '');

        const cleanSale: Sale = {
          farmer_id: String(saleRecord.farmer_id || '').replace(/^#/, '').trim(),
          farmer_name: String(saleRecord.farmer_name || '').trim(),
          item_code: String(saleRecord.item_code || '').trim(),
          item_name: String(saleRecord.item_name || '').trim(),
          quantity: Number(saleRecord.quantity) || 0,
          price: Number(saleRecord.price) || 0,
          route: String(saleRecord.route_tcode || saleRecord.route || '').trim(),
          user_id: String(saleRecord.user_id || '').trim(),
          sold_by: String(saleRecord.sold_by || '').trim(),
          device_fingerprint: deviceFingerprint,
          season: finalSeason,
          ...(saleRecord.transdate && { transdate: saleRecord.transdate }),
          ...(saleRecord.transtime && { transtime: saleRecord.transtime }),
          ...(saleRecord.sale_date && !saleRecord.transdate && { transdate: saleRecord.sale_date.split('T')[0] }),
          ...(finalSessionLabel && { session_label: finalSessionLabel }),
          ...(saleRecord.photo && { photo: saleRecord.photo }),
          ...(saleRecord.transrefno && { transrefno: saleRecord.transrefno }),
          ...(saleRecord.uploadrefno && { uploadrefno: saleRecord.uploadrefno }),
          ...(saleRecord.transtype && { transtype: saleRecord.transtype }),
          ...(saleRecord.route_tcode && { route_tcode: saleRecord.route_tcode }),
          ...(saleRecord.cow_name && { cow_name: saleRecord.cow_name }),
          ...(saleRecord.cow_breed && { cow_breed: saleRecord.cow_breed }),
          ...(saleRecord.number_of_calves && { number_of_calves: saleRecord.number_of_calves }),
          ...(saleRecord.other_details && { other_details: saleRecord.other_details }),
        };

        const success = await mysqlApi.sales.create(cleanSale);
        if (success) {
          await cleanupBatchSales([saleRecord]);
          synced++;
          console.log(`[SUCCESS] Synced AI ${saleRecord.transrefno || saleRecord.orderId}`);
        } else {
          failed++;
          console.warn(`[WARN] AI sync failed for ${saleRecord.transrefno || saleRecord.orderId}`);
        }
      } catch (error: any) {
        const errorMsg = (error?.message || '').toLowerCase();
        if (errorMsg.includes('duplicate') || errorMsg.includes('already exists') || errorMsg.includes('already synced')) {
          await cleanupBatchSales([saleRecord]);
          synced++;
        } else {
          failed++;
          console.error(`[ERROR] AI sync exception for ${saleRecord.transrefno || saleRecord.orderId}:`, error);
        }
      }

      if (i < aiSales.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[SYNC-ENGINE] Complete: ${synced} synced, ${failed} failed out of ${pendingSales.length} total`);
    return { synced, failed };
  } catch (error) {
    console.error('[SYNC-ENGINE] Fatal error:', error);
    return { synced, failed };
  } finally {
    isSalesSyncActive = false;
  }
};
