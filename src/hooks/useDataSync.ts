import { useState, useEffect, useCallback, useRef } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useSyncManager, deduplicateReceipts } from '@/hooks/useSyncManager';
import { useAuth } from '@/contexts/AuthContext';
import { useAppSettings } from '@/hooks/useAppSettings';
import { mysqlApi } from '@/services/mysqlApi';
import { farmerFrequencyApi } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { toast } from 'sonner';
import { 
  isNativeStorageAvailable, 
  markNativeRecordSynced, 
  markNativeRecordFailed 
} from '@/services/offlineStorage';
import { syncSalesFromDB } from '@/utils/salesSyncEngine';

// Batch processing configuration to prevent overwhelming system during bulk sync
const SYNC_BATCH_SIZE = 5; // v2.12.18: Reduced from 10 to stabilize backend pool
const SYNC_BATCH_DELAY_MS = 400; // v2.12.18: Increased from 200 for better pacing
const SYNC_RETRY_DELAY_MS = 2000; // Delay before retrying failed record

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
  const { isAuthenticated } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBlockingSync, setIsBlockingSync] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncSubCount, setSyncSubCount] = useState<number | undefined>(undefined);
  const [syncSubLabel, setSyncSubLabel] = useState<string | undefined>(undefined);

  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingMilkCount, setPendingMilkCount] = useState(0);
  const [pendingSalesCount, setPendingSalesCount] = useState(0);
  // v2.10.60: count of receipts the sync engine has refused to upload
  // because of DUPLICATE_SESSION_DELIVERY (multOpt=0). These rows are
  // intentionally KEPT in IndexedDB for human review.
  const [conflictedReceiptsCount, setConflictedReceiptsCount] = useState(0);
  // Member sync state for banner display
  const [isSyncingMembers, setIsSyncingMembers] = useState(false);
  const [memberSyncCount, setMemberSyncCount] = useState(0);
  // Offline-first mode from psettings.online
  const [offlineFirstMode, setOfflineFirstMode] = useState(getOfflineFirstMode);
  const mountedRef = useRef(true);
  const periodicSyncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncInProgressRef = useRef(false); // Extra guard against concurrent syncs
  const lastPendingUpdateRef = useRef<number>(0); // v2.12.39: Debounce for updatePendingCount

  const { 
    saveFarmers, 
    saveItems, 
    saveZReport, 
    savePeriodicReport,
    saveRoutes,
    saveSessions,
    getUnsyncedReceipts,
    getUnsyncedSales,
    deleteReceipt,
    markReceiptSynced,
    deleteSale,
    getAllUnsyncedRecords,
    updateFarmerCumulative,
    bumpFarmerCumulativeBase,
    batchUpdateFarmerCumulative,
    getFarmerCumulative,


    isReady 
  } = useIndexedDB();

  const { acquireLock, releaseLock, registerOnlineHandler } = useSyncManager();
  const { refreshSettings, useCumulativeRouteFilter } = useAppSettings();

  /**
   * v2.12.36: Effective route code for cumulative calculations based on settings.
   */
  const getCumulativeRoute = useCallback((route?: string) => {
    return useCumulativeRouteFilter ? route : undefined;
  }, [useCumulativeRouteFilter]);

  /**
   * v2.12.21: Internal helper to fetch a cumulative batch and save it to strict buckets.
   */
  const fetchAndSaveCumulativeBatch = useCallback(async (
    fingerprint: string,
    route?: string,
    season?: string,
    isBlocking = false
  ) => {
    let batchResult: any = null;
    let retryCount = 0;
    const MAX_RETRIES = isBlocking ? 3 : 1;

    // v2.12.36: Respect cumulative route filter setting
    const effectiveRoute = getCumulativeRoute(route);

    console.log(`[SYNC] Fetching batch for route=${effectiveRoute || 'ALL'} season=${season || 'ACTIVE'}`);

    while (retryCount < MAX_RETRIES) {
      batchResult = await mysqlApi.farmerFrequency.getMonthlyFrequencyBatch(fingerprint, effectiveRoute, season);
      if ((batchResult?.pending || batchResult?.data?.pending) && isBlocking) {
        console.log(`[SYNC] Batch pending, retrying in 3s... (${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, 3000));
        retryCount++;
        continue;
      }
      break;
    }

    if (batchResult?.success && batchResult.data?.farmers?.length) {
      const batchFarmers = batchResult.data.farmers;
      // Derived from backend response or fallback to current month
      const monthOverride = batchResult.data.month_start
        ? batchResult.data.month_start.substring(0, 7) // "YYYY-MM"
        : undefined;

      const WRITE_BATCH = 100; // v2.12.39: Increased from 50 due to batch transaction optimization
      for (let i = 0; i < batchFarmers.length; i += WRITE_BATCH) {
        const wb = batchFarmers.slice(i, i + WRITE_BATCH);
        try {
          await batchUpdateFarmerCumulative(wb.map((f: any) => ({
            farmerId: f.farmer_id.trim(),
            count: f.cumulative_weight,
            fromBackend: true,
            byProduct: f.by_product || [],
            route: effectiveRoute,
            scode: season,
            options: { monthOverride, verifySource: 'W3:exhaustive-sync' }
          })));
        } catch (err) {
          console.warn('[SYNC] Batch update failed, falling back to individual updates:', err);
          await Promise.all(wb.map(async (f: any) => {
            try {
              await updateFarmerCumulative(
                f.farmer_id.trim(),
                f.cumulative_weight,
                true,
                f.by_product || [],
                effectiveRoute,
                season,
                { monthOverride, verifySource: 'W3:exhaustive-sync', skipVerify: true }
              );
            } catch {}
          }));
        }
      }
      console.log(`[SUCCESS] Synced totals for ${batchFarmers.length} farmers (route=${effectiveRoute || 'ALL'} season=${season || 'ACTIVE'})`);
      return batchFarmers.length;
    }
    return 0;
  }, [updateFarmerCumulative, getCumulativeRoute]);

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

  // Track in-flight syncs to prevent duplicate API calls for the same receipt
  const inFlightSyncsRef = useRef<Set<string>>(new Set());

  /**
   * v2.12.17: Fast & Safe Sync Engine.
   * Processes a single offline receipt with all safety guards.
   */
  const processReceiptSync = useCallback(async (
    receipt: any,
    index: number,
    total: number,
    deviceFingerprint: string,
    useNativeStorage: boolean,
    recordConflict: any
  ): Promise<{ success: boolean; conflict?: boolean }> => {
    // Check if component is still mounted
    if (!mountedRef.current) return { success: false };

    console.log(`[SYNC] Processing ${index + 1}/${total}: ${receipt.reference_no}`);

    let normalizedSession: string = 'AM';
    try {
      // v2.10.51: Coffee orgs → send SCODE as session value (NEVER AM/PM).
      const orgIsCoffee = (() => {
        try {
          const s = JSON.parse(localStorage.getItem('app_settings') || '{}');
          return s?.orgtype === 'C';
        } catch { return false; }
      })();

      if (orgIsCoffee) {
        normalizedSession = String(receipt.season_code || receipt.session || '').trim();
      } else {
        const sessionVal = String(receipt.session || '').trim().toUpperCase();
        normalizedSession = (sessionVal === 'PM' || sessionVal.includes('PM') || sessionVal.includes('EVENING') || sessionVal.includes('AFTERNOON')) ? 'PM' : 'AM';
      }

      // Client-side FINAL GUARD for multOpt=0 during background sync
      if (receipt.multOpt === 0) {
        const cd = new Date(receipt.collection_date);
        const receiptDate = `${cd.getFullYear()}-${String(cd.getMonth() + 1).padStart(2, '0')}-${String(cd.getDate()).padStart(2, '0')}`;
        try {
          const cleanFarmerId = String(receipt.farmer_id || '').replace(/^#/, '').trim();
          const existing = await mysqlApi.milkCollection.getByFarmerSessionDate(
            cleanFarmerId,
            normalizedSession,
            receiptDate,
            receiptDate,
            deviceFingerprint
          );

          if (existing) {
            const existingUploadRef = (existing as any)?.uploadrefno;
            const incomingUploadRef = (receipt as any)?.uploadrefno;

            if (
              incomingUploadRef &&
              existingUploadRef &&
              String(incomingUploadRef) === String(existingUploadRef)
            ) {
              console.log(`[SYNC] multOpt=0: uploadrefno matches (${incomingUploadRef}); proceeding: ${receipt.reference_no}`);
            } else {
              console.warn(`[SYNC] DUPLICATE_SESSION_DELIVERY (frontend guard): farmer=${cleanFarmerId} session=${normalizedSession} date=${receiptDate}; Keeping local row: ${receipt.reference_no}`);
              if (useNativeStorage) {
                await markNativeRecordFailed(
                  receipt.reference_no,
                  `DUPLICATE_SESSION_DELIVERY: server already has uploadrefno=${existingUploadRef}`
                );
              }
              recordConflict(cleanFarmerId, normalizedSession, receiptDate, receipt.reference_no, String(existingUploadRef || ''));
              return { success: false, conflict: true };
            }
          }
        } catch (checkErr) {
          console.warn('[SYNC] Duplicate check failed, proceeding with sync:', checkErr);
        }
      }

      const result = await mysqlApi.milkCollection.create({
        reference_no: receipt.reference_no,
        uploadrefno: receipt.uploadrefno,
        farmer_id: String(receipt.farmer_id || '').replace(/^#/, '').trim(),
        farmer_name: String(receipt.farmer_name || '').trim(),
        route: String(receipt.route || '').trim(),
        session: normalizedSession,
        weight: receipt.weight,
        user_id: receipt.user_id,
        clerk_name: receipt.clerk_name,
        collection_date: receipt.collection_date,
        device_fingerprint: deviceFingerprint,
        entry_type: receipt.entry_type,
        product_code: receipt.product_code,
        season_code: receipt.season_code,
        transtype: receipt.transtype,
        delivered_by: receipt.delivered_by,
      });

      console.log(`[SYNC] RESPONSE for ${receipt.reference_no}: success=${result.success}`, result.error || '');

      // Handle REFERENCE_COLLISION
      if (!result.success && (result as any).collision) {
        console.warn(`[SYNC] Reference collision for ${receipt.reference_no}, requesting authoritative ref from backend...`);
        try {
          const { syncOfflineCounter, generateOfflineReference } = await import('@/utils/referenceGenerator');
          let newRef: string | null = null;
          try {
            const nextRefResp = await mysqlApi.milkCollection.getNextReference(deviceFingerprint);
            const backendRef = (nextRefResp.data?.reference_no || '').trim();
            if (backendRef) {
              newRef = backendRef;
              const devcode = localStorage.getItem('devcode') || '';
              const trnidTail = parseInt(backendRef.slice(-8), 10) || 0;
              if (devcode && trnidTail > 0) {
                try { await syncOfflineCounter(devcode, trnidTail); } catch {}
              }
            }
          } catch (refErr) {
            console.warn('[SYNC] Backend next-reference failed, falling back to local:', refErr);
          }
          if (!newRef) newRef = await generateOfflineReference();

          if (newRef) {
            console.log(`[SYNC] Retrying with new reference: ${newRef} (was: ${receipt.reference_no})`);
            const retryResult = await mysqlApi.milkCollection.create({
              ...receipt,
              reference_no: newRef,
              session: normalizedSession,
              device_fingerprint: deviceFingerprint,
              farmer_id: String(receipt.farmer_id || '').replace(/^#/, '').trim(),
            });
            if (retryResult.success) {
              // Refresh cumulative
              try {
                const cleanFarmerId = String(receipt.farmer_id || '').replace(/^#/, '').trim();
                const routeForRefresh = String(receipt.route || '').trim();
                const seasonForRefresh = String(receipt.season_code || '').trim();
                let cloudCumulative = (retryResult as any)?.cumulative_weight;
                let cloudByProduct = (retryResult as any)?.by_product;

                if (cloudCumulative !== undefined) {
                  const freshByProduct = (cloudByProduct || []).map((p: any) => ({
                    icode: String(p.icode || '').trim().toUpperCase(),
                    product_name: String(p.product_name || p.icode || ''),
                    weight: Number(p.weight) || 0,
                  }));
                  // v2.12.36: Respect cumulative route filter setting
                  const effectiveRoute = getCumulativeRoute(routeForRefresh);
                  await updateFarmerCumulative(cleanFarmerId, Number(cloudCumulative), true, freshByProduct, effectiveRoute, seasonForRefresh || undefined, { transrefno: newRef, verifySource: 'W2:collision-retry' });
                }
              } catch {}
              if (useNativeStorage) {
                const normRef = (receipt.reference_no || '').trim().toUpperCase();
                console.log(`[SYNC] Mark native synced (COLLISION RETRY SUCCESS): ${normRef}`);
                await markNativeRecordSynced(normRef);
              }
              if (receipt.orderId && typeof receipt.orderId === 'number') {
                try { await markReceiptSynced(receipt.orderId); } catch {}
              }
              return { success: true };
            }
          }
        } catch (retryErr) {
          console.error(`[ERROR] Collision retry failed:`, retryErr);
        }
        return { success: false };
      }

      if (result.success) {
        // v2.12.26: SUCCESS path. We MUST delete the local row to drop the
        // pending count, regardless of whether auxiliary tasks succeed.

        // 1. Mark native storage (Non-blocking backup)
        if (useNativeStorage) {
          try {
            // v2.12.32: Ensure we pass a numeric backendId if available,
            // but the referenceNo is the primary key for clearing records.
            const backendId = Number((result as any).backend_id || (result as any).id) || undefined;
            const refNo = (receipt.reference_no || (receipt as any).transrefno || '').trim().toUpperCase();
            if (refNo) {
              console.log(`[SYNC] Mark native synced (SUCCESS): ${refNo} (backend_id=${backendId})`);
              await markNativeRecordSynced(refNo, backendId);
            }
          } catch (natErr) {
            console.warn(`[SYNC] Native mark synced failed:`, natErr);
          }
        }

        // 2. Update cumulative cache (Authoritative from POST response or optimistic fallback)
        try {
          const cleanFarmerId = String(receipt.farmer_id || '').replace(/^#/, '').trim();
          const routeForRefresh = String(receipt.route || '').trim();
          const seasonForRefresh = String(receipt.season_code || '').trim();

          // Use authoritative data from POST response if available
          let cloudCumulative = (result as any)?.cumulative_weight;
          let cloudByProduct = (result as any)?.by_product;

            if (cloudCumulative !== undefined) {
              const freshByProduct = (cloudByProduct || []).map((p: any) => ({
                icode: String(p.icode || '').trim().toUpperCase(),
                product_name: String(p.product_name || p.icode || ''),
                weight: Number(p.weight) || 0,
              }));
              // v2.12.36: Respect cumulative route filter setting
              const effectiveRoute = getCumulativeRoute(routeForRefresh);
              await updateFarmerCumulative(cleanFarmerId, Number(cloudCumulative), true, freshByProduct, effectiveRoute, seasonForRefresh || undefined, { transrefno: receipt.reference_no, verifySource: 'W1:postsync-update' });
            } else {
              // v2.12.31: If backend didn't return cumulative (e.g. idempotent retry on old backend),
              // use optimistic carry-over to prevent the total from dropping when we delete the local row.
              // v2.12.36: Respect cumulative route filter setting
              const effectiveRoute = getCumulativeRoute(routeForRefresh);
              await bumpFarmerCumulativeBase(
                cleanFarmerId,
                Number(receipt.weight),
                receipt.product_code,
                effectiveRoute,
                seasonForRefresh || undefined,
                { transrefno: receipt.reference_no, reason: 'idempotent-success-carryover' }
              );
            }
        } catch (cumErr) {
          // Non-critical
        }

      // 3. CRITICAL: Delete from IndexedDB to drop pending count
        // v2.12.30: Cleanup all zombie duplicates for this reference in IndexedDB
        try {
          const normRef = (receipt.reference_no || '').trim().toUpperCase();
          const rawLocal = await getUnsyncedReceipts();
          const duplicates = rawLocal.filter(r => (r.reference_no || '').trim().toUpperCase() === normRef);

          for (const d of duplicates) {
            if (d.orderId && typeof d.orderId === 'number') {
              await markReceiptSynced(d.orderId);
            }
          }
          console.log(`[SYNC] SUCCESS: Deleted ${duplicates.length} local records for ${receipt.reference_no}`);

          // v2.12.35: Post-sync verification
          const stillUnsynced = await getUnsyncedReceipts();
          const stillFound = stillUnsynced.some(r => (r.reference_no || '').trim().toUpperCase() === normRef);
          if (stillFound) {
            console.warn(`[SYNC] [VERIFY] ${receipt.reference_no} STILL in IndexedDB after delete!`);
          } else {
            console.log(`[SYNC] [VERIFY] ${receipt.reference_no} verified removed from IndexedDB.`);
          }

          if (useNativeStorage) {
            const { getUnsyncedFromLocalDB } = await import('@/services/offlineStorage');
            const nativeRecords = await getUnsyncedFromLocalDB('milk_collection');
            const nativeFound = nativeRecords.some(r => (r.referenceNo || '').trim().toUpperCase() === normRef);
            if (nativeFound) {
              console.warn(`[SYNC] [VERIFY] ${receipt.reference_no} STILL in Native DB after markSynced!`);
            } else {
              console.log(`[SYNC] [VERIFY] ${receipt.reference_no} verified removed from Native DB.`);
            }
          }
        } catch (delErr) {
          console.error(`[SYNC] Failed to delete record ${receipt.reference_no} from IDB`, delErr);
        }
        return { success: true };
      } else {
        // Handle explicit error responses
        const errorMsg = (result.error || result.message || '').toLowerCase();
        const errorCode = String((result as any).error || (result as any).code || '').toUpperCase();

        // v2.12.35: Broadened idempotent detection (error + message + 'idempotent' keyword)
        const combinedMsg = `${errorCode} ${errorMsg}`.toLowerCase();
        const isIdempotent = combinedMsg.includes('duplicate') ||
                            combinedMsg.includes('already exists') ||
                            combinedMsg.includes('idempotent') ||
                            errorCode === 'ER_DUP_ENTRY' ||
                            !!result.existing_reference;

        // v2.12.33: TIMEOUT RECOVERY. If the request timed out, the server may
        // have actually processed the record. Try to verify existence before giving up.
        const isTimeout = combinedMsg.includes('timed out') || combinedMsg.includes('request timed out');
        if (isTimeout) {
          console.log(`[SYNC] Timeout detected for ${receipt.reference_no}. Attempting authoritative verify...`);
          try {
            const verifyResult = await mysqlApi.milkCollection.getByReference(receipt.reference_no);
            if (verifyResult) {
              console.log(`[SYNC] Authoritative verify SUCCESS: ${receipt.reference_no} found on server. Proceeding with cleanup.`);

              // 1. Clean up native storage
              if (useNativeStorage) {
                try {
                  const backendId = (verifyResult as any).ID || (verifyResult as any).id;
                  await markNativeRecordSynced(receipt.reference_no, Number(backendId) || undefined);
                } catch {}
              }

              // 2. Refresh cumulative for this farmer (prevent drop to 0)
              try {
                const cleanFarmerId = String(receipt.farmer_id || '').replace(/^#/, '').trim();
                const routeForRefresh = String(receipt.route || '').trim();
                const seasonForRefresh = String(receipt.season_code || '').trim();
                // v2.12.36: Respect cumulative route filter setting
                const effectiveRoute = getCumulativeRoute(routeForRefresh);
                await bumpFarmerCumulativeBase(cleanFarmerId, Number(receipt.weight), receipt.product_code, effectiveRoute, seasonForRefresh, { transrefno: receipt.reference_no, reason: 'post-timeout-verify-carryover' });
              } catch {}

              // 3. Delete from IndexedDB
              if (receipt.orderId && typeof receipt.orderId === 'number') {
                try { await markReceiptSynced(receipt.orderId); } catch {}
              }
              return { success: true };
            } else {
              console.warn(`[SYNC] Post-timeout verify FAILED: ${receipt.reference_no} not found on server.`);
            }
          } catch (vErr) {
            console.warn(`[SYNC] Post-timeout verify exception for ${receipt.reference_no}`);
          }
        }

        if (errorCode === 'DUPLICATE_SESSION_DELIVERY' || combinedMsg.includes('session delivery')) {
          recordConflict(String(receipt.farmer_id).replace(/^#/, '').trim(), normalizedSession, new Date(receipt.collection_date).toISOString().split('T')[0], receipt.reference_no);
          return { success: false, conflict: true };
        } else if (isIdempotent) {
          // Idempotent recovery for duplicates already on server
          console.log(`[SYNC] IDEMPOTENT success: ${receipt.reference_no} confirmed on server (combinedMsg="${combinedMsg}").`);

          // v2.12.36: Respect cumulative route filter setting
          const effectiveRoute = getCumulativeRoute(String(receipt.route));
          await bumpFarmerCumulativeBase(
            String(receipt.farmer_id).replace(/^#/, '').trim(),
            Number(receipt.weight),
            receipt.product_code,
            effectiveRoute,
            String(receipt.season_code),
            { transrefno: receipt.reference_no, reason: 'idempotent-recovery' }
          );

          // v2.12.35: Normalize reference for Native Storage sync marking
          const normRef = (receipt.reference_no || '').trim().toUpperCase();
          if (useNativeStorage) {
            console.log(`[SYNC] Mark native synced (idempotent): ${normRef}`);
            await markNativeRecordSynced(normRef);
          }

          // v2.12.30: Even for idempotent success, cleanup all zombie duplicates
          try {
            const rawLocal = await getUnsyncedReceipts();
            const duplicates = rawLocal.filter(r => (r.reference_no || '').trim().toUpperCase() === normRef);
            for (const d of duplicates) {
              if (d.orderId && typeof d.orderId === 'number') {
                await markReceiptSynced(d.orderId);
              }
            }
            console.log(`[SYNC] IDEMPOTENT: Cleaned up ${duplicates.length} local records for ${receipt.reference_no}`);

            // Post-sync verification
            const stillUnsynced = await getUnsyncedReceipts();
            const stillFound = stillUnsynced.some(r => (r.reference_no || '').trim().toUpperCase() === normRef);
            if (stillFound) {
              console.warn(`[SYNC] [VERIFY] ${receipt.reference_no} STILL in IDB after idempotent cleanup!`);
            } else {
              console.log(`[SYNC] [VERIFY] ${receipt.reference_no} verified removed from IDB (idempotent path).`);
            }

            if (useNativeStorage) {
              const { getUnsyncedFromLocalDB } = await import('@/services/offlineStorage');
              const nativeRecords = await getUnsyncedFromLocalDB('milk_collection');
              const nativeFound = nativeRecords.some(r => (r.referenceNo || '').trim().toUpperCase() === normRef);
              if (nativeFound) {
                console.warn(`[SYNC] [VERIFY] ${receipt.reference_no} STILL in Native DB after idempotent markSynced!`);
              } else {
                console.log(`[SYNC] [VERIFY] ${receipt.reference_no} verified removed from Native DB (idempotent path).`);
              }
            }
          } catch (delErr) {
            console.error(`[SYNC] Failed to cleanup idempotent record ${receipt.reference_no}`, delErr);
          }

          return { success: true };
        }
        return { success: false };
      }
    } catch (err) {
      console.error(`[SYNC] Exception for ${receipt.reference_no}:`, err);

      // v2.12.27: TIMEOUT RECOVERY. If the request timed out, the server may
      // have actually processed the record. Try to verify existence before giving up.
      const isTimeout = String(err).includes('timed out') || String(err).includes('Request timed out');
      if (isTimeout) {
        console.log(`[SYNC] Timeout detected for ${receipt.reference_no}. Attempting authoritative verify...`);
        try {
          const verifyResult = await mysqlApi.milkCollection.getByReference(receipt.reference_no);
          if (verifyResult) {
            console.log(`[SYNC] Authoritative verify SUCCESS: ${receipt.reference_no} found on server. Proceeding with cleanup.`);

            // Clean up native storage
            if (useNativeStorage) {
              try { await markNativeRecordSynced(receipt.reference_no); } catch {}
            }

            // Mark as synced in IndexedDB
            if (receipt.orderId && typeof receipt.orderId === 'number') {
              try { await markReceiptSynced(receipt.orderId); } catch {}
            }
            return { success: true };
          }
        } catch (vErr) {
          console.warn(`[SYNC] Post-timeout verify failed for ${receipt.reference_no}`);
        }
      }

      return { success: false };
    } finally {
      if (receipt.reference_no) inFlightSyncsRef.current.delete(receipt.reference_no);
    }
  }, [updateFarmerCumulative, markReceiptSynced, bumpFarmerCumulativeBase]);

  // Sync offline receipts TO backend with deduplication and batch processing
  // In offline-first mode (online=1), this is only triggered manually or on explicit sync
  // In background sync mode (online=0), this runs automatically
  // CRITICAL: Ensures NO DATA LOSS for OrgType C and D
  const syncOfflineReceipts = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (!isReady || !navigator.onLine) {
      console.log('[SYNC] Sync skipped: not ready or offline');
      return { synced: 0, failed: 0 };
    }

    // Extra guard against concurrent sync operations
    if (syncInProgressRef.current) {
      console.log('[SYNC] Sync already in progress, skipping');
      return { synced: 0, failed: 0 };
    }
    syncInProgressRef.current = true;

    let synced = 0;
    let failed = 0;
    const useNativeStorage = isNativeStorageAvailable();
    const conflictKeysToasted = new Set<string>();
    const conflictKeysSeen = new Set<string>();

    const recordConflict = (
      farmerId: string,
      sessionVal: string,
      dateVal: string,
      localRef: string,
      remoteUploadRef?: string
    ) => {
      const key = `${farmerId}|${sessionVal}|${dateVal}`;
      conflictKeysSeen.add(key);
      if (!conflictKeysToasted.has(key)) {
        conflictKeysToasted.add(key);
        toast.error(`Farmer ${farmerId} already has a synced delivery for ${sessionVal} on ${dateVal}.`, { duration: 8000 });

        // v2.12.41: Dispatch event to update session blacklist in real-time
        window.dispatchEvent(new CustomEvent('duplicateDetected', {
          detail: { farmerId, session: sessionVal, date: dateVal }
        }));
      }
    };

    try {
      const rawReceipts = await getUnsyncedReceipts();
      console.log(`[SYNC] Raw receipts from IDB: ${rawReceipts.length}`);

      // v2.12.30: Fetch native records to ensure nothing is missed
      let nativeReceipts: any[] = [];
      if (useNativeStorage) {
        try {
          const { getUnsyncedFromLocalDB } = await import('@/services/offlineStorage');
          const nativeRaw = await getUnsyncedFromLocalDB('milk_collection');
          console.log(`[SYNC] Native raw records: ${nativeRaw.length}`);
          // Map native format to what processReceiptSync expects
          nativeReceipts = nativeRaw.map(r => ({
            ...JSON.parse(r.payload),
            reference_no: r.referenceNo,
            fromNative: true, // Mark as native source
          }));
        } catch (natErr) {
          console.warn('[SYNC] Failed to fetch native records for sync:', natErr);
        }
      }

      // Combine and filter
      const combined = [...rawReceipts, ...nativeReceipts];
      console.log(`[SYNC] Combined total: ${combined.length}`);

      const validReceipts = combined.filter((r: any) => {
        if (r.orderId === 'PRINTED_RECEIPTS') return false;
        if (r.type === 'sale') return false;
        if (!r.reference_no || !r.farmer_id || !r.weight) {
          console.log(`[SYNC] Filtering out invalid record: ${r?.reference_no || 'no-ref'} (fId=${!!r?.farmer_id}, w=${!!r?.weight})`);
          return false;
        }
        if (inFlightSyncsRef.current.has(r.reference_no)) return false;
        return true;
      });
      
      const unsyncedReceipts = deduplicateReceipts(validReceipts);
      console.log(`[SYNC] Final unsynced queue: ${unsyncedReceipts.length}`);

      if (unsyncedReceipts.length === 0) {
        if (mountedRef.current) setPendingCount(0);
        syncInProgressRef.current = false;
        return { synced: 0, failed: 0 };
      }

      console.log(`[SYNC] Starting FAST-SYNC of ${unsyncedReceipts.length} receipts...`);
      window.dispatchEvent(new CustomEvent('syncStart'));
      const deviceFingerprint = await generateDeviceFingerprint();
      
      unsyncedReceipts.forEach(r => r.reference_no && inFlightSyncsRef.current.add(r.reference_no));
      
      const BATCH_SIZE = SYNC_BATCH_SIZE;
      const totalBatches = Math.ceil(unsyncedReceipts.length / BATCH_SIZE);

      console.log(`[SYNC] Starting sync in ${totalBatches} batches of ${BATCH_SIZE}`);

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        if (!mountedRef.current) break;

        const batch = unsyncedReceipts.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);
        console.log(`[SYNC] Batch ${batchIndex + 1}/${totalBatches} (${batch.length} parallel requests)`);

        // Execute batch in parallel
        const results = await Promise.allSettled(
          batch.map((receipt, i) => {
            const source = receipt.fromNative ? 'native' : 'idb';
            console.log(`[SYNC] UPLOAD ATTEMPTED [${batchIndex * BATCH_SIZE + i + 1}/${unsyncedReceipts.length}]: ${receipt.reference_no} (source=${source})`);
            return processReceiptSync(
              receipt,
              batchIndex * BATCH_SIZE + i,
              unsyncedReceipts.length,
              deviceFingerprint,
              useNativeStorage,
              recordConflict
            );
          })
        );

        results.forEach(res => {
          if (res.status === 'fulfilled' && res.value.success) {
            synced++;
          } else {
            failed++;
          }
        });

        if (batchIndex < totalBatches - 1) {
          // v2.12.18: Add random jitter to pacing to prevent "thundering herd"
          const jitter = Math.floor(Math.random() * 300);
          await new Promise(resolve => setTimeout(resolve, SYNC_BATCH_DELAY_MS + jitter));
        }
      }

      window.dispatchEvent(new CustomEvent('syncComplete', { detail: { synced } }));

      if (mountedRef.current) {
        // v2.12.26: Always refresh actual count from DB instead of using local 'failed' counter.
        // This ensures the dashboard stays accurate regardless of loop early-exits.
        await updatePendingCount(true);
        setConflictedReceiptsCount(conflictKeysSeen.size);
      }
      
      console.log(`[SYNC] Sync complete: ${synced} synced out of ${unsyncedReceipts.length} total`);
      return { synced, failed };
    } catch (err) {
      console.error('[SYNC] Fatal sync error:', err);
      return { synced, failed };
    } finally {
      syncInProgressRef.current = false;
      inFlightSyncsRef.current.clear();
    }
  }, [isReady, getUnsyncedReceipts, deleteReceipt, processReceiptSync]);

  // Update pending count - split into milk + store/AI sales
  const updatePendingCount = useCallback(async (force = false) => {
    if (!isReady) return;

    // v2.12.39: Debounce bridge-heavy count updates (min 2s between calls)
    // to keep UI responsive on legacy WebViews during rapid events.
    const now = Date.now();
    if (!force && (now - lastPendingUpdateRef.current < 2000)) {
      return;
    }
    lastPendingUpdateRef.current = now;

    try {
      const unsynced = await getUnsyncedReceipts();
      // Filter out non-receipt entries and sales (sales counted separately)
      const receiptsOnly = unsynced.filter((r: any) => {
        if (r.type === 'sale') return false;
        return true;
      });
      
      // Also count pending store/AI sales
      const unsyncedSales = await getUnsyncedSales();
      const salesCount = unsyncedSales.length;

      // v2.12.30: Include native storage records in the count to surface discrepancies
      let nativeMilkCount = 0;
      let nativeSalesCount = 0;
      if (isNativeStorageAvailable()) {
        try {
          const { getUnsyncedFromLocalDB } = await import('@/services/offlineStorage');
          const nativeMilk = await getUnsyncedFromLocalDB('milk_collection');
          const nativeSales = await getUnsyncedFromLocalDB('store_sale');
          const nativeAI = await getUnsyncedFromLocalDB('ai_sale');

          // v2.12.35: Normalize reference number check for discrepancy count
          const idbRefs = new Set(receiptsOnly.map(r => (r.reference_no || '').trim().toUpperCase()));
          const idbSaleRefs = new Set(unsyncedSales.map(r => (r.transrefno || r.reference_no || '').trim().toUpperCase()));

          nativeMilkCount = nativeMilk.filter(r => !idbRefs.has((r.referenceNo || '').trim().toUpperCase())).length;
          nativeSalesCount = nativeSales.filter(r => !idbSaleRefs.has((r.referenceNo || '').trim().toUpperCase())).length +
                             nativeAI.filter(r => !idbSaleRefs.has((r.referenceNo || '').trim().toUpperCase())).length;

          if (nativeMilkCount > 0 || nativeSalesCount > 0) {
            console.log(`[STORAGE] Discrepancy found: Native has ${nativeMilkCount} milk and ${nativeSalesCount} sales NOT in IndexedDB`);
          }
        } catch (natErr) {
          console.warn('[STORAGE] Failed to fetch native counts:', natErr);
        }
      }

      if (mountedRef.current) {
        const totalPending = receiptsOnly.length + salesCount + nativeMilkCount + nativeSalesCount;
        console.log(`[SYNC] Pending Count Update: total=${totalPending} (milk=${receiptsOnly.length + nativeMilkCount}, sales=${salesCount + nativeSalesCount})`);

        setPendingCount(totalPending);
        setPendingMilkCount(receiptsOnly.length + nativeMilkCount);
        setPendingSalesCount(salesCount + nativeSalesCount);

        // AUTO-SYNC TRIGGER: If we found pending records and we're online and not already syncing
        if (
          totalPending > 0 &&
          navigator.onLine &&
          isAuthenticated &&
          !isSyncing && // Check the state instead of just the ref for React safety
          !syncInProgressRef.current &&
          !offlineFirstMode
        ) {
          console.log(`[SYNC] PENDING DETECTED (${totalPending} records) → auto-sync starting...`);
          // Trigger background sync - non-blocking to avoid recursion issues
          window.dispatchEvent(new CustomEvent('triggerAutoSync', { detail: { source: 'auto-trigger' } }));
        }
      }
    } catch (err) {
      console.error('Pending count error:', err);
    }
  }, [isReady, getUnsyncedReceipts, getUnsyncedSales, isAuthenticated, offlineFirstMode, isSyncing]);

  const syncAllData = useCallback(async (silent = false, forceBlocking = false) => {
    console.log('[SYNC] syncAllData start. Silent:', silent, 'Blocking:', forceBlocking);
    // Use global lock to prevent concurrent syncs
    if (!acquireLock()) {
      console.log('[SYNC] Could not acquire lock, sync already in progress');
      if (!silent) toast.info('Sync already in progress');
      return false;
    }

    if (!navigator.onLine) {
      console.log('[SYNC] Offline detected in syncAllData');
      releaseLock();
      if (!silent) toast.info('Working offline');
      await updatePendingCount(true);
      return false;
    }

    if (!isReady) {
      console.log('[SYNC] IndexedDB not ready in syncAllData');
      releaseLock();
      return false;
    }

    console.log('[SYNC] Proceeding with syncAllData');
    if (mountedRef.current) {
      setIsSyncing(true);
      if (forceBlocking) {
        setIsBlockingSync(true);
        setSyncProgress(0);
        setSyncStatus('Starting Sync...');
      }
    }

    let syncedCount = 0;
    let hasAuthError = false;

    try {
      const deviceFingerprint = await generateDeviceFingerprint();
      console.log('[SYNC] Device fingerprint generated:', deviceFingerprint);

      // 1. Sync offline receipts first (CRITICAL: Upload phase)
      if (forceBlocking) setSyncStatus('Uploading Receipts...');
      const offlineSync = await syncOfflineReceipts();
      console.log('[SYNC] Offline sync result:', offlineSync);
      if (offlineSync.synced > 0 && !silent) {
        toast.success(`Synced ${offlineSync.synced} collection${offlineSync.synced !== 1 ? 's' : ''}`);
      }
      if (forceBlocking) setSyncProgress(15);

      // 1b. Sync pending store/AI sales
      if (forceBlocking) setSyncStatus('Uploading Sales...');
      try {
        const salesSync = await syncSalesFromDB(getUnsyncedSales, deleteSale);
        console.log('[SYNC] Sales sync result:', salesSync);
        if (salesSync.synced > 0 && !silent) {
          toast.success(`Synced ${salesSync.synced} offline sale${salesSync.synced !== 1 ? 's' : ''}`);
        }
      } catch (err) {
        console.warn('[SYNC] Sales sync skipped:', err);
      }
      if (forceBlocking) setSyncProgress(25);

      // 1c. Refresh Company Settings
      if (forceBlocking) setSyncStatus('Refreshing Settings...');
      console.log('[SYNC] Refreshing psettings from server');
      try {
        await refreshSettings();
      } catch (err) {
        console.warn('[SYNC] Settings refresh failed, falling back to event:', err);
        window.dispatchEvent(new Event('refreshPsettings'));
        await new Promise(r => setTimeout(r, 800));
      }
      if (forceBlocking) setSyncProgress(35);

      // 2. Fetch and cache routes
      if (forceBlocking) setSyncStatus('Updating Routes...');
      try {
        console.log('[SYNC] Fetching routes');
        const routesResponse = await mysqlApi.routes.getByDevice(deviceFingerprint);
        console.log('[SYNC] Routes response:', routesResponse.success, 'Count:', routesResponse.data?.length);
        if (routesResponse.success && routesResponse.data && routesResponse.data.length > 0) {
          await saveRoutes(routesResponse.data);
          syncedCount++;
          console.log(`[SUCCESS] Synced ${routesResponse.data.length} routes`);
        }
      } catch (err) {
        console.warn('Routes sync skipped:', err);
      }
      if (forceBlocking) setSyncProgress(45);

      // 3. Fetch and cache sessions
      if (forceBlocking) setSyncStatus('Updating Sessions...');
      let allSessions: any[] = [];
      try {
        console.log('[SYNC] Fetching sessions');
        const sessionsResponse = await mysqlApi.sessions.getByDevice(deviceFingerprint);
        console.log('[SYNC] Sessions response:', sessionsResponse.success, 'Count:', sessionsResponse.data?.length);
        if (sessionsResponse.success && sessionsResponse.data && sessionsResponse.data.length > 0) {
          allSessions = sessionsResponse.data;
          await saveSessions(sessionsResponse.data);
          syncedCount++;
          console.log(`[SUCCESS] Synced ${sessionsResponse.data.length} sessions`);
        }
      } catch (err) {
        console.warn('Sessions sync skipped:', err);
      }
      if (forceBlocking) setSyncProgress(55);

      // 4. Fetch and cache ALL farmers (Data Phase)
      if (forceBlocking) {
        setSyncStatus('Downloading Farmers...');
        setSyncSubLabel('Farmers');
      }

      try {
        console.log('[SYNC] Fetching farmers');
        const response = await mysqlApi.farmers.getByDevice(deviceFingerprint);
        console.log('[SYNC] Farmers response:', response.success, 'Count:', response.data?.length);
        if (response.success && response.data && response.data.length > 0) {
          await saveFarmers(response.data);
          if (forceBlocking) setSyncSubCount(response.data.length);
          syncedCount++;
          console.log(`[SUCCESS] Synced ALL ${response.data.length} farmers`);
        } else if (response.message?.includes('not authorized')) {
          hasAuthError = true;
          console.warn('[SYNC] Device not authorized for farmers');
        }
      } catch (err) {
        console.warn('Farmers sync skipped:', err);
      }
      if (forceBlocking) setSyncProgress(75);

      // v2.12.38: For background sync, clear the visible "Syncing" state now.
      // The exhaustive maintenance phase will continue under the global lock,
      // but the UI will be interactive.
      if (!forceBlocking && mountedRef.current) {
        setIsSyncing(false);
      }

      // 4b. Fetch Multi-Season & Multi-Route Farmer Cumulatives (Exhaustive Phase)
      try {
        if (forceBlocking) {
          setSyncStatus('Exhaustive Sync...');
          setSyncSubLabel('Initializing...');
        }

        // v2.12.31: Resolve active scode from storage to guide the background sync filter
        const activeScode = (() => {
          try {
            const raw = localStorage.getItem('active_session_data');
            if (raw) return JSON.parse(raw)?.session?.SCODE;
          } catch {}
          return undefined;
        })();

        // v2.12.21: Iterate through ALL sessions/seasons and optionally ALL routes
        // to populate the cache with strictly scoped data buckets.
        const seasonsToSync = allSessions.length > 0 ? allSessions : [null]; // fallback if no sessions fetched

        // Fetch current routes for center-specific sync
        const activeRoutes = (await mysqlApi.routes.getByDevice(deviceFingerprint)).data || [];
        console.log(`[SYNC] Starting exhaustive sync for ${seasonsToSync.length} seasons and ${activeRoutes.length} routes`);

        for (let sIdx = 0; sIdx < seasonsToSync.length; sIdx++) {
          const seasonToSync = seasonsToSync[sIdx];
          const seasonCode = seasonToSync?.SCODE || seasonToSync?.scode || undefined;
          const seasonName = seasonToSync?.descript || 'Current';

          // v2.12.26: Skip secondary seasons/sessions during non-blocking background sync
          // to keep the frontend responsive and backend pool free.
          const isCurrentSeason = !seasonCode || activeScode === seasonCode;
          if (!forceBlocking && !isCurrentSeason) continue;

          console.log(`[SYNC] [SEASON ${sIdx + 1}/${seasonsToSync.length}] Syncing: ${seasonName} (code=${seasonCode})`);

          if (forceBlocking) {
            setSyncStatus(`Syncing: ${seasonName}`);
            setSyncSubLabel('Global Totals');
          }

          // 1. Sync CCode-wide (Global) batch for this season
          const globalCount = await fetchAndSaveCumulativeBatch(deviceFingerprint, undefined, seasonCode, forceBlocking);
          console.log(`[SYNC] [SEASON ${sIdx + 1}] Global sync done: ${globalCount} farmers`);
          if (forceBlocking && globalCount > 0) setSyncSubCount(globalCount);

          // 2. Sync Scoped batches for each active route in this season
          // v2.12.28: BACKGROUND sync only does 1 center to save server pool.
          // MANUAL sync (forceBlocking) does ALL centers for historical accuracy.
          const routesToProcess = forceBlocking ? activeRoutes : activeRoutes.slice(0, 1);
          console.log(`[SYNC] [SEASON ${sIdx + 1}] Processing ${routesToProcess.length}/${activeRoutes.length} routes`);

          for (let rIdx = 0; rIdx < routesToProcess.length; rIdx++) {
            const route = routesToProcess[rIdx];
            console.log(`[SYNC] [SEASON ${sIdx + 1}] [ROUTE ${rIdx + 1}/${routesToProcess.length}] ${route.tcode}`);

            if (forceBlocking) {
              setSyncSubLabel(`Center: ${route.tcode}`);
              setSyncProgress(75 + (sIdx / seasonsToSync.length * 15) + (rIdx / routesToProcess.length * 15 / seasonsToSync.length));
            }

            const scopedCount = await fetchAndSaveCumulativeBatch(deviceFingerprint, route.tcode, seasonCode, forceBlocking);
            if (forceBlocking && scopedCount > 0) setSyncSubCount(scopedCount);

            // v2.12.28: Heavy inter-route pacing for background runs
            await new Promise(r => setTimeout(r, forceBlocking ? 600 : 3000));
          }
        }
      } catch (err) {
        console.warn('Exhaustive cumulative sync skipped/failed:', err);
      }
      if (forceBlocking) setSyncProgress(90);

      // 5. Fetch and cache items
      if (forceBlocking) setSyncStatus('Updating Catalogue...');
      try {
        console.log('[SYNC] Fetching items');
        const itemsResponse = await mysqlApi.items.getAll(deviceFingerprint, undefined, true);
        console.log('[SYNC] Items response:', itemsResponse.success, 'Count:', itemsResponse.data?.length);
        if (itemsResponse.success && itemsResponse.data && itemsResponse.data.length > 0) {
          await saveItems(itemsResponse.data);
          syncedCount++;
        }
      } catch (err) {
        console.warn('Items sync skipped:', err);
      }
      if (forceBlocking) setSyncProgress(95);

      // 6 & 7. Today's Z and Month's Periodic Reports (Background, non-critical)
      if (forceBlocking) setSyncStatus('Finalizing...');
      try {
        const today = new Date().toISOString().split('T')[0];
        const zReportData = await mysqlApi.zReport.get(today, deviceFingerprint);
        if (zReportData) {
          await saveZReport(today, zReportData);
        }
      } catch {}

      if (mountedRef.current) {
        setLastSyncTime(new Date());
        await updatePendingCount(true);
        
        // v2.12.18: Always dispatch syncComplete so dashboards and other components refresh
        window.dispatchEvent(new CustomEvent('syncComplete', {
          detail: { synced: syncedCount, source: 'syncAllData' }
        }));

        if (forceBlocking) {
          setSyncStatus('Complete!');
          setSyncProgress(100);
          // Small delay to show "Complete!" before closing overlay
          await new Promise(r => setTimeout(r, 1000));
        }

        if (!silent && !forceBlocking) {
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
      if (mountedRef.current) {
        setIsSyncing(false);
        setIsBlockingSync(false);
        setSyncStatus('');
        setSyncProgress(0);
        setSyncSubCount(undefined);
        setSyncSubLabel(undefined);
      }
    }
  }, [isReady, acquireLock, releaseLock, saveFarmers, saveItems, saveZReport, savePeriodicReport, saveRoutes, saveSessions, syncOfflineReceipts, updatePendingCount, getUnsyncedSales, deleteSale, getAllUnsyncedRecords, deleteReceipt, updateFarmerCumulative]);

  // Initial sync on mount - trigger blocking sync only on first launch after login
  useEffect(() => {
    console.log('[SYNC] Initial sync effect running. Auth:', isAuthenticated, 'Ready:', isReady);
    if (!navigator.onLine || !isReady || !isAuthenticated) {
      console.log('[SYNC] Initial sync skipped. Online:', navigator.onLine, 'Ready:', isReady, 'Auth:', isAuthenticated);
      return;
    }
    
    // Check if full sync has ever completed
    const fullSyncCompleted = localStorage.getItem('full_sync_completed') === 'true';
    console.log('[SYNC] Full sync completed status:', fullSyncCompleted);

    if (!fullSyncCompleted && mountedRef.current) {
      console.log('[SYNC] First launch detected (logged in), triggering blocking full sync');
      syncAllData(true, true).then((success) => {
        console.log('[SYNC] Blocking sync result:', success);
        if (success) {
          localStorage.setItem('full_sync_completed', 'true');
          localStorage.setItem('lastSyncTime', Date.now().toString());
        }
      });
    } else if (mountedRef.current) {
      console.log('[SYNC] Subsequent launch, triggering background sync');
      syncAllData(true, false).then(() => {
        localStorage.setItem('lastSyncTime', Date.now().toString());
      });
    }
  }, [isReady, syncAllData, isAuthenticated]);

  // Register centralized online handler
  // In offline-first mode (online=1), auto-sync is disabled - user must manually trigger
  useEffect(() => {
    // Skip auto-sync on reconnect in offline-first mode
    if (offlineFirstMode) {
      console.log('[OFFLINE] Offline-first mode: auto-sync on reconnect disabled');
      return;
    }
    
    const unregister = registerOnlineHandler(() => {
      if (mountedRef.current && isReady && isAuthenticated) {
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
      if (navigator.onLine && mountedRef.current && isAuthenticated) {
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

  // Update pending count on mount and when receipts are saved
  useEffect(() => {
    if (isReady) updatePendingCount(true);

    // Listen for receipt/sale save events to refresh counts immediately
    const handleReceiptSaved = () => {
      console.log('[SYNC] receiptSaved event — refreshing pending counts');
      updatePendingCount();
    };

    // v2.12.36: Auto-sync event listener to break circular dependency
    const handleAutoSyncTrigger = (e: any) => {
      if (navigator.onLine && isAuthenticated && !isSyncing && !offlineFirstMode) {
        const source = e.detail?.source || 'unknown';
        console.log(`[SYNC] Auto-sync event received (source=${source}) — executing syncAllData`);
        syncAllData(true, false);
      }
    };

    window.addEventListener('receiptSaved', handleReceiptSaved);
    window.addEventListener('syncComplete', handleReceiptSaved);
    window.addEventListener('triggerAutoSync', handleAutoSyncTrigger as EventListener);

    return () => {
      window.removeEventListener('receiptSaved', handleReceiptSaved);
      window.removeEventListener('syncComplete', handleReceiptSaved);
      window.removeEventListener('triggerAutoSync', handleAutoSyncTrigger as EventListener);
    };
  }, [isReady, updatePendingCount, syncAllData, isAuthenticated, offlineFirstMode]);

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
    isBlockingSync,
    syncStatus,
    syncProgress,
    syncSubCount,
    syncSubLabel,
    lastSyncTime,
    pendingCount,
    pendingMilkCount,
    pendingSalesCount,
    // v2.10.60: count of multOpt=0 receipts kept locally because the server
    // already has a delivery for that farmer/session/date (DUPLICATE_SESSION_DELIVERY).
    conflictedReceiptsCount,
    updatePendingCount,
    // Member sync state for banner
    isSyncingMembers,
    memberSyncCount,
    // Expose offline-first mode for UI components
    offlineFirstMode
  };
};
