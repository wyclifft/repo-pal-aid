import { useState, useEffect, useCallback, useRef } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useSyncManager, deduplicateReceipts } from '@/hooks/useSyncManager';
import { useAuth } from '@/contexts/AuthContext';
import { useAppSettings } from '@/hooks/useAppSettings';
import { mysqlApi } from '@/services/mysqlApi';
import { farmerFrequencyApi } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { resolveDashboardMilkSessionId } from '@/utils/sessionMetadata';
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
  const [pendingMilkKgs, setPendingMilkKgs] = useState(0);
  const [pendingMilkAmKgs, setPendingMilkAmKgs] = useState(0);
  const [pendingMilkPmKgs, setPendingMilkPmKgs] = useState(0);
  const [unsyncedMilkReceipts, setUnsyncedMilkReceipts] = useState<any[]>([]);
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
  const hasRunInitialSyncRef = useRef<string | null>(null); // Guard against infinite initial sync loops

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
  const { refreshSettings, useCumulativeRouteFilter, isDeviceAuthorized, settings } = useAppSettings();

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
        console.log(`[SYNC] Batch pending, retrying in 1s... (${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, 1000));
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
      normalizedSession = String(receipt.session || receipt.season_code || '').trim() || 'AM';



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
        transdate: receipt.transdate, // v2.12.60: Forward explicit local date
        device_fingerprint: deviceFingerprint,
        entry_type: receipt.entry_type,
        product_code: receipt.product_code,
        season_code: receipt.season_code,
        milk_session_id: receipt.milk_session_id || resolveDashboardMilkSessionId() || undefined,
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
              transdate: receipt.transdate, // v2.12.60: Forward explicit local date
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
          const existingDevice = (result as any)?.existing_device;
          const existingRoute = (result as any)?.existing_route || receipt.route;
          const existingUploadRef = (result as any)?.existing_uploadrefno;
          recordConflict(
            String(receipt.farmer_id).replace(/^#/, '').trim(),
            normalizedSession,
            new Date(receipt.collection_date).toISOString().split('T')[0],
            receipt.reference_no,
            existingUploadRef,
            existingDevice,
            existingRoute,
            receipt.orderId
          );
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
      remoteUploadRef?: string,
      existingDevice?: string,
      existingRoute?: string,
      orderId?: number
    ) => {
      const key = `${farmerId}|${sessionVal}|${dateVal}`;
      conflictKeysSeen.add(key);
      if (!conflictKeysToasted.has(key)) {
        conflictKeysToasted.add(key);

        const routeStr = existingRoute ? `Route: ${existingRoute}` : '';
        const deviceStr = existingDevice ? `Device: ${existingDevice}` : '';
        const tags = [routeStr, deviceStr].filter(Boolean).join(', ');
        const simpleMsg = `Member ${farmerId} has delivered this session${tags ? ` (${tags})` : ''}.`;

        toast.error(simpleMsg, { duration: 8000 });

        // Dispatch event with device, route, and orderId to trigger prompt dialog
        window.dispatchEvent(new CustomEvent('duplicateDetected', {
          detail: {
            farmerId,
            session: sessionVal,
            date: dateVal,
            localRef,
            remoteUploadRef,
            device: existingDevice,
            route: existingRoute,
            orderId
          }
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
      // Filter out non-receipt entries, sales, and Sell Produce (sales/sell counted separately)
      const receiptsOnly = unsynced.filter((r: any) => {
        if (r.type === 'sale') return false;
        const tt = Number(r.transtype || (r as any).transtype || 1);
        if (tt !== 1) return false; // Only Buy Produce (transtype = 1) contributes to milk/produce KGs
        return true;
      });

      // Calculate total unsynced weight from IndexedDB receipts (overall and by session)
      let totalMilkKgs = 0;
      let amMilkKgs = 0;
      let pmMilkKgs = 0;

      const classifySession = (r: any): 'AM' | 'PM' | 'OTHER' => {
        const s = String(r.session || r.session_descript || '').trim().toUpperCase();
        if (s === 'AM' || s.includes('AM') || s.includes('MORNING')) return 'AM';
        if (s === 'PM' || s.includes('PM') || s.includes('AFTERNOON') || s.includes('EVENING')) return 'PM';
        return 'OTHER';
      };

      receiptsOnly.forEach((r: any) => {
        const w = parseFloat(r.weight || r.liters || r.quantity || 0);
        if (!isNaN(w) && w > 0) {
          totalMilkKgs += w;
          const st = classifySession(r);
          if (st === 'AM') amMilkKgs += w;
          else if (st === 'PM') pmMilkKgs += w;
        }
      });
      
      // Also count pending store/AI sales
      const unsyncedSales = await getUnsyncedSales();
      const salesCount = unsyncedSales.length;

      // v2.12.30: Include native storage records in the count to surface discrepancies
      let nativeMilkCount = 0;
      let nativeSalesCount = 0;
      let missingNativeMilk: any[] = [];
      if (isNativeStorageAvailable()) {
        try {
          const { getUnsyncedFromLocalDB } = await import('@/services/offlineStorage');
          const nativeMilk = await getUnsyncedFromLocalDB('milk_collection');
          const nativeSales = await getUnsyncedFromLocalDB('store_sale');
          const nativeAI = await getUnsyncedFromLocalDB('ai_sale');

          // v2.12.35: Normalize reference number check for discrepancy count
          const idbRefs = new Set(receiptsOnly.map(r => (r.reference_no || '').trim().toUpperCase()));
          const idbSaleRefs = new Set(unsyncedSales.map(r => (r.transrefno || r.reference_no || '').trim().toUpperCase()));

          missingNativeMilk = nativeMilk.filter(r => !idbRefs.has((r.referenceNo || '').trim().toUpperCase()));
          nativeMilkCount = missingNativeMilk.length;
          nativeSalesCount = nativeSales.filter(r => !idbSaleRefs.has((r.referenceNo || '').trim().toUpperCase())).length +
                             nativeAI.filter(r => !idbSaleRefs.has((r.referenceNo || '').trim().toUpperCase())).length;

          missingNativeMilk.forEach((r: any) => {
            const tt = Number(r.transtype || (r as any).transtype || 1);
            if (tt !== 1) return; // Only Buy Produce (transtype = 1)
            const w = parseFloat(r.weight || r.liters || r.quantity || 0);
            if (!isNaN(w) && w > 0) {
              totalMilkKgs += w;
              const st = classifySession(r);
              if (st === 'AM') amMilkKgs += w;
              else if (st === 'PM') pmMilkKgs += w;
            }
          });

          if (nativeMilkCount > 0 || nativeSalesCount > 0) {
            console.log(`[STORAGE] Discrepancy found: Native has ${nativeMilkCount} milk and ${nativeSalesCount} sales NOT in IndexedDB`);
          }
        } catch (natErr) {
          console.warn('[STORAGE] Failed to fetch native counts:', natErr);
        }
      }

      if (mountedRef.current) {
        const allMilkReceipts = [...receiptsOnly, ...missingNativeMilk];
        const pendingMilkTotal = receiptsOnly.length + nativeMilkCount;
        const totalPending = pendingMilkTotal + salesCount + nativeSalesCount;
        console.log(`[SYNC] Pending Count Update: total=${totalPending} (milk=${pendingMilkTotal}, kgs=${totalMilkKgs} [AM=${amMilkKgs}, PM=${pmMilkKgs}], sales=${salesCount + nativeSalesCount})`);

        setPendingCount(totalPending);
        setPendingMilkCount(pendingMilkTotal);
        setPendingMilkKgs(totalMilkKgs);
        setPendingMilkAmKgs(amMilkKgs);
        setPendingMilkPmKgs(pmMilkKgs);
        setUnsyncedMilkReceipts(allMilkReceipts);
        setPendingSalesCount(salesCount + nativeSalesCount);

        if (pendingMilkTotal === 0) {
          setConflictedReceiptsCount(0);
          setPendingMilkKgs(0);
          setPendingMilkAmKgs(0);
          setPendingMilkPmKgs(0);
          setUnsyncedMilkReceipts([]);
        }

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

    // Throttle silent background syncs if synced recently (< 15 seconds ago) unless forceBlocking
    const lastSyncTimeStr = localStorage.getItem('lastSyncTime');
    const lastSyncAge = lastSyncTimeStr ? Date.now() - Number(lastSyncTimeStr) : Infinity;
    if (silent && !forceBlocking && lastSyncAge < 15000) {
      console.log(`[SYNC] Background sync throttled (${Math.round(lastSyncAge / 1000)}s since last sync)`);
      return true;
    }

    // CRITICAL GUARD: Do NOT sync if device is explicitly not authorized
    const rawCcode = (settings?.ccode || localStorage.getItem('device_ccode') || localStorage.getItem('app_settings_ccode') || '').trim();
    const deviceCcode = (rawCcode && rawCcode !== '000' && rawCcode !== '0') ? rawCcode : '';
    if (isDeviceAuthorized === false) {
      console.log(`[SYNC] Device is not authorized yet (isAuth=${isDeviceAuthorized}, ccode=${deviceCcode}). Aborting sync.`);
      if (!silent) {
        toast.error('Device is not authorized for sync yet. Please contact your administrator.');
      }
      return false;
    }

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
      if (!silent) toast.info('Database is initializing, please try again in a moment');
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
      }
      if (forceBlocking) setSyncProgress(30);

      // 2, 3, 4, 5. PARALLEL CORE DOWNLOAD PHASE (Routes, Sessions, Farmers, Catalogue Items)
      if (forceBlocking) {
        setSyncStatus('Downloading Full Data...');
        setSyncSubLabel('Routes, Farmers & Catalogue');
      }

      let allSessions: any[] = [];
      let activeRoutes: any[] = [];

      try {
        console.log('[SYNC] Starting parallel core downloads...');
        const [routesRes, sessionsRes, farmersRes, itemsRes, usersRes] = await Promise.allSettled([
          mysqlApi.routes.getByDevice(deviceFingerprint),
          mysqlApi.sessions.getByDevice(deviceFingerprint),
          mysqlApi.farmers.getByDevice(deviceFingerprint),
          mysqlApi.items.getAll(deviceFingerprint, undefined, true),
          mysqlApi.auth.syncCompanyUsers(deviceFingerprint)
        ]);

        if (routesRes.status === 'fulfilled' && routesRes.value.success && routesRes.value.data?.length) {
          const sortedRoutes = [...routesRes.value.data].sort((a, b) => {
            const descA = String(a?.descript || a?.tcode || '').trim();
            const descB = String(b?.descript || b?.tcode || '').trim();
            const comp = descA.localeCompare(descB, undefined, { numeric: true, sensitivity: 'base' });
            if (comp !== 0) return comp;
            return String(a?.tcode || '').trim().localeCompare(String(b?.tcode || '').trim(), undefined, { numeric: true, sensitivity: 'base' });
          });
          activeRoutes = sortedRoutes;
          await saveRoutes(sortedRoutes);
          syncedCount++;
          console.log(`[SUCCESS] Synced ${sortedRoutes.length} routes`);
        }

        if (sessionsRes.status === 'fulfilled' && sessionsRes.value.success && sessionsRes.value.data?.length) {
          allSessions = sessionsRes.value.data;
          await saveSessions(sessionsRes.value.data);
          syncedCount++;
          console.log(`[SUCCESS] Synced ${sessionsRes.value.data.length} sessions`);
        }

        if (farmersRes.status === 'fulfilled' && farmersRes.value.success && farmersRes.value.data?.length) {
          await saveFarmers(farmersRes.value.data);
          if (forceBlocking) setSyncSubCount(farmersRes.value.data.length);
          syncedCount++;
          console.log(`[SUCCESS] Synced ALL ${farmersRes.value.data.length} farmers`);
        } else if (farmersRes.status === 'fulfilled' && farmersRes.value.message?.includes('not authorized')) {
          hasAuthError = true;
          console.warn('[SYNC] Device not authorized for farmers');
        }

        if (itemsRes.status === 'fulfilled' && itemsRes.value.success && itemsRes.value.data?.length) {
          await saveItems(itemsRes.value.data);
          syncedCount++;
          console.log(`[SUCCESS] Synced ${itemsRes.value.data.length} catalogue items`);
        }

        if (usersRes.status === 'fulfilled' && usersRes.value.success && usersRes.value.data?.length) {
          const { cacheCompanyUsers } = await import('@/utils/companyUsersCache');
          await cacheCompanyUsers(usersRes.value.data);
          syncedCount++;
          console.log(`[SUCCESS] Synced ${usersRes.value.data.length} company users`);
        }
      } catch (err) {
        console.warn('[SYNC] Parallel core download error:', err);
      }

      if (forceBlocking) setSyncProgress(65);

      if (!forceBlocking && mountedRef.current) {
        setIsSyncing(false);
      }

      // 4b. FULL EXHAUSTIVE CUMULATIVE SYNC (NO PARTIAL SYNCS — ALL SEASONS & ALL ROUTES)
      try {
        if (forceBlocking) {
          setSyncStatus('Exhaustive Full Sync...');
          setSyncSubLabel('All Centers & Seasons');
        }

        const seasonsToSync = allSessions.length > 0 ? allSessions : [null];

        console.log(`[SYNC] Full sync executing for ALL ${seasonsToSync.length} seasons and ALL ${activeRoutes.length} routes`);

        for (let sIdx = 0; sIdx < seasonsToSync.length; sIdx++) {
          const seasonToSync = seasonsToSync[sIdx];
          const seasonCode = seasonToSync?.SCODE || seasonToSync?.scode || undefined;
          const seasonName = seasonToSync?.descript || 'Current';

          console.log(`[SYNC] [SEASON ${sIdx + 1}/${seasonsToSync.length}] Syncing: ${seasonName} (code=${seasonCode})`);

          if (forceBlocking) {
            setSyncStatus(`Syncing: ${seasonName}`);
            setSyncSubLabel('Global Totals');
          }

          // 1. Sync CCode-wide (Global) batch for this season
          const globalCount = await fetchAndSaveCumulativeBatch(deviceFingerprint, undefined, seasonCode, forceBlocking);
          if (forceBlocking && globalCount > 0) setSyncSubCount(globalCount);

          // 2. HIGH-SPEED CONCURRENT ROUTE SYNC: Process all routes in parallel chunks of 4 (only if route filtering enabled)
          if (useCumulativeRouteFilter && activeRoutes.length > 0) {
            const PARALLEL_ROUTE_CHUNK_SIZE = 4;
            for (let rIdx = 0; rIdx < activeRoutes.length; rIdx += PARALLEL_ROUTE_CHUNK_SIZE) {
              const chunk = activeRoutes.slice(rIdx, rIdx + PARALLEL_ROUTE_CHUNK_SIZE);

              if (forceBlocking) {
                const currentRouteNames = chunk.map(r => r.tcode).join(', ');
                setSyncSubLabel(`Centers: ${currentRouteNames}`);
                setSyncProgress(65 + (sIdx / seasonsToSync.length * 25) + (rIdx / activeRoutes.length * 25 / seasonsToSync.length));
              }

              const results = await Promise.all(
                chunk.map(route => fetchAndSaveCumulativeBatch(deviceFingerprint, route.tcode, seasonCode, forceBlocking))
              );

              const totalChunkSynced = results.reduce((a, b) => a + b, 0);
              if (forceBlocking && totalChunkSynced > 0) setSyncSubCount(totalChunkSynced);
            }
          }
        }
      } catch (err) {
        console.warn('Exhaustive cumulative sync skipped/failed:', err);
      }
      if (forceBlocking) setSyncProgress(92);

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

        if (!silent) {
          if (hasAuthError && syncedCount === 0) {
            toast.warning('Device not authorized for full data sync');
          } else {
            toast.success('Data sync complete!');
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

  // Lightweight sync for pending offline transactions (receipts and sales) only.
  // Prevents running heavy overall sync (farmers, items, monthly frequency batches) on internet reconnect or background timers.
  const syncPendingTransactionsOnly = useCallback(async () => {
    if (!navigator.onLine || !isReady || !isAuthenticated || isDeviceAuthorized === false) return;
    try {
      console.log('[SYNC] Syncing pending transactions only (reconnect/background trigger)');
      await syncOfflineReceipts();
      const unsyncedSales = await getUnsyncedSales();
      if (unsyncedSales.length > 0) {
        const { syncSalesFromDB } = await import('@/utils/salesSyncEngine');
        await syncSalesFromDB(getUnsyncedSales, deleteSale);
      }
      await updatePendingCount(true);
    } catch (err) {
      console.warn('[SYNC] Pending transactions sync error:', err);
    }
  }, [isReady, isAuthenticated, isDeviceAuthorized, syncOfflineReceipts, getUnsyncedSales, deleteSale, getAllUnsyncedRecords, deleteReceipt, updatePendingCount]);

  // Initial sync on mount or upon device authorization
  useEffect(() => {
    const rawCcode = (settings?.ccode || localStorage.getItem('device_ccode') || localStorage.getItem('app_settings_ccode') || '').trim();
    const deviceCcode = (rawCcode && rawCcode !== '000' && rawCcode !== '0') ? rawCcode : '';
    console.log('[SYNC] Initial sync effect running. Auth:', isAuthenticated, 'DeviceAuth:', isDeviceAuthorized, 'cCode:', deviceCcode, 'Ready:', isReady);

    if (!navigator.onLine || !isReady || !isAuthenticated || isDeviceAuthorized === false) {
      console.log('[SYNC] Initial sync skipped. Online:', navigator.onLine, 'Ready:', isReady, 'Auth:', isAuthenticated, 'DeviceAuth:', isDeviceAuthorized, 'cCode:', deviceCcode);
      return;
    }
    
    // Check if full sync has ever completed for THIS ccode
    const syncKey = `full_sync_completed_${deviceCcode || 'default'}`;
    const fullSyncCompleted = localStorage.getItem(syncKey) === 'true' || localStorage.getItem('full_sync_completed') === 'true';
    console.log('[SYNC] Full sync completed status for', deviceCcode, ':', fullSyncCompleted);

    const lastSyncTimeStr = localStorage.getItem('lastSyncTime');
    const lastSyncAge = lastSyncTimeStr ? Date.now() - Number(lastSyncTimeStr) : Infinity;

    if (!fullSyncCompleted && mountedRef.current) {
      if (hasRunInitialSyncRef.current === `blocking_${deviceCcode}`) return;
      hasRunInitialSyncRef.current = `blocking_${deviceCcode}`;

      console.log('[SYNC] First launch after authorization detected for', deviceCcode, '— triggering BLOCKING full sync!');
      // Non-silent (false) so operator sees progress status modal ("Downloading Farmers...", etc.)
      syncAllData(false, true).then((success) => {
        console.log('[SYNC] Blocking sync result:', success);
        if (success) {
          localStorage.setItem(syncKey, 'true');
          localStorage.setItem('full_sync_completed', 'true');
          localStorage.setItem('lastSyncTime', Date.now().toString());
        }
      });
    } else if (mountedRef.current) {
      if (hasRunInitialSyncRef.current === `bg_${deviceCcode}` || lastSyncAge < 3 * 60 * 1000) {
        console.log(`[SYNC] Skipping duplicate background sync for ${deviceCcode} (last sync age: ${Math.round(lastSyncAge / 1000)}s)`);
        return;
      }
      hasRunInitialSyncRef.current = `bg_${deviceCcode}`;

      console.log('[SYNC] Subsequent launch for authorized device', deviceCcode, '— triggering full background sync');
      syncAllData(true, false).then(() => {
        localStorage.setItem('lastSyncTime', Date.now().toString());
      });
    }
  }, [isReady, syncAllData, isAuthenticated, isDeviceAuthorized, settings?.ccode]);

  // Register centralized online handler
  // In offline-first mode (online=1), auto-sync is disabled - user must manually trigger
  useEffect(() => {
    if (offlineFirstMode || isDeviceAuthorized === false) {
      console.log('[OFFLINE] Auto-sync on reconnect disabled (offlineFirstMode or unapproved device)');
      return;
    }
    
    const unregister = registerOnlineHandler(() => {
      if (mountedRef.current && isReady && isAuthenticated && isDeviceAuthorized !== false) {
        console.log('[ONLINE] Online handler triggered — executing full background sync');
        syncAllData(true, false);
      }
    });

    return unregister;
  }, [isReady, registerOnlineHandler, syncAllData, offlineFirstMode, isDeviceAuthorized, isAuthenticated, settings?.ccode]);

  // Periodic sync every 5 minutes (only in background sync mode, online=0)
  useEffect(() => {
    if (!isReady || offlineFirstMode || isDeviceAuthorized === false) return;

    periodicSyncRef.current = setInterval(() => {
      if (navigator.onLine && mountedRef.current && isAuthenticated && isDeviceAuthorized !== false) {
        console.log('[SYNC] Periodic background sync running full sync');
        syncAllData(true, false);
      }
    }, 5 * 60 * 1000);

    return () => {
      if (periodicSyncRef.current) {
        clearInterval(periodicSyncRef.current);
      }
    };
  }, [isReady, offlineFirstMode, isDeviceAuthorized, isAuthenticated, syncAllData, settings?.ccode]);

  // Update pending count on mount and when receipts are saved or device is authorized
  useEffect(() => {
    if (isReady) updatePendingCount(true);

    // Listen for receipt/sale save events to refresh counts with a 3000ms debounce (prevents SQLite lock contention during printing)
    let saveTimeout: any = null;
    const handleReceiptSaved = () => {
      console.log('[SYNC] receiptSaved event received — debouncing pending count refresh');
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        updatePendingCount(true);
      }, 3000);
    };

    // Auto-sync event listener for full background sync
    const handleAutoSyncTrigger = (e: any) => {
      if (navigator.onLine && isAuthenticated && isDeviceAuthorized !== false && !isSyncing && !offlineFirstMode) {
        const source = e.detail?.source || 'unknown';
        console.log(`[SYNC] Auto-sync event received (source=${source}) — executing full background sync`);
        syncAllData(true, false);
      }
    };

    // Trigger full sync when device gets newly authorized
    const handleDeviceAuthorized = () => {
      const rawCcode = (settings?.ccode || localStorage.getItem('device_ccode') || localStorage.getItem('app_settings_ccode') || '').trim();
      const deviceCcode = (rawCcode && rawCcode !== '000' && rawCcode !== '0') ? rawCcode : '';
      console.log(`[SYNC] deviceAuthorized event received for ccode=${deviceCcode}`);
      if (navigator.onLine && isAuthenticated) {
        const syncKey = `full_sync_completed_${deviceCcode || 'default'}`;
        const completed = localStorage.getItem(syncKey) === 'true';
        if (!completed) {
          console.log(`[SYNC] Triggering initial blocking sync following authorization for ${deviceCcode}`);
          syncAllData(false, true).then((success) => {
            if (success) {
              localStorage.setItem(syncKey, 'true');
              localStorage.setItem('full_sync_completed', 'true');
            }
          });
        }
      }
    };

    window.addEventListener('receiptSaved', handleReceiptSaved);
    window.addEventListener('syncComplete', handleReceiptSaved);
    window.addEventListener('triggerAutoSync', handleAutoSyncTrigger as EventListener);
    window.addEventListener('deviceAuthorized', handleDeviceAuthorized as EventListener);

    return () => {
      window.removeEventListener('receiptSaved', handleReceiptSaved);
      window.removeEventListener('syncComplete', handleReceiptSaved);
      window.removeEventListener('triggerAutoSync', handleAutoSyncTrigger as EventListener);
      window.removeEventListener('deviceAuthorized', handleDeviceAuthorized as EventListener);
    };
  }, [isReady, updatePendingCount, syncAllData, isAuthenticated, isDeviceAuthorized, offlineFirstMode, isSyncing, settings?.ccode]);

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
    pendingMilkKgs,
    pendingMilkAmKgs,
    pendingMilkPmKgs,
    unsyncedMilkReceipts,
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
