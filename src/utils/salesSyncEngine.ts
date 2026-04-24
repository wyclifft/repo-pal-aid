import { mysqlApi, type Sale, type BatchSaleRequest } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { resolveSessionMetadata } from '@/utils/sessionMetadata';
import {
  refreshCountersFromBackend,
  generateReferenceWithUploadRef,
  generateTransRefOnly,
} from '@/utils/referenceGenerator';

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
}

// v2.10.66: module-level guard — only refresh counters once per sync run to
// avoid hammering the snapshot endpoint when an entire batch collides.
let counterDriftHandledThisRun = false;

/**
 * Shared sales sync engine — used by both useDataSync (global) and useSalesSync (page-level).
 * Groups store items by uploadrefno for batch upload; syncs AI items individually.
 * Handles duplicate detection and cleanup.
 */
export const syncSalesFromDB = async (
  getUnsyncedSales: () => Promise<any[]>,
  deleteSale: (orderId: number) => Promise<void>,
  abortCheck?: () => boolean
): Promise<{ synced: number; failed: number }> => {
  let synced = 0;
  let failed = 0;

  // Reset per-run drift flag — allow one snapshot refresh per sync invocation
  counterDriftHandledThisRun = false;

  try {
    const allRecords = await getUnsyncedSales();
    const pendingSales: SaleRecord[] = allRecords.filter(
      (r: any) => r.type === 'sale' || r.type === 'ai'
    );

    if (pendingSales.length === 0) {
      return { synced: 0, failed: 0 };
    }

    console.log(`[SYNC-ENGINE] Starting sync of ${pendingSales.length} pending sales/AI transactions...`);
    const deviceFingerprint = await generateDeviceFingerprint();

    // v2.10.66: self-heal helper — on first duplicate detected this run,
    // pull true counters from backend so subsequent generations skip past
    // the colliding range.
    const handleCounterDrift = async (collidedRef: string) => {
      if (counterDriftHandledThisRun) return;
      counterDriftHandledThisRun = true;
      console.warn(`[COUNTER-DRIFT] Detected duplicate ${collidedRef} — refreshing counters from backend`);
      try {
        await refreshCountersFromBackend(deviceFingerprint);
      } catch (e) {
        console.warn('[COUNTER-DRIFT] refresh failed:', (e as Error)?.message);
      }
    };

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
        storeBatches[sale.uploadrefno].push(sale);
      } else {
        // No uploadrefno — sync individually
        aiSales.push(sale);
      }
    }

    const batchEntries = Object.entries(storeBatches);

    // Sync store batches (grouped by uploadrefno)
    for (let i = 0; i < batchEntries.length; i++) {
      const [uploadrefno, batchSales] = batchEntries[i];

      if (abortCheck?.()) {
        console.warn(`[SYNC-ENGINE] Aborted at batch ${i + 1}/${batchEntries.length}`);
        break;
      }

      console.log(`[SYNC-ENGINE] Batch ${i + 1}/${batchEntries.length}: ${uploadrefno} (${batchSales.length} items)`);

      try {
        const firstSale = batchSales[0];

        // Best-effort enrichment for legacy offline records that were saved
        // before v2.10.38 with empty session metadata.
        // v2.10.51: For coffee orgs, the backend `session` column must hold SCODE.
        const rawSeason = String(firstSale.season || '').trim();
        const rawSessionLabel = String(firstSale.session_label || '').trim();
        const needsEnrichment = !rawSeason || !rawSessionLabel;
        const enriched = needsEnrichment ? resolveSessionMetadata(null) : null;
        const finalSeason = rawSeason || enriched?.season || '';
        // Detect orgtype to choose the correct backend session value
        let orgIsCoffee = false;
        try {
          const s = JSON.parse(localStorage.getItem('app_settings') || '{}');
          orgIsCoffee = s?.orgtype === 'C';
        } catch { /* ignore */ }
        // Coffee → SCODE always; Dairy → descript label
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
          photo: firstSale.photo,
          season: finalSeason,
          session_label: finalSessionLabel,
          items: batchSales.map(sale => ({
            transrefno: sale.transrefno || '',
            item_code: String(sale.item_code || '').trim(),
            item_name: String(sale.item_name || '').trim(),
            quantity: Number(sale.quantity) || 0,
            price: Number(sale.price) || 0,
          })),
        };

        const result = await mysqlApi.sales.createBatch(batchRequest);

        if (result.success) {
          for (const sale of batchSales) {
            if (sale.orderId) {
              try { await deleteSale(sale.orderId); } catch (e) {
                console.warn(`[WARN] Failed to delete synced sale ${sale.orderId}:`, e);
              }
            }
          }
          synced += batchSales.length;
          console.log(`[SUCCESS] Synced batch ${uploadrefno} (${batchSales.length} items)`);
        } else {
          const errorMsg = (result.error || '').toLowerCase();
          if (errorMsg.includes('duplicate') || errorMsg.includes('already exists')) {
            // v2.10.66: collision likely means local counter is behind backend.
            // Refresh counters once per run, regenerate refs for THIS batch,
            // and retry once. Only treat as "already synced" after retry also
            // collides — that's the genuine idempotent case.
            await handleCounterDrift(uploadrefno);
            const retried = await retryBatchWithFreshRefs(batchRequest, batchSales, deviceFingerprint);
            if (retried.success) {
              for (const sale of batchSales) {
                if (sale.orderId) {
                  try { await deleteSale(sale.orderId); } catch (e) {
                    console.warn(`[WARN] Failed to delete synced sale ${sale.orderId}:`, e);
                  }
                }
              }
              synced += batchSales.length;
              console.log(`[SUCCESS] Recovered batch after counter-drift retry: ${retried.uploadrefno || uploadrefno}`);
            } else if (retried.stillDuplicate) {
              // Genuine idempotent — original batch was actually already synced
              for (const sale of batchSales) {
                if (sale.orderId) {
                  try { await deleteSale(sale.orderId); } catch (e) {
                    console.warn(`[WARN] Failed to delete duplicate sale ${sale.orderId}:`, e);
                  }
                }
              }
              synced += batchSales.length;
              console.log(`[SKIP] Batch already synced (verified duplicate): ${uploadrefno}`);
            } else {
              failed += batchSales.length;
              console.warn(`[WARN] Batch retry failed for ${uploadrefno}: ${retried.error || 'unknown'}`);
            }
          } else {
            failed += batchSales.length;
            console.warn(`[WARN] Batch sync failed for ${uploadrefno}: ${result.error || 'Unknown error'}`);
          }
        }
      } catch (error: any) {
        const errorMsg = (error?.message || '').toLowerCase();
        if (errorMsg.includes('duplicate') || errorMsg.includes('already exists')) {
          await handleCounterDrift(uploadrefno);
          const retried = await retryBatchWithFreshRefs(batchRequest, batchSales, deviceFingerprint);
          if (retried.success) {
            for (const sale of batchSales) {
              if (sale.orderId) {
                try { await deleteSale(sale.orderId); } catch (e) {
                  console.warn(`[WARN] Failed to delete synced sale ${sale.orderId}:`, e);
                }
              }
            }
            synced += batchSales.length;
          } else if (retried.stillDuplicate) {
            for (const sale of batchSales) {
              if (sale.orderId) {
                try { await deleteSale(sale.orderId); } catch (e) {
                  console.warn(`[WARN] Failed to delete duplicate sale ${sale.orderId}:`, e);
                }
              }
            }
            synced += batchSales.length;
          } else {
            failed += batchSales.length;
          }
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

      if (abortCheck?.()) {
        console.warn(`[SYNC-ENGINE] Aborted at AI sale ${i + 1}/${aiSales.length}`);
        break;
      }

      console.log(`[SYNC-ENGINE] AI sale ${i + 1}/${aiSales.length}: ${saleRecord.transrefno || saleRecord.orderId}`);

      try {
        // Best-effort enrichment for legacy offline AI records.
        // v2.10.51: Coffee orgs must send SCODE in the backend session column.
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
        if (success && saleRecord.orderId) {
          try { await deleteSale(saleRecord.orderId); } catch (e) {
            console.warn(`[WARN] Failed to delete synced AI sale ${saleRecord.orderId}:`, e);
          }
          synced++;
          console.log(`[SUCCESS] Synced AI ${saleRecord.transrefno || saleRecord.orderId}`);
        } else {
          failed++;
          console.warn(`[WARN] AI sync failed for ${saleRecord.transrefno || saleRecord.orderId}`);
        }
      } catch (error: any) {
        const errorMsg = (error?.message || '').toLowerCase();
        if (errorMsg.includes('duplicate') || errorMsg.includes('already exists')) {
          if (saleRecord.orderId) {
            try { await deleteSale(saleRecord.orderId); } catch (e) {
              console.warn(`[WARN] Failed to delete duplicate AI sale ${saleRecord.orderId}:`, e);
            }
          }
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
  }
};
