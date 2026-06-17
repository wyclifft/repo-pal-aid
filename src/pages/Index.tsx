import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Login } from '@/components/Login';
import { Dashboard } from '@/components/Dashboard';
import { BuyProduceScreen } from '@/components/BuyProduceScreen';
import { SellProduceScreen } from '@/components/SellProduceScreen';
import { ReceiptModal } from '@/components/ReceiptModal';
import { ReprintModal } from '@/components/ReprintModal';

import { useAuth } from '@/contexts/AuthContext';
import { useReprint } from '@/contexts/ReprintContext';
import { type AppUser, type Farmer, type MilkCollection, getCaptureMode } from '@/lib/supabase';
import { type Route, type Session, type Item } from '@/services/mysqlApi';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useDataSync } from '@/hooks/useDataSync';
import { useSessionBlacklist } from '@/hooks/useSessionBlacklist';
import { useAppSettings } from '@/hooks/useAppSettings';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { cumulativeMonitor } from '@/utils/cumulativeMonitor';
import { generateReferenceWithUploadRef, generateTransRefOnly } from '@/utils/referenceGenerator';
import { printMilkReceiptDirect } from '@/hooks/useDirectPrint';
import { saveToLocalDB } from '@/services/offlineStorage';
import { plog } from '@/utils/persistentLogger';
import { addRegressionPin, clearRegressionPin, takeRegressionPinsForReplay } from '@/utils/cumulativeRegressionPins';
import { toast } from 'sonner';

// Helper: filter cumulative data to only the selected produce type
const filterCumulativeByProduct = (
  cumData: { total: number; byProduct: Array<{ icode: string; product_name: string; weight: number }> } | undefined,
  productIcode?: string
): { total: number; byProduct: Array<{ icode: string; product_name: string; weight: number }> } | undefined => {
  if (!cumData || !productIcode || cumData.byProduct.length === 0) return cumData;
  const match = cumData.byProduct.find(p => p.icode.trim().toUpperCase() === productIcode.trim().toUpperCase());
  return match
    ? { total: match.weight, byProduct: [match] }
    : { total: 0, byProduct: [] };
};

// v2.10.89: Shared throttle gate for cumulative batch refresh.
// Coalesces the many trigger sources (post-sync, visibility, periodic, prefetch)
// into one full-batch refresh per minute. Set whenever a refresh completes.
let lastCumulativeRefreshAt = 0;
const MIN_REFRESH_GAP_MS = 60_000; // 60 s
const VISIBILITY_STALE_MS = 2 * 60_000; // 2 min
const PERIODIC_REFRESH_MS = 10 * 60_000; // 10 min (was 3 min)
const SYNC_DEBOUNCE_MS = 5_000; // trailing-edge debounce for syncComplete bursts

const Index = () => {
  const navigate = useNavigate();
  const { currentUser, isOffline, login, logout, isAuthenticated } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showCollection, setShowCollection] = useState(false); // Controls dashboard vs collection view
  const [collectionMode, setCollectionMode] = useState<'buy' | 'sell'>('buy'); // Buy or Sell mode

  // Company name from device
  const [companyName, setCompanyName] = useState<string>(() => {
    return localStorage.getItem('device_company_name') || 'DAIRY COLLECTION';
  });

  // Reprint receipts state - now from shared context
  const [reprintModalOpen, setReprintModalOpen] = useState(false);
  const { printedReceipts, addMilkReceipt, deleteReceipts } = useReprint();
  const [farmerId, setFarmerId] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [selectedFarmer, setSelectedFarmer] = useState<Farmer | null>(null); // Full farmer object with multOpt
  const [route, setRoute] = useState('');
  const [routeName, setRouteName] = useState('');
  const [selectedRouteCode, setSelectedRouteCode] = useState(''); // tcode from fm_tanks
  const [selectedRouteMprefix, setSelectedRouteMprefix] = useState(''); // mprefix from fm_tanks for chkroute=0
  const [session, setSession] = useState(''); // Session description from sessions table
  const [activeSession, setActiveSession] = useState<Session | null>(null); // Currently active session object
  const [selectedProduct, setSelectedProduct] = useState<Item | null>(null); // Selected produce item (invtype=01)
  const [searchValue, setSearchValue] = useState('');

  // Weight - for dairy: weight is total weight; for coffee: weight is net (after tare deduction)
  const [weight, setWeight] = useState(0);
  const [entryType, setEntryType] = useState<'scale' | 'manual'>('manual');
  const [lastSavedWeight, setLastSavedWeight] = useState(0);
  
  // ========== zeroOpt CAPTURE LOCK (psettings.zeroopt) ==========
  // If zeroopt=1: After a capture, captureLocked=true blocks next capture until weight ≤0.5 kg
  // Lock applies to BOTH scale and manual entry
  // Lock resets when: (1) weight drops to ≤0.5 kg, or (2) new member is selected
  // If zeroopt=0: Captures allowed normally without zero check
  const [captureLocked, setCaptureLocked] = useState(false);
  const [lastCapturedFarmerId, setLastCapturedFarmerId] = useState<string | null>(null);
  // ========== END zeroOpt CAPTURE LOCK ==========
  
  // Coffee sack weighing - gross/tare/net (orgtype C only)
  // Tare weight comes from psettings.sackTare (default 1 kg)
  const [grossWeight, setGrossWeight] = useState(0);
  const [tareWeight, setTareWeight] = useState(1); // Will be set from psettings
  // Net weight is calculated: gross - tare (minimum 0)

  // Receipt modal
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Cumulative frequency for current farmer (monthly collection count)
  const [cumulativeFrequency, setCumulativeFrequency] = useState<{ total: number; byProduct: Array<{ icode: string; product_name: string; weight: number }> } | undefined>(undefined);
  
  // Captured collections for batch printing
  const [capturedCollections, setCapturedCollections] = useState<MilkCollection[]>([]);
  
  // Delivered by state for Buy/Sell portals
  const [deliveredBy, setDeliveredBy] = useState('owner');

  const { 
    saveReceipt, 
    savePrintedReceipts, 
    getPrintedReceipts, 
    getUnsyncedReceipts, 
    clearUnsyncedReceipts, 
    isReady,
    getFarmers,
    saveFarmers,
    updateFarmerCumulative,
    getFarmerCumulative,
    getFarmerTotalCumulative,
    getUnsyncedWeightForFarmer
  } = useIndexedDB();
  
  // Data sync hook for background syncing
  const { isSyncing, pendingCount, pendingMilkCount, pendingSalesCount, conflictedReceiptsCount, syncAllData } = useDataSync();
  
  // App-wide settings from psettings
  const { 
    settings: appSettings, 
    isLoading: settingsLoading,
    isDeviceAuthorized,
    isPendingApproval,
    deviceFingerprint,
    refreshSettings,
    requireZeroScale, 
    autoWeightOnly, 
    showCumulative,
    printCopies,
    produceLabel,
    routeLabel,
    periodLabel,
    isCoffee,
    sackTareWeight,
    allowSackEdit,
    settings
  } = useAppSettings();

  // Sync tare weight from psettings when loaded
  // For coffee (orgtype='C'), always default to 1 kg if not set
  useEffect(() => {
    if (isCoffee) {
      // Use psettings value if valid, otherwise default to 1 kg
      const tareValue = sackTareWeight > 0 ? sackTareWeight : 1;
      setTareWeight(tareValue);
    }
  }, [isCoffee, sackTareWeight]);

  // Clear cumulative when route or product changes to prevent stale display
  useEffect(() => {
    setCumulativeFrequency(undefined);
  }, [selectedRouteCode, selectedProduct?.icode]);

  const [loadedFarmers, setLoadedFarmers] = useState<Farmer[]>([]);
  const [lastSessionType, setLastSessionType] = useState<'AM' | 'PM' | null>(null);
  // v2.10.63: harden time_from coercion — default to undefined (not NaN) when missing/invalid
  // so the wall-clock fallback inside useSessionBlacklist only fires when truly absent.
  const activeSessionTimeFrom = (() => {
    if (!activeSession) return undefined;
    const raw = (activeSession as any).time_from;
    if (raw === undefined || raw === null || raw === '') return undefined;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : undefined;
  })();
  // v2.10.63: read SCODE in the same case as the Session interface (uppercase).
  // The previous lowercase '.scode' lookup always returned undefined, which silently
  // disabled the coffee-org duplicate blacklist after app restart. Tolerate legacy
  // lowercase by checking both, normalize to a trimmed string.
  const activeSeasonCode = activeSession
    ? String((activeSession as any).SCODE ?? (activeSession as any).scode ?? '').trim()
    : undefined;
  const { blacklistedFarmerIds, isBlacklisted, addToBlacklist, refreshBlacklist, clearBlacklist, getSessionType } = useSessionBlacklist(activeSessionTimeFrom, activeSeasonCode);
  
  // Local session-scoped set to track submitted farmers (extra safeguard for edge cases)
  // This covers scenarios where IndexedDB might not have the record yet
  const [sessionSubmittedFarmers, setSessionSubmittedFarmers] = useState<Set<string>>(new Set());
  
  // Get set of farmer IDs with multOpt=0
  const farmersWithMultOptZero = useCallback(() => {
    const set = new Set<string>();
    loadedFarmers.forEach(f => {
      if (f.multOpt === 0) {
        set.add(f.farmer_id.replace(/^#/, '').trim());
      }
    });
    return set;
  }, [loadedFarmers]);

  // Handle farmers loaded from FarmerSearch
  const handleFarmersLoaded = useCallback((farmers: Farmer[]) => {
    setLoadedFarmers(farmers);
  }, []);

  // Refresh blacklist when session changes or farmers load
  // NOTE: We don't include capturedCollections because blacklisting happens AFTER submission, not capture
  useEffect(() => {
    if (activeSession && loadedFarmers.length > 0) {
      // Pass empty array for capturedCollections - we only check submitted records, not captures
      refreshBlacklist([], farmersWithMultOptZero());
    }
  }, [activeSession, loadedFarmers, refreshBlacklist, farmersWithMultOptZero]);

  // v2.10.63: Eager preload of cached farmers on app start.
  // After app restart, activeSession is restored from localStorage but loadedFarmers
  // stays empty until the user opens Buy/Sell — leaving a window where the multOpt=0
  // blacklist is empty and a fast operator can re-capture a duplicate. This one-shot
  // effect hydrates loadedFarmers from IndexedDB as soon as a session is restored,
  // so refreshBlacklist runs before the operator can navigate into Buy Produce.
  useEffect(() => {
    if (!activeSession || !isReady || loadedFarmers.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const cached = await getFarmers();
        if (cancelled || !cached || cached.length === 0) return;
        const routeCode = String(selectedRouteCode || '').trim();
        const mprefix = String(selectedRouteMprefix || '').trim();
        const filtered = cached.filter((f: Farmer) => {
          if (!routeCode && !mprefix) return true;
          if (routeCode && String(f.route || '').trim() === routeCode) return true;
          if (mprefix && String(f.farmer_id || '').replace(/^#/, '').startsWith(mprefix)) return true;
          return false;
        });
        if (!cancelled && filtered.length > 0) {
          setLoadedFarmers(filtered);
          console.log(`[v2.10.63] Eager-preloaded ${filtered.length} farmers for blacklist refresh on app restart`);
        }
      } catch (e) {
        console.warn('[v2.10.63] Eager farmer preload failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [activeSession, isReady, loadedFarmers.length, getFarmers, selectedRouteCode, selectedRouteMprefix]);

  // Clear blacklist when session TYPE changes (AM → PM or PM → AM)
  // This ensures Submit button re-enables correctly when session rolls over
  useEffect(() => {
    if (!activeSession) return;
    
    const currentSessionType = getSessionType();
    
    if (lastSessionType !== null && lastSessionType !== currentSessionType) {
      console.log(`🔄 Session rolled over from ${lastSessionType} to ${currentSessionType} - clearing blacklist and session submitted farmers`);
      clearBlacklist();
      setSessionSubmittedFarmers(new Set()); // Clear local tracking on session change
      setCaptureLocked(false); // Reset capture lock on session change
    }
    
    setLastSessionType(currentSessionType);
  }, [activeSession, getSessionType, lastSessionType, clearBlacklist]);

  // Also clear when session description changes (user manually switches session)
  useEffect(() => {
    if (activeSession?.descript) {
      clearBlacklist();
      setSessionSubmittedFarmers(new Set()); // Clear local tracking on session change
    }
  }, [activeSession?.descript, clearBlacklist]);

  // v2.10.89: Stable refs so this effect never re-mounts on farmer/product change.
  // Previously this effect re-installed all listeners + reset the 3-min interval
  // every time the user picked a different farmer/product → repeated full-batch
  // refreshes for no good reason.
  const selectedFarmerRef = useRef(selectedFarmer);
  const selectedProductRef = useRef(selectedProduct);
  const getFarmerCumulativeRef = useRef(getFarmerCumulative);
  const getUnsyncedWeightForFarmerRef = useRef(getUnsyncedWeightForFarmer);
  useEffect(() => { selectedFarmerRef.current = selectedFarmer; }, [selectedFarmer]);
  useEffect(() => { selectedProductRef.current = selectedProduct; }, [selectedProduct]);
  useEffect(() => { getFarmerCumulativeRef.current = getFarmerCumulative; }, [getFarmerCumulative]);
  useEffect(() => { getUnsyncedWeightForFarmerRef.current = getUnsyncedWeightForFarmer; }, [getUnsyncedWeightForFarmer]);

  // Refresh cumulative cache after sync completes OR periodically to detect external DB changes
  // v2.10.89: Throttled (60 s gap), debounced sync bursts (5 s), visibility only
  // when stale (>2 min), periodic 10 min. Effect re-mounts only on route /
  // device / showCumulative change — NOT on farmer/product selection.
  useEffect(() => {
    if (!deviceFingerprint || !showCumulative) return;

    let refreshInProgress = false;
    let pendingRefresh: string | null = null;
    let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshCumulativesBatch = async (reason: string) => {
      if (!navigator.onLine) return;

      // v2.10.89: Throttle gate — coalesce noisy callers. Post-sync / manual
      // always pass through (they imply data we just wrote), but they still
      // ride the in-flight queue below.
      const sinceLast = Date.now() - lastCumulativeRefreshAt;
      const isForced = reason === 'post-sync' || reason === 'manual' || reason === 'online';
      if (!isForced && sinceLast < MIN_REFRESH_GAP_MS) {
        console.log(`🚦 Cumulative refresh (${reason}): throttled (last ran ${Math.round(sinceLast / 1000)}s ago)`);
        return;
      }

      if (refreshInProgress) {
        console.log(`🔄 Cumulative refresh (${reason}): queued (another refresh in progress)`);
        pendingRefresh = reason;
        return;
      }

      refreshInProgress = true;
      pendingRefresh = null;

      try {
        console.log(`🔄 Cumulative refresh (${reason}): using batch API...`);
        const batchResult = await mysqlApi.farmerFrequency.getMonthlyFrequencyBatch(deviceFingerprint, selectedRouteCode || undefined);
        if (batchResult.success && batchResult.data && batchResult.data.farmers) {
          const batchMap = new Map<string, number>();
          for (const f of batchResult.data.farmers) {
            batchMap.set(f.farmer_id.trim(), f.cumulative_weight);
          }

          const response = await mysqlApi.farmers.getByDevice(deviceFingerprint);
          if (response.success && response.data) {
            saveFarmers(response.data);
            const deviceCcode = localStorage.getItem('device_ccode') || '';
            const cumulativeEnabled = (settings.cumulative_frequency_status === 1) || (settings.printcumm === 1);
            const qualifying = cumulativeEnabled
              ? (deviceCcode ? response.data.filter(f => f.ccode === deviceCcode) : response.data)
              : [];

            const WRITE_BATCH = 50;
            let written = 0;
            for (let i = 0; i < qualifying.length; i += WRITE_BATCH) {
              const batch = qualifying.slice(i, i + WRITE_BATCH);
              await Promise.all(batch.map(async (farmer) => {
                const fId = farmer.farmer_id.replace(/^#/, '').trim();
                const weight = batchMap.get(fId) ?? 0;
                const byProd = batchResult.data.farmers.find(f => f.farmer_id.trim() === fId)?.by_product || [];
                const vs = reason === 'post-sync' ? 'W5:postcapture-refresh' : `W3:prewarm-batch(${reason})`;
                await updateFarmerCumulative(fId, weight, true, byProd, selectedRouteCode || undefined, { verifySource: vs, caller: `Index/refreshCumulativesBatch(${reason})` });
              }));
              written += batch.length;
              if (i + WRITE_BATCH < qualifying.length) {
                await new Promise(r => setTimeout(r, 0));
              }
            }
            console.log(`✅ Cumulative refresh (${reason}): ${written}/${qualifying.length} farmers updated completely`);
          }
        }

        // Update currently selected farmer's display immediately with FLOOR GUARD (read from refs)
        const currentFarmer = selectedFarmerRef.current;
        const currentProduct = selectedProductRef.current;
        if (currentFarmer) {
          const cleanId = currentFarmer.farmer_id.replace(/^#/, '').trim();
          const cached = await getFarmerCumulativeRef.current(cleanId, selectedRouteCode || undefined);
          const baseCount = cached?.baseCount || 0;
          const baseProd = cached?.byProduct || [];
          const unsynced = await getUnsyncedWeightForFarmerRef.current(cleanId, selectedRouteCode || undefined);
          const merged: Record<string, { icode: string; product_name: string; weight: number }> = {};
          for (const p of baseProd) {
            const key = (p.icode || '').trim().toUpperCase();
            merged[key] = { ...p, icode: key };
          }
          for (const p of unsynced.byProduct) {
            const key = (p.icode || '').trim().toUpperCase();
            if (merged[key]) merged[key].weight += p.weight;
            else merged[key] = { ...p, icode: key };
          }
          const newCumulative = filterCumulativeByProduct({ total: baseCount + unsynced.total, byProduct: Object.values(merged) }, currentProduct?.icode);

          setCumulativeFrequency(prev => {
            if (prev && newCumulative && reason === 'post-sync') {
              if (newCumulative.total < prev.total) {
                console.warn(`🛡️ Floor guard: preventing cumulative drop from ${prev.total} to ${newCumulative.total} (post-sync lag)`);
                return prev;
              }
            }
            return newCumulative;
          });
        }

        lastCumulativeRefreshAt = Date.now();
      } catch (err) {
        console.warn(`Cumulative refresh (${reason}) failed:`, err);
      } finally {
        refreshInProgress = false;
        if (pendingRefresh) {
          const nextReason = pendingRefresh;
          pendingRefresh = null;
          setTimeout(() => refreshCumulativesBatch(nextReason), 500);
        }
      }
    };

    // v2.10.89: syncComplete — trailing-edge debounce (5 s). Bursts of
    // per-record syncComplete events collapse into ONE refresh. If the
    // dispatch passes detail.synced === 0 we skip entirely (nothing changed).
    const handleSyncComplete = (e: Event) => {
      const detail = (e as CustomEvent).detail as { synced?: number } | undefined;
      if (detail && typeof detail.synced === 'number' && detail.synced === 0) {
        return;
      }
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
      syncDebounceTimer = setTimeout(() => {
        syncDebounceTimer = null;
        refreshCumulativesBatch('post-sync');
      }, SYNC_DEBOUNCE_MS);
    };
    window.addEventListener('syncComplete', handleSyncComplete);

    // v2.10.89: Visibility refresh — only when last refresh is stale (>2 min)
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      if ((window as any).__cumulativeSyncRunning) return;
      if (Date.now() - lastCumulativeRefreshAt < VISIBILITY_STALE_MS) return;
      refreshCumulativesBatch('visibility');
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // v2.10.89: Periodic refresh — 10 min (was 3 min)
    const intervalId = setInterval(() => {
      if (navigator.onLine && !(window as any).__cumulativeSyncRunning) {
        refreshCumulativesBatch('periodic');
      }
    }, PERIODIC_REFRESH_MS);

    // v2.10.102: Online listener — when a previously-offline device reconnects,
    // immediately pre-warm the route-wide farmer_cumulative cache so the next
    // offline drop has baseCounts for every farmer on the route. Bypasses the
    // 60 s throttle gate via the 'online' forced reason.
    const handleOnline = () => {
      if (!(window as any).__cumulativeSyncRunning) {
        refreshCumulativesBatch('online');
      }
    };
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('syncComplete', handleSyncComplete);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      clearInterval(intervalId);
      if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    };
  }, [selectedRouteCode, deviceFingerprint, showCumulative, updateFarmerCumulative, saveFarmers, settings.cumulative_frequency_status, settings.printcumm]);

  // ========== FAST CUMULATIVE PRE-FETCH (BATCH API) ==========
  // Uses single batch endpoint instead of 3558 individual API calls
  // Falls back to individual calls only if batch endpoint is unavailable
  useEffect(() => {
    if (!showCumulative || !deviceFingerprint || !navigator.onLine || !isReady) return;

    // Module-level guard: prevent duplicate sync across re-renders
    if ((window as any).__cumulativeSyncRunning) {
      console.log('📦 Pre-fetch: already in progress (skipping duplicate)');
      return;
    }

    // v2.10.89: Skip pre-fetch if a full batch refresh completed in the last 60 s.
    // Route switches no longer trigger a redundant 3k-farmer refetch when the
    // refresh effect just covered the same ground.
    if (Date.now() - lastCumulativeRefreshAt < MIN_REFRESH_GAP_MS) {
      console.log('📦 Pre-fetch: skipped (cumulative refreshed <60s ago)');
      return;
    }

    (window as any).__cumulativeSyncRunning = true;
    
    const prefetchCumulatives = async () => {
      try {
        // Step 1: Fetch farmer list from API
        const response = await mysqlApi.farmers.getByDevice(deviceFingerprint);
        if (!response.success || !response.data) {
          console.warn('📦 Pre-fetch: failed to fetch farmers from API');
          (window as any).__cumulativeSyncRunning = false;
          return;
        }
        
        const allFarmers = response.data;
        const deviceCcode = localStorage.getItem('device_ccode') || '';
        // v2.10.40: gating now driven by psettings.cumulative_frequency_status (or legacy printcumm)
        const cumulativeEnabled = (settings.cumulative_frequency_status === 1) || (settings.printcumm === 1);
        const ccodeFarmers = deviceCcode ? allFarmers.filter(f => f.ccode === deviceCcode) : allFarmers;
        const farmersToCache = cumulativeEnabled ? ccodeFarmers : [];
        
        // Save ALL farmers to IndexedDB for FarmerSyncDashboard
        saveFarmers(allFarmers);
        
        if (farmersToCache.length === 0) {
          console.log(`📦 Pre-fetch: No qualifying farmers to cache (cumulative_frequency_status=${settings.cumulative_frequency_status}, printcumm=${settings.printcumm})`);
          (window as any).__cumulativeSyncRunning = false;
          return;
        }
        
        console.log(`📦 Pre-fetch: ${farmersToCache.length} qualifying farmers. Trying batch API...`);
        
        // Dispatch initial progress
        window.dispatchEvent(new CustomEvent('cumulative-sync-progress', {
          detail: { current: 0, total: farmersToCache.length, pass: 1 }
        }));
        
        // Step 2: Try batch endpoint first (1 request instead of 3558)
        let batchSuccess = false;
        const batchLabel = `cumulative-prefetch route=${selectedRouteCode || 'ALL'}`;
        cumulativeMonitor.startBatch(batchLabel, farmersToCache.length, { source: 'prefetch' });
        try {
          const batchResult = await mysqlApi.farmerFrequency.getMonthlyFrequencyBatch(deviceFingerprint, selectedRouteCode || undefined);
          if (batchResult.success && batchResult.data && batchResult.data.farmers) {
            const batchMap = new Map<string, number>();
            const batchByProductMap = new Map<string, Array<{ icode: string; product_name: string; weight: number }>>();
            for (const f of batchResult.data.farmers) {
              const key = f.farmer_id.trim();
              batchMap.set(key, f.cumulative_weight);
              batchByProductMap.set(key, f.by_product || []);
            }

            // Write all cumulative data to IndexedDB in batches
            const WRITE_BATCH = 50;
            let written = 0;
            // v2.10.119: collect farmers where the batch write was stale-rejected
            // (persisted > batch incoming). Those need a per-farmer reconfirm
            // against the individual endpoint to either heal up (if individual
            // returns higher than persisted) or to surface a persistent gap.
            const reconfirmCandidates: Array<{ fId: string; batchIncoming: number; persisted: number }> = [];
            const batchSnapshotId = (batchResult.data as any)?.snapshot_max_id;
            for (let i = 0; i < farmersToCache.length; i += WRITE_BATCH) {
              const batch = farmersToCache.slice(i, i + WRITE_BATCH);
              await Promise.all(batch.map(async (farmer) => {
                const fId = farmer.farmer_id.replace(/^#/, '').trim();
                const weight = batchMap.get(fId) ?? 0;
                try {
                  const persistedAfter = await updateFarmerCumulative(fId, weight, true, batchByProductMap.get(fId) || [], selectedRouteCode || undefined, { verifySource: 'W3:prewarm-batch', caller: 'Index/loadCumulativeBatch' });
                  cumulativeMonitor.batchOk(batchLabel);
                  // Stale-reject signature: returned baseCount strictly greater
                  // than the value we tried to write. Schedule reconfirm.
                  if (typeof persistedAfter === 'number' && persistedAfter > weight + 0.0001) {
                    reconfirmCandidates.push({ fId, batchIncoming: weight, persisted: persistedAfter });
                  }
                } catch {
                  cumulativeMonitor.batchFail(batchLabel);
                }
              }));
              written += batch.length;

              // Dispatch progress
              window.dispatchEvent(new CustomEvent('cumulative-sync-progress', {
                detail: { current: written, total: farmersToCache.length, pass: 1 }
              }));

              // Yield to main thread
              if (i + WRITE_BATCH < farmersToCache.length) {
                await new Promise(r => setTimeout(r, 0));
              }
            }

            batchSuccess = true;

            // v2.10.119: W3-RECONFIRM pass — capped, fire-and-forget, never
            // blocks the prewarm. For each stale-rejected farmer, call the
            // individual endpoint with a 2s hard timeout. If individual >
            // persisted → heal up via updateFarmerCumulative (free increase).
            // If individual ≤ persisted → log persistent-gap and keep
            // persisted (existing stale-reject behaviour). Strictly additive.
            if (reconfirmCandidates.length > 0 && navigator.onLine) {
              const MAX_RECONFIRM = 25;
              const targets = reconfirmCandidates.slice(0, MAX_RECONFIRM);
              setTimeout(() => {
                (async () => {
                  for (const t of targets) {
                    try {
                      const indPromise = mysqlApi.farmerFrequency.getMonthlyFrequency(t.fId, deviceFingerprint, selectedRouteCode || undefined);
                      const indRes: any = await Promise.race([
                        indPromise,
                        new Promise((resolve) => setTimeout(() => resolve({ success: false, _timeout: true }), 2000))
                      ]);
                      if (!indRes || !indRes.success || !indRes.data) {
                        plog.info('CUM:W3-RECONFIRM-TIMEOUT',
                          `${t.fId} route=${selectedRouteCode || 'ALL'} individual fetch failed/timeout; keeping persisted=${t.persisted}`,
                          { farmerId: t.fId, route: selectedRouteCode || 'ALL', persisted: t.persisted, batchIncoming: t.batchIncoming, snapshot_max_id_batch: batchSnapshotId });
                        continue;
                      }
                      const individual = Number(indRes.data.cumulative_weight) || 0;
                      if (individual > t.persisted + 0.0001) {
                        await updateFarmerCumulative(t.fId, individual, true, indRes.data.by_product || [], selectedRouteCode || undefined, { verifySource: 'W3:reconfirm-heal', caller: 'Index/w3Reconfirm' });
                        plog.info('CUM:W3-RECONFIRM-HEAL-UP',
                          `${t.fId} route=${selectedRouteCode || 'ALL'} individual=${individual} > persisted=${t.persisted} (batch=${t.batchIncoming})`,
                          { farmerId: t.fId, route: selectedRouteCode || 'ALL', persisted: t.persisted, batchIncoming: t.batchIncoming, individual, snapshot_max_id_batch: batchSnapshotId });
                      } else if (Math.abs(individual - t.batchIncoming) < 0.0001 && individual < t.persisted) {
                        plog.info('CUM:W3-RECONFIRM-PERSISTENT-GAP',
                          `${t.fId} route=${selectedRouteCode || 'ALL'} batch=${t.batchIncoming} individual=${individual} both < persisted=${t.persisted}`,
                          { farmerId: t.fId, route: selectedRouteCode || 'ALL', persisted: t.persisted, batchIncoming: t.batchIncoming, individual, snapshot_max_id_batch: batchSnapshotId });
                      } else {
                        plog.info('CUM:W3-RECONFIRM-OK',
                          `${t.fId} route=${selectedRouteCode || 'ALL'} individual=${individual} ≥ persisted=${t.persisted} (batch=${t.batchIncoming}) — keeping persisted`,
                          { farmerId: t.fId, route: selectedRouteCode || 'ALL', persisted: t.persisted, batchIncoming: t.batchIncoming, individual, snapshot_max_id_batch: batchSnapshotId });
                      }
                    } catch (e) {
                      // Never throw from reconfirm
                    }
                    // Light yield between farmers
                    await new Promise(r => setTimeout(r, 50));
                  }
                })();
              }, 0);
            }
          }
        } catch (batchErr) {
          console.warn('📦 Batch endpoint unavailable, falling back to individual calls:', batchErr);
        }
        if (batchSuccess) cumulativeMonitor.endBatch(batchLabel);
        
        
        // Step 3: Fallback — individual calls with multi-pass retry (only if batch failed)
        if (!batchSuccess) {
          const now = new Date();
          const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const uncachedFarmers: typeof farmersToCache = [];
          
          for (const farmer of farmersToCache) {
            const fId = farmer.farmer_id.replace(/^#/, '').trim();
            const cached = await getFarmerCumulative(fId, selectedRouteCode || undefined);
            if (cached && cached.month === month) continue;
            uncachedFarmers.push(farmer);
          }
          
          const alreadyCached = farmersToCache.length - uncachedFarmers.length;
          console.log(`📦 Fallback: ${alreadyCached} already cached, ${uncachedFarmers.length} to fetch individually`);
          
          if (uncachedFarmers.length > 0) {
            const MAX_PASSES = 5;
            let totalCached = alreadyCached;
            let remaining = uncachedFarmers;
            
            for (let pass = 1; pass <= MAX_PASSES && remaining.length > 0; pass++) {
              if (!navigator.onLine) break;
              
              const BATCH_SIZE = pass === 1 ? 25 : 10;
              const TIMEOUT = pass === 1 ? 5000 : pass <= 3 ? 8000 : 12000;
              const failed: typeof remaining = [];
              let passSuccess = 0;
              
              for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
                if (!navigator.onLine) break;
                const batch = remaining.slice(i, i + BATCH_SIZE);
                
                const results = await Promise.allSettled(batch.map(async (farmer) => {
                  const fId = farmer.farmer_id.replace(/^#/, '').trim();
                  const res = await Promise.race([
                    mysqlApi.farmerFrequency.getMonthlyFrequency(fId, deviceFingerprint, selectedRouteCode || undefined),
                    new Promise<{ success: false }>((resolve) => setTimeout(() => resolve({ success: false }), TIMEOUT))
                  ]);
                  if (res.success && res.data) {
                    await updateFarmerCumulative(fId, res.data.cumulative_weight ?? 0, true, res.data.by_product || [], selectedRouteCode || undefined, { verifySource: 'W3:prewarm-batch-fallback', caller: 'Index/cumulativeFallbackPass' });
                    return true;
                  }
                  return false;
                }));
                
                results.forEach((r, idx) => {
                  if (r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)) {
                    failed.push(batch[idx]);
                  } else {
                    passSuccess++;
                  }
                });

                const currentTotalCached = totalCached + passSuccess;
                window.dispatchEvent(new CustomEvent('cumulative-sync-progress', {
                  detail: { current: currentTotalCached, total: farmersToCache.length, pass }
                }));
                
                if (i + BATCH_SIZE < remaining.length) {
                  await new Promise(r => setTimeout(r, pass === 1 ? 20 : 100));
                }
              }
              
              totalCached += passSuccess;
              remaining = failed;
              
              const coverage = Math.round((totalCached / farmersToCache.length) * 100);
              console.log(`📦 Pass ${pass} done: +${passSuccess}, ${remaining.length} failed, ${coverage}% coverage`);
              
              if (remaining.length > 0 && pass < MAX_PASSES) {
                await new Promise(r => setTimeout(r, pass * 3000));
              }
            }
          }
        }
        
        // Signal completion
        window.dispatchEvent(new CustomEvent('cumulative-sync-progress', {
          detail: { current: farmersToCache.length, total: farmersToCache.length, pass: 0 }
        }));

        // v2.10.89: stamp the throttle gate so the refresh effect doesn't
        // immediately re-fetch what we just loaded.
        lastCumulativeRefreshAt = Date.now();

      } catch (err) {
        console.warn('Pre-fetch cumulative failed:', err);
      } finally {
        (window as any).__cumulativeSyncRunning = false;
      }
    };
    
    const timer = setTimeout(prefetchCumulatives, 5000);
    
    return () => {
      clearTimeout(timer);
      // NOTE: We do NOT set cancelled or reset the guard here.
      // The sync continues running even if the component re-renders.
    };
  }, [isReady, showCumulative, deviceFingerprint, selectedRouteCode, updateFarmerCumulative, saveFarmers, getFarmerCumulative]);

  // NOTE: Printed receipts are now loaded from ReprintContext, no need to load here
  // The ReprintProvider handles loading from IndexedDB

  // Reset lastSavedWeight when weight is 0 (ready for next collection) - applies to both scale and manual entry
  useEffect(() => {
    if (weight === 0 && lastSavedWeight > 0) {
      setLastSavedWeight(0);
    }
  }, [weight, lastSavedWeight]);

  // zeroOpt: Continuously check weight - unlock when it drops to ≤0.5 kg
  // This applies to BOTH scale readings AND manual weight changes
  useEffect(() => {
    if (requireZeroScale && captureLocked && weight <= 0.5) {
      setCaptureLocked(false);
      console.log('🔓 zeroOpt: Weight ≤0.5 kg detected, captureLocked=false, next capture allowed');
    }
  }, [weight, requireZeroScale, captureLocked]);

  const handleLogin = (user: AppUser, offline: boolean, password?: string) => {
    login(user, offline, password);
  };

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
  };

  const handleSelectFarmer = (farmer: Farmer) => {
    // Strip any leading # from farmer_id (some databases store it with prefix)
    const cleanFarmerId = farmer.farmer_id.replace(/^#/, '');
    setFarmerId(cleanFarmerId);
    setFarmerName(farmer.name);
    setRoute(farmer.route);
    setSelectedFarmer(farmer); // Store full farmer object including multOpt
    setSearchValue(`${farmer.farmer_id} - ${farmer.name}`);
    
    // zeroOpt: Reset captureLocked when a NEW member is selected
    // This allows immediate capture for the new farmer
    if (lastCapturedFarmerId !== cleanFarmerId) {
      setCaptureLocked(false);
      console.log('🔄 zeroOpt: New member selected, captureLocked=false');
    }

    // Pre-fetch cumulative for this farmer (online: seed cache, offline: use local data)
    if (showCumulative && deviceFingerprint) {
      (async () => {
        try {
          if (navigator.onLine) {
            const freqResult = await Promise.race([
              mysqlApi.farmerFrequency.getMonthlyFrequency(cleanFarmerId, deviceFingerprint, selectedRouteCode || undefined),
              new Promise<{ success: false }>((resolve) => setTimeout(() => resolve({ success: false }), 3000))
            ]);
            if (freqResult.success && freqResult.data) {
              const cloudCumulative = freqResult.data.cumulative_weight ?? 0;
              const cloudByProduct = freqResult.data.by_product || [];
              await updateFarmerCumulative(cleanFarmerId, cloudCumulative, true, cloudByProduct, selectedRouteCode || undefined, { verifySource: 'W4:on-select-fetch', caller: 'Index/onFarmerSelect' });
              // Fresh unsynced weight from actual IndexedDB receipts (no cached localCount)
              const unsynced = await getUnsyncedWeightForFarmer(cleanFarmerId, selectedRouteCode || undefined);
              // Merge by-product
              const merged: Record<string, { icode: string; product_name: string; weight: number }> = {};
              for (const p of cloudByProduct) {
                const key = (p.icode || '').trim().toUpperCase();
                merged[key] = { ...p, icode: key };
              }
              for (const p of unsynced.byProduct) {
                const key = (p.icode || '').trim().toUpperCase();
                if (merged[key]) merged[key].weight += p.weight;
                else merged[key] = { ...p, icode: key };
              }
              setCumulativeFrequency(filterCumulativeByProduct({ total: cloudCumulative + unsynced.total, byProduct: Object.values(merged) }, selectedProduct?.icode));
              console.log(`📊 Pre-fetched cumulative for ${cleanFarmerId}: cloud=${cloudCumulative}, unsynced=${unsynced.total}`);
              return;
            }
          }
          // Offline or fetch failed: baseCount + fresh unsynced receipts (no double-counting)
          const total = await getFarmerTotalCumulative(cleanFarmerId, selectedRouteCode || undefined);
          const filtered = filterCumulativeByProduct(total, selectedProduct?.icode);
          setCumulativeFrequency(filtered);
          console.log(`📊 Offline cumulative for ${cleanFarmerId}: total=${total.total}`);
        } catch (err) {
          console.warn('Failed to pre-fetch cumulative:', err);
        }
      })();
    }
  };

  const handleRouteChange = (selectedRoute: Route | null) => {
    if (selectedRoute) {
      setSelectedRouteCode(selectedRoute.tcode.trim());
      setSelectedRouteMprefix(selectedRoute.mprefix || '');
      setRouteName(selectedRoute.descript);
      // Clear farmer and cumulative when route changes
      setFarmerId('');
      setFarmerName('');
      setRoute('');
      setSearchValue('');
      setCumulativeFrequency(undefined);
    } else {
      setSelectedRouteCode('');
      setSelectedRouteMprefix('');
      setRouteName('');
      setFarmerId('');
      setFarmerName('');
      setRoute('');
      setSearchValue('');
      setCumulativeFrequency(undefined);
    }
  };


  const handleSessionChange = (selectedSession: Session | null) => {
    if (selectedSession) {
      setSession(selectedSession.descript);
      setActiveSession(selectedSession);
    } else {
      setSession('');
      setActiveSession(null);
    }
  };

  const handleClearFarmer = () => {
    setFarmerId('');
    setFarmerName('');
    setSelectedFarmer(null);
    setRoute('');
    setSearchValue('');
    setWeight(0);
    setCapturedCollections([]);
    setLastSavedWeight(0);
    // Reset zeroOpt capture lock when farmer is cleared
    setCaptureLocked(false);
    // Clear cumulative to prevent stale data display
    setCumulativeFrequency(undefined);
    // Keep route selection when clearing farmer
    toast.info('Farmer details cleared');
  };

  const handleClearRoute = () => {
    setSelectedRouteCode('');
    setSelectedRouteMprefix('');
    setRouteName('');
    setFarmerId('');
    setFarmerName('');
    setSelectedFarmer(null);
    setRoute('');
    setSearchValue('');
    setWeight(0);
    setCapturedCollections([]);
    setLastSavedWeight(0);
    // Clear cumulative to prevent stale data display
    setCumulativeFrequency(undefined);
    toast.info('Route and farmer cleared');
  };

  // Handle starting collection from Dashboard (Buy Produce)
  const handleStartCollection = (route: Route, session: Session, product: Item | null) => {
    setSelectedRouteCode(route.tcode);
    setSelectedRouteMprefix(route.mprefix || '');
    setRouteName(route.descript);
    setSession(session.descript);
    setActiveSession(session);
    setSelectedProduct(product);
    setCollectionMode('buy');
    setShowCollection(true);
  };

  // Handle starting selling from Dashboard (Sell Produce)
  const handleStartSelling = (route: Route, session: Session, product: Item | null) => {
    setSelectedRouteCode(route.tcode);
    setSelectedRouteMprefix(route.mprefix || '');
    setRouteName(route.descript);
    setSession(session.descript);
    setActiveSession(session);
    setSelectedProduct(product);
    setCollectionMode('sell');
    setShowCollection(true);
  };

  // Handle going back to dashboard
  const handleBackToDashboard = () => {
    setShowCollection(false);
    // Clear collection state
    handleClearRoute();
  };

  // CAPTURE: Only stores locally, does NOT submit to database
  const handleCapture = async () => {
    // Validate route selection first
    if (!selectedRouteCode) {
      toast.error('Please select a route first');
      return;
    }

    // Validate active session
    if (!activeSession) {
      toast.error('No active session. Data entry is not allowed outside session hours.');
      return;
    }

    // For debtors (D prefix): they typically have empty route in DB, so use dashboard-selected route
    const effectiveRoute = route || selectedRouteCode;
    if (!farmerId || !effectiveRoute || !weight || !session) {
      toast.error('Enter farmer, route, session, and weight');
      return;
    }

    // Prevent capturing zero weight entries - must have actual weight from scale or manual
    if (weight === 0 || weight <= 0) {
      toast.error('Cannot capture zero weight. Please place item on scale or enter weight manually.');
      return;
    }

    // Validate single farmer for consecutive captures
    if (capturedCollections.length > 0) {
      const firstCapture = capturedCollections[0];
      if (firstCapture.farmer_id !== farmerId) {
        toast.error(`Please submit/print receipts for ${firstCapture.farmer_name} before capturing for a different farmer`);
        return;
      }
    }

    // zeroOpt enforcement (psettings.zeroopt=1):
    // While captureLocked=true, do NOT allow capture (scale or manual)
    // Only one capture per unlock - lock must reset before another record can be captured
    if (requireZeroScale && captureLocked && weight > 0.5) {
      toast.error('Weight must drop to 0.5 Kg or below before next capture. Clear weight or remove container.');
      return;
    }
    
    // Get supervisor mode capture restrictions
    const supervisorMode = getCaptureMode(currentUser?.supervisor);
    
    // Enforce supervisor mode restrictions
    if (entryType === 'manual' && !supervisorMode.allowManual) {
      toast.error('Manual weight entry is disabled by supervisor settings. Please use the digital scale.');
      return;
    }
    if (entryType === 'scale' && !supervisorMode.allowDigital) {
      toast.error('Digital scale is disabled by supervisor settings. Please enter weight manually.');
      return;
    }
    
    // Enforce autow (psettings): restrict to digital scale only when enabled
    // This only applies if supervisor allows digital capture
    if (autoWeightOnly && entryType === 'manual' && supervisorMode.allowDigital) {
      toast.error('Manual weight entry is disabled. Please use the digital scale.');
      return;
    }

    // Derive AM/PM from the active session's time_from (hour-based) for dairy.
    // For coffee mode, the BACKEND `session` column must carry SCODE (NOT descript,
    // NEVER AM/PM). The descript is only kept for receipts/UI via session_descript.
    const timeFrom = typeof activeSession.time_from === 'number' 
      ? activeSession.time_from 
      : parseInt(String(activeSession.time_from), 10);
    const amPmSession: 'AM' | 'PM' = (timeFrom >= 12) ? 'PM' : 'AM';
    // v2.10.51: coffee → SCODE (DB session col); dairy → AM/PM
    const currentSessionType = isCoffee
      ? (activeSession.SCODE || activeSession.descript || amPmSession)
      : amPmSession;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // ========== multOpt=0 CAPTURE BEHAVIOR ==========
    // IMPORTANT: Capture phase does NOT check for duplicates or blacklist.
    // Multiple captures are allowed (e.g., farmer brings 3 buckets = 3 captures).
    // ALL duplicate/multiOpt validation happens ONLY at SUBMIT time.
    // This ensures no premature member flagging, no incorrect DB state, and no reprint popups during capture.
    // NOTE: Sell Portal (transtype=2) ignores multOpt entirely - farmers can sell unlimited times per session
    const farmerMultOpt = collectionMode === 'sell' ? 1 : (selectedFarmer?.multOpt ?? 1);
    // ========== END multOpt CHECK ==========

    // Generate reference number for this capture
    // Rule: Each capture gets unique transrefno, but all captures for same farmer in session share ONE uploadrefno
    const deviceFingerprint = await generateDeviceFingerprint();
    let referenceNo = '';
    let uploadRefNo: string | undefined;
    
    // Check if we already have captures for this farmer *for this same session and date*
    // and reuse their uploadrefno to group related rows.
    const todayStr = new Date().toISOString().split('T')[0];
    const existingFarmerCapture = capturedCollections.find(c => {
      const captureDate = new Date(c.collection_date).toISOString().split('T')[0];
      return (
        c.farmer_id === farmerId.replace(/^#/, '').trim() &&
        c.session === currentSessionType &&
        captureDate === todayStr
      );
    });
    
    if (existingFarmerCapture && existingFarmerCapture.uploadrefno) {
      // Reuse existing uploadrefno, generate only new transrefno
      uploadRefNo = existingFarmerCapture.uploadrefno;
      referenceNo = await generateTransRefOnly() || '';
      if (!referenceNo) {
        toast.error('Failed to generate reference number.');
        return;
      }
      console.log(`⚡ Reusing uploadrefno=${uploadRefNo}, new transrefno=${referenceNo}`);
    } else {
      // First capture for this farmer - generate both transrefno and uploadrefno
      const refResult = await generateReferenceWithUploadRef('milk');
      if (refResult) {
        referenceNo = refResult.transrefno;
        uploadRefNo = refResult.uploadrefno;
        console.log(`⚡ Generated: transrefno=${referenceNo}, uploadrefno=${uploadRefNo} (milk)`);
      } else {
        toast.error('Failed to generate reference number.');
        return;
      }
    }

    // Create local capture record (NOT synced to DB yet)
    // Clean farmer_id - reuse currentSessionType computed above
    const cleanFarmerId = farmerId.replace(/^#/, '').trim();
    
    // For coffee mode: weight = net, also store gross/tare/net
    // For dairy mode: weight = total weight (no tare deduction)
    const captureWeight = parseFloat(Number(weight).toFixed(2));
    
    const captureData: MilkCollection = {
      reference_no: referenceNo,
      uploadrefno: uploadRefNo, // Type-specific ID for approval workflow
      farmer_id: cleanFarmerId,
      farmer_name: farmerName.trim(),
      route: selectedRouteCode.trim(), // Use fm_tanks.tcode, not farmer.route
      session: currentSessionType, // Use already-computed session
      session_descript: activeSession?.descript || currentSessionType, // Full session description for display
      weight: captureWeight, // Net weight for coffee, total for dairy
      user_id: currentUser?.user_id || 'unknown', // Login user_id for DB userId column
      clerk_name: currentUser ? (currentUser.username || currentUser.user_id) : 'unknown', // Display name for clerk column
      collection_date: new Date(),
      multOpt: farmerMultOpt,
      orderId: Date.now(),
      synced: false, // Not synced - only locally captured
      // Product info from selected produce item (invtype=01)
      product_code: selectedProduct?.icode, // → DB: icode column
      product_name: selectedProduct?.descript,
      // Entry type: 'scale' for Bluetooth readings, 'manual' for manual input
      entry_type: entryType,
      // Season SCODE from active session → DB: CAN column
      season_code: activeSession?.SCODE || '',
      // Transaction type: 1 = Buy Produce (from farmers), 2 = Sell Produce (to farmers/debtors)
      transtype: collectionMode === 'sell' ? 2 : 1,
      // Delivery tracking
      delivered_by: deliveredBy || 'owner',
      // Coffee sack weighing - gross/tare/net (orgtype C only)
      ...(isCoffee && {
        gross_weight: parseFloat(Number(grossWeight).toFixed(2)),
        tare_weight: tareWeight,
        net_weight: captureWeight, // Same as weight for coffee
      }),
    };

    console.log('🔵 CAPTURE #' + (capturedCollections.length + 1) + ' - Local capture only (not submitted)');
    console.log('📝 Reference:', referenceNo, 'UploadRef:', uploadRefNo);
    console.log('👤 Farmer:', farmerId, farmerName);
    if (isCoffee) {
      console.log('☕ Coffee weighing - Gross:', grossWeight, 'Tare:', tareWeight, 'Net:', captureWeight, 'kg');
    } else {
      console.log('⚖️ Weight:', captureData.weight, 'Kg');
    }

    // Add to captured collections for display
    setCapturedCollections(prev => [...prev, captureData]);
    
    // zeroOpt: After capture, set captureLocked=true
    // Next capture blocked until weight ≤0.5 kg (scale or manual)
    setCaptureLocked(true);
    setLastCapturedFarmerId(farmerId);
    console.log('🔒 zeroOpt: Capture completed, captureLocked=true, next capture blocked until weight ≤0.5 kg');
    
    // NOTE: For multOpt=0 farmers, we do NOT add to blacklist on capture.
    // Blacklisting happens ONLY after successful submission in handleSubmit.
    // This allows unlimited weight captures (multiple buckets) but only one submission per session.
    
    // Store the saved weight for next collection check
    setLastSavedWeight(weight);

    // Reset weight for next capture
    setWeight(0);
    setGrossWeight(0);
    
    toast.success(`Captured ${captureData.weight} Kg${isCoffee ? ' (net)' : ''}`);
  };

  // SUBMIT: Saves all captured collections to database (online) or IndexedDB (offline)
  // Rule: Each capture is its own DB transaction with its own transrefno (reference_no).
  // Related captures (same farmer workflow) share the same uploadrefno.
  const handleSubmit = async () => {
    if (capturedCollections.length === 0) {
      toast.error('No collections captured yet');
      return;
    }

    // Prevent multiple submissions
    if (isSubmitting) return;
    setIsSubmitting(true);

    const deviceFingerprint = await generateDeviceFingerprint();
    
    // ========== PRE-SUBMIT VALIDATION for multOpt=0 ==========
    // Check if ANY captured collection is from a farmer who has already submitted
    // This is the ONLY place where blacklist/sessionSubmittedFarmers checks occur
    // NOTE: Sell Portal (transtype=2) skips multOpt validation - unlimited sells allowed
    for (const capture of capturedCollections) {
      // Skip multOpt check for Sell Portal transactions (transtype=2)
      if (capture.transtype === 2) continue;
      
      if (capture.multOpt === 0) {
        const cleanFarmerId = capture.farmer_id.replace(/^#/, '').trim();
        
        // Check local session tracking first (immediate feedback)
        if (sessionSubmittedFarmers.has(cleanFarmerId)) {
          toast.error(
            `${capture.farmer_name} has already submitted in this session. Clear captures and try again.`,
            { duration: 5000 }
          );
          setCapturedCollections([]);
          setIsSubmitting(false);
          return;
        }
        
        // Check blacklist (populated from IndexedDB + online records)
        if (isBlacklisted(cleanFarmerId)) {
          toast.error(
            `${capture.farmer_name} has already delivered in this session today. Clear captures and try again.`,
            { duration: 5000 }
          );
          setCapturedCollections([]);
          setIsSubmitting(false);
          return;
        }
      }
    }
    // ========== END PRE-SUBMIT VALIDATION ==========

    let successCount = 0;
    let offlineCount = 0;
    let hardStopped = false;

    // Check network status first
    const isOnline = navigator.onLine;
    
    // Each capture is saved separately in the database - no accumulation
    console.log(`📦 Processing ${capturedCollections.length} captures`);

    // Dispatch sync start event (fire and forget)
    window.dispatchEvent(new CustomEvent('syncStart'));

    // OPTIMIZED: Pre-generate all data needed for printing BEFORE network calls
    const printData = {
      collections: [...capturedCollections],
      companyName,
      printCopies,
      routeLabel,
      periodLabel,
      locationCode: selectedRouteCode,
      locationName: routeName,
      clerkName: currentUser?.username || '',
      productName: selectedProduct?.descript,
      shouldShowCumulativeForFarmer: showCumulative,
      farmerIdForCumulative: selectedFarmer?.farmer_id?.replace(/^#/, '').trim() || '',
      productIcode: selectedProduct?.icode, // Capture for background print filtering
      routeCode: selectedRouteCode, // Capture route for background cumulative filtering
      previousCumulativeTotal: cumulativeFrequency?.total ?? 0, // For race condition guard
      justSubmittedWeight: capturedCollections.reduce((sum, c) => sum + Number(c.weight || 0), 0), // Weight being submitted
      submittedRefs: capturedCollections.map((c) => c.reference_no).filter(Boolean) as string[], // v2.10.107: exclude from unsynced bucket
      deliveredBy: deliveredBy || 'owner', // Pass deliveredBy for receipt printing
    };

    // OPTIMIZED: Process submissions in parallel batches for faster throughput

    for (const capture of capturedCollections) {
      if (isOnline) {
        // ONLINE: Submit directly to database
        try {
          console.log(`📤 Submitting online: ${capture.reference_no} (${capture.weight} Kg)`);

          // v2.10.51: For dairy, normalize to AM/PM. For coffee, send SCODE
          // (capture.session already holds SCODE for coffee — see capture path).
          let sessionToSend: string;
          if (isCoffee) {
            sessionToSend = (capture.season_code || capture.session || '').toString().trim();
          } else {
            let normalizedSession: 'AM' | 'PM' = 'AM';
            const sessionVal = (capture.session || '').trim().toUpperCase();
            if (sessionVal === 'PM' || sessionVal.includes('PM') || sessionVal.includes('EVENING') || sessionVal.includes('AFTERNOON')) {
              normalizedSession = 'PM';
            }
            sessionToSend = normalizedSession;
          }

          // NOTE: We intentionally do NOT check the database here for duplicates.
          // All multOpt=0 validation was done in pre-submit validation BEFORE the loop.
          // Checking inside the loop would cause race conditions where the first capture
          // gets submitted, then subsequent captures for the same farmer see it as a duplicate.

          // Use the reference number generated during capture
          // This ensures the receipt reference matches the database reference
          const referenceNo = capture.reference_no;
          console.log(`📤 Using capture reference: ${referenceNo}`);

          const result = await mysqlApi.milkCollection.create({
            reference_no: referenceNo,
            uploadrefno: capture.uploadrefno, // Pass milkId for approval workflow
            farmer_id: capture.farmer_id.replace(/^#/, '').trim(),
            farmer_name: capture.farmer_name.trim(),
            route: capture.route.trim(),
            session: sessionToSend,
            weight: capture.weight,
            user_id: capture.user_id, // Login user_id for DB userId column
            clerk_name: capture.clerk_name, // Display name for clerk column
            collection_date: capture.collection_date,
            device_fingerprint: deviceFingerprint, // CRITICAL: Required for authorization
            entry_type: capture.entry_type, // Pass entry_type to backend
            product_code: capture.product_code, // Pass selected product icode → DB: icode column
            season_code: capture.season_code, // Pass session SCODE → DB: CAN column
            session_descript: capture.session_descript, // v2.10.50: backend fallback for coffee orgs missing SCODE
            transtype: capture.transtype, // Pass transtype: 1 = Buy, 2 = Sell
            delivered_by: capture.delivered_by, // Delivery tracking
          } as any);

          console.log(`📨 Submit result for ${referenceNo}:`, result);

          if (result.success) {
            successCount++;
            console.log('✅ Submitted to database:', referenceNo);
          } else {
            // Check if it's a duplicate session delivery error
            if (result.error === 'DUPLICATE_SESSION_DELIVERY') {
              console.warn(`⚠️ Member already delivered in ${capture.session} session`);
              toast.error(
                `${capture.farmer_name} has already delivered in the ${capture.session} session today.`,
                { duration: 6000 }
              );
              // Do NOT clear captures and do NOT blacklist here.
              // We hard-stop so we don't accidentally mark this farmer as submitted
              // when the server is rejecting inserts.
              hardStopped = true;
              break;
            }
            // API returned failure, save locally for retry with confirmation
            console.warn('[SYNC] Submit returned failure, saving locally');
            try {
              const saveResult = await saveReceipt({...capture, reference_no: referenceNo});
              if (saveResult?.success) {
                console.log(`[DB] Confirmed save for retry: ${referenceNo}`);
                offlineCount++;
                window.dispatchEvent(new Event('receiptSaved'));
                // Dual-write to native SQLite (fire-and-forget backup)
                saveToLocalDB(referenceNo, 'milk_collection', capture).catch(() => {});
              } else {
                console.error(`[ERROR] Failed to save for retry: ${referenceNo}`);
                toast.error(`Failed to save ${capture.farmer_name}'s collection - please retry`);
              }
            } catch (saveErr) {
              console.error(`[ERROR] Exception saving for retry: ${referenceNo}`, saveErr);
              toast.error(`Critical: Failed to save ${capture.farmer_name}'s collection locally`);
            }
          }
        } catch (err: unknown) {
          // Check if the error response contains duplicate session info
          const errorData = (err as { data?: { error?: string; message?: string; existing_reference?: string } })?.data;
          if (errorData?.error === 'DUPLICATE_SESSION_DELIVERY') {
            console.warn(`[SYNC] Member already delivered in ${capture.session} session`);
            toast.error(
              `${capture.farmer_name} has already delivered in the ${capture.session} session today.`,
              { duration: 6000 }
            );
            // Do NOT clear captures and do NOT blacklist here.
            hardStopped = true;
            break;
          }
          console.error('[ERROR] Submit exception, saving locally:', err);
          // Network error or other failure - save to IndexedDB for later sync with confirmation
          try {
            const saveResult = await saveReceipt(capture);
            if (saveResult?.success) {
              console.log(`[DB] Confirmed offline save: ${capture.reference_no}`);
              offlineCount++;
              window.dispatchEvent(new Event('receiptSaved'));
              // Dual-write to native SQLite (fire-and-forget backup)
              saveToLocalDB(capture.reference_no, 'milk_collection', capture).catch(() => {});
            } else {
              console.error(`[ERROR] Failed offline save: ${capture.reference_no}`);
              toast.error(`Failed to save ${capture.farmer_name}'s collection - please retry`);
            }
          } catch (saveErr) {
            console.error(`[ERROR] Exception in offline save: ${capture.reference_no}`, saveErr);
            toast.error(`Critical: Failed to save ${capture.farmer_name}'s collection locally`);
          }
        }
      } else {
        // OFFLINE: Save to IndexedDB for later sync with confirmation
        try {
          const saveResult = await saveReceipt(capture);
          if (saveResult?.success) {
            console.log(`[DB] Confirmed offline save: ${capture.reference_no}`);
            offlineCount++;
            window.dispatchEvent(new Event('receiptSaved'));
            // Dual-write to native SQLite (fire-and-forget backup)
            saveToLocalDB(capture.reference_no, 'milk_collection', capture).catch(() => {});
          } else {
            console.error(`[ERROR] Offline save failed: ${capture.reference_no}`);
            toast.error(`Failed to save ${capture.farmer_name}'s collection - please retry`);
          }
        } catch (saveErr) {
          console.error(`[ERROR] Exception in offline save: ${capture.reference_no}`, saveErr);
          toast.error(`Critical: Failed to save ${capture.farmer_name}'s collection locally`);
        }
      }
    }

    // Dispatch sync complete event
    window.dispatchEvent(new CustomEvent('syncComplete'));

    // If the server rejected inserts as duplicates, do not proceed with blacklisting,
    // but DO preserve the receipt in Recent Receipts — the operator made and (in
    // printCopies > 0 mode) printed a real transaction. v2.10.67: matches the
    // v2.10.66 Store/AI behaviour so coffee/milk receipts are never silently lost.
    if (hardStopped) {
      try {
        addMilkReceipt(printData.collections).catch(() => {});
        console.log('[REPRINT] Milk receipt preserved despite server duplicate-session rejection');
      } catch {
        // Never let history-save failures interrupt the submit flow.
      }
      toast.error('Submission stopped: server reports this farmer already submitted for this session.', {
        duration: 6000,
      });
      setIsSubmitting(false);
      return;
    }

    // v2.10.67: Defensive last-resort snapshot — if every IndexedDB write failed
    // (successCount === 0 && offlineCount === 0) the normal flow below would
    // skip addMilkReceipt entirely, so we save the snapshot here too. The
    // duplicate guard in ReprintContext makes this idempotent if the normal
    // path also runs (e.g. a partial-success batch).
    if (successCount === 0 && offlineCount === 0 && capturedCollections.length > 0) {
      try {
        addMilkReceipt(printData.collections).catch(() => {});
        console.log('[REPRINT] Milk receipt preserved despite all local saves failing');
      } catch {
        // Never let history-save failures interrupt the submit flow.
      }
    }

    // Show appropriate feedback
    if (successCount > 0) {
      toast.success(`Submitted ${successCount} collection${successCount !== 1 ? 's' : ''} to database`);
    }
    if (offlineCount > 0) {
      if (isOnline) {
        toast.warning(`${offlineCount} collection${offlineCount !== 1 ? 's' : ''} failed, saved for retry`);
      } else {
        toast.info(`${offlineCount} collection${offlineCount !== 1 ? 's' : ''} saved offline, will sync when online`);
      }
    }

    // After processing ALL captures, add multOpt=0 farmers to blacklist and local tracking.
    // Critical: only do this when every capture was either submitted online or saved for retry.
    // This prevents "first record submitted => farmer blacklisted => remaining captures lost".
    // NOTE: Sell Portal (transtype=2) skips blacklisting - unlimited sells allowed per session.
    const processedCount = successCount + offlineCount;
    if (processedCount === capturedCollections.length && processedCount > 0) {
      const newlySubmittedFarmers = new Set<string>();
      
      capturedCollections.forEach(capture => {
        // Skip blacklisting for Sell Portal transactions (transtype=2)
        if (capture.transtype === 2) return;
        
        if (capture.multOpt === 0) {
          const cleanId = capture.farmer_id.replace(/^#/, '').trim();
          addToBlacklist(cleanId);
          newlySubmittedFarmers.add(cleanId);
          console.log(`🚫 Added ${cleanId} to blacklist after successful submission (multOpt=0)`);
        }
      });
      
      // Also add to local session tracking (extra safeguard for edge cases)
      if (newlySubmittedFarmers.size > 0) {
        setSessionSubmittedFarmers(prev => new Set([...prev, ...newlySubmittedFarmers]));
      }
    }

    // Trigger refresh
    setRefreshTrigger(prev => prev + 1);

    // OPTIMIZED: Reset UI IMMEDIATELY for fast response - don't wait for print/cumulative
    if (showCollection) {
      // When printCopies === 0, show receipt modal on screen without printing
      // Calculate cumulative BEFORE showing modal so it displays correctly
      if (printCopies === 0) {
        let computedCumulative: { total: number; byProduct: Array<{ icode: string; product_name: string; weight: number }> } | undefined = cumulativeFrequency;
        if (showCumulative && deviceFingerprint && capturedCollections.length > 0) {
          const firstCapture = capturedCollections[0];
          const cleanId = firstCapture.farmer_id.replace(/^#/, '').trim();

          // Calculate just-submitted weight to guard against race conditions
          const previousCumTotal = cumulativeFrequency?.total ?? 0;
          const justSubmittedWeight = capturedCollections.reduce((sum, c) => sum + Number(c.weight || 0), 0);

          try {
            if (navigator.onLine) {
              // v2.10.106: trusted-floor guard. The old guard trusted only the
              // in-memory `previousCumTotal`, which can lag by days when the
              // dashboard cumulative was last loaded before a previous-day
              // sync caught up. Combined with a stale read-replica result
              // from the backend, the floor `prev+just` silently dropped
              // prior-day deliveries. We now anchor the floor to the cached
              // farmer_cumulative.baseCount (updated on every sync) AND retry
              // the cloud read once on a suspected lag.
              const cachedRow = await getFarmerCumulative(cleanId, selectedRouteCode || undefined);
              const cachedBase = Number(cachedRow?.baseCount || 0);
              const trustedFloor = Math.max(cachedBase, previousCumTotal) + justSubmittedWeight;

              const fetchCloud = () => Promise.race([
                mysqlApi.farmerFrequency.getMonthlyFrequency(cleanId, deviceFingerprint, selectedRouteCode || undefined),
                new Promise<{ success: false }>((resolve) => setTimeout(() => resolve({ success: false }), 2000))
              ]);

              let freqResult = await fetchCloud();
              if (freqResult.success && freqResult.data) {
                let cloudCumulative = freqResult.data.cumulative_weight ?? 0;
                let cloudByProduct = freqResult.data.by_product || [];

                if (cloudCumulative < trustedFloor) {
                  // Suspected read-replica lag: retry once after a short pause.
                  await new Promise((r) => setTimeout(r, 700));
                  const retry = await fetchCloud();
                  if (retry.success && retry.data && (retry.data.cumulative_weight ?? 0) >= trustedFloor) {
                    cloudCumulative = retry.data.cumulative_weight ?? 0;
                    cloudByProduct = retry.data.by_product || cloudByProduct;
                    plog.info('CUM:LAG-RECOVERED',
                      `${cleanId} cloud lag recovered ${freqResult.data.cumulative_weight}→${cloudCumulative} (floor=${trustedFloor})`,
                      { farmerId: cleanId, route: selectedRouteCode, cloud1: freqResult.data.cumulative_weight, cloud2: cloudCumulative, cachedBase, prevCum: previousCumTotal, justSubmitted: justSubmittedWeight, trustedFloor });
                  } else {
                    const cloud2Val = (retry.success && retry.data) ? retry.data.cumulative_weight : null;
                    plog.warn('CUM:LAG-FALLBACK',
                      `${cleanId} cloud<floor cloud=${cloudCumulative} cloud2=${cloud2Val} floor=${trustedFloor} → using floor`,
                      { farmerId: cleanId, route: selectedRouteCode, cloud: cloudCumulative, cloud2: cloud2Val, cachedBase, prevCum: previousCumTotal, justSubmitted: justSubmittedWeight, trustedFloor, used: 'floor' });
                    cloudCumulative = trustedFloor;
                  }
                }

                // Only update cache when cloud value is at least as high as
                // what we already trust — never let an unconfirmed stale read
                // lower the persisted baseCount (mirrors v2.10.94/104 spirit).
                if (cloudCumulative >= cachedBase) {
                  await updateFarmerCumulative(cleanId, cloudCumulative, true, cloudByProduct, selectedRouteCode || undefined, { verifySource: 'W6:onscreen-print', caller: 'Index/onScreenPrint' });
                }
                // v2.10.107: exclude just-submitted refs — cloudCumulative
                // already includes them, the local pending row would double-count.
                const submittedRefs = capturedCollections.map((c) => c.reference_no).filter(Boolean) as string[];
                const unsynced = await getUnsyncedWeightForFarmer(cleanId, selectedRouteCode || undefined, { excludeRefs: submittedRefs });
                const fullUnsynced = await getUnsyncedWeightForFarmer(cleanId, selectedRouteCode || undefined);
                const removed = +(fullUnsynced.total - unsynced.total).toFixed(3);
                if (removed > 0) {
                  plog.info('CUM:DOUBLE-GUARD',
                    `${cleanId} excluded just-submitted ${removed}kg from unsynced (cloud=${cloudCumulative})`,
                    { farmerId: cleanId, route: selectedRouteCode, cloudCumulative, removedWeight: removed, refs: submittedRefs, path: 'on-screen' });
                }
                const merged: Record<string, { icode: string; product_name: string; weight: number }> = {};
                for (const p of cloudByProduct) merged[p.icode] = { ...p };
                for (const p of unsynced.byProduct) {
                  if (merged[p.icode]) merged[p.icode].weight += p.weight;
                  else merged[p.icode] = { ...p };
                }
                computedCumulative = filterCumulativeByProduct({ total: cloudCumulative + unsynced.total, byProduct: Object.values(merged) }, selectedProduct?.icode);
              } else {
                const total = await getFarmerTotalCumulative(cleanId, selectedRouteCode || undefined);
                computedCumulative = filterCumulativeByProduct(total, selectedProduct?.icode);
              }
            } else {
              const total = await getFarmerTotalCumulative(cleanId, selectedRouteCode || undefined);
              computedCumulative = filterCumulativeByProduct(total, selectedProduct?.icode);
            }
          } catch {
            const total = await getFarmerTotalCumulative(cleanId, selectedRouteCode || undefined);
            computedCumulative = filterCumulativeByProduct(total, selectedProduct?.icode);
          }
          setCumulativeFrequency(computedCumulative);
        }
        setIsSubmitting(false);
        setReceiptModalOpen(true);
        // Save receipt for reprinting with the COMPUTED cumulative value
        addMilkReceipt(printData.collections, computedCumulative?.total, computedCumulative?.byProduct).catch(() => {});
        window.dispatchEvent(new CustomEvent('syncComplete'));
        return;
      }

      // Clear state immediately - user can start next transaction right away
      setCapturedCollections([]);
      setCumulativeFrequency(undefined);
      setFarmerId('');
      setFarmerName('');
      setSelectedFarmer(null);
      setSearchValue('');
      setWeight(0);
      setGrossWeight(0);
      setLastSavedWeight(0);
      setDeliveredBy('owner'); // Reset for next farmer
      
      // Reset submitting state immediately
      setIsSubmitting(false);
      
      // Dispatch event to notify child components to focus input
      window.dispatchEvent(new CustomEvent('receiptModalClosed'));
      window.dispatchEvent(new CustomEvent('syncComplete'));
      
      // OPTIMIZED: Run printing and cumulative fetch AFTER UI is reset (non-blocking)
      // This allows user to immediately start next transaction while printing happens in background
      (async () => {
        let cumulativeForPrint: { total: number; byProduct: Array<{ icode: string; product_name: string; weight: number }> } | undefined = undefined;
        
        // Calculate cumulative in background with very short timeout
        if (printData.shouldShowCumulativeForFarmer && deviceFingerprint) {
          try {
            if (navigator.onLine) {
              // v2.10.106: trusted-floor guard (same as on-screen path above).
              const cachedRow = await getFarmerCumulative(printData.farmerIdForCumulative, printData.routeCode || undefined);
              const cachedBase = Number(cachedRow?.baseCount || 0);
              const prevCum = printData.previousCumulativeTotal ?? 0;
              const justSubmitted = printData.justSubmittedWeight ?? 0;
              const trustedFloor = Math.max(cachedBase, prevCum) + justSubmitted;

              const fetchCloud = () => Promise.race([
                mysqlApi.farmerFrequency.getMonthlyFrequency(printData.farmerIdForCumulative, deviceFingerprint, printData.routeCode || undefined),
                new Promise<{ success: false }>((resolve) =>
                  setTimeout(() => resolve({ success: false }), 1500)
                )
              ]);

              const freqResult = await fetchCloud();
              if (freqResult.success && freqResult.data) {
                let cloudCumulative = freqResult.data.cumulative_weight ?? 0;
                let cloudByProduct = freqResult.data.by_product || [];

                if (cloudCumulative < trustedFloor) {
                  await new Promise((r) => setTimeout(r, 700));
                  const retry = await fetchCloud();
                  if (retry.success && retry.data && (retry.data.cumulative_weight ?? 0) >= trustedFloor) {
                    cloudCumulative = retry.data.cumulative_weight ?? 0;
                    cloudByProduct = retry.data.by_product || cloudByProduct;
                    plog.info('CUM:LAG-RECOVERED',
                      `${printData.farmerIdForCumulative} cloud lag recovered ${freqResult.data.cumulative_weight}→${cloudCumulative} (floor=${trustedFloor})`,
                      { farmerId: printData.farmerIdForCumulative, route: printData.routeCode, cloud1: freqResult.data.cumulative_weight, cloud2: cloudCumulative, cachedBase, prevCum, justSubmitted, trustedFloor, path: 'background-print' });
                  } else {
                    const cloud2Val = (retry.success && retry.data) ? retry.data.cumulative_weight : null;
                    plog.warn('CUM:LAG-FALLBACK',
                      `${printData.farmerIdForCumulative} cloud<floor cloud=${cloudCumulative} cloud2=${cloud2Val} floor=${trustedFloor} → using floor`,
                      { farmerId: printData.farmerIdForCumulative, route: printData.routeCode, cloud: cloudCumulative, cloud2: cloud2Val, cachedBase, prevCum, justSubmitted, trustedFloor, used: 'floor', path: 'background-print' });
                    cloudCumulative = trustedFloor;
                  }
                }

                // v2.10.107: exclude just-submitted refs from unsynced bucket.
                const submittedRefs = printData.submittedRefs || [];
                const unsynced = await getUnsyncedWeightForFarmer(printData.farmerIdForCumulative, printData.routeCode || undefined, { excludeRefs: submittedRefs });
                const fullUnsynced = await getUnsyncedWeightForFarmer(printData.farmerIdForCumulative, printData.routeCode || undefined);
                const removed = +(fullUnsynced.total - unsynced.total).toFixed(3);
                if (removed > 0) {
                  plog.info('CUM:DOUBLE-GUARD',
                    `${printData.farmerIdForCumulative} excluded just-submitted ${removed}kg from unsynced (cloud=${cloudCumulative})`,
                    { farmerId: printData.farmerIdForCumulative, route: printData.routeCode, cloudCumulative, removedWeight: removed, refs: submittedRefs, path: 'background-print' });
                }
                const merged: Record<string, { icode: string; product_name: string; weight: number }> = {};
                for (const p of cloudByProduct) merged[p.icode] = { ...p };
                for (const p of unsynced.byProduct) {
                  if (merged[p.icode]) merged[p.icode].weight += p.weight;
                  else merged[p.icode] = { ...p };
                }
                cumulativeForPrint = filterCumulativeByProduct({ total: cloudCumulative + unsynced.total, byProduct: Object.values(merged) }, printData.productIcode);
                // Update cache only when cloud >= cachedBase (don't lower the cache from a stale read).
                if (cloudCumulative >= cachedBase) {
                  updateFarmerCumulative(printData.farmerIdForCumulative, cloudCumulative, true, cloudByProduct, printData.routeCode || undefined, { verifySource: 'W7:background-print', caller: 'Index/backgroundPrint' }).catch(() => {});
                }
              }
            }
            
            // Offline or cloud fetch failed: use baseCount + fresh unsynced receipts
            if (cumulativeForPrint === undefined) {
              const total = await getFarmerTotalCumulative(printData.farmerIdForCumulative, printData.routeCode || undefined);
              cumulativeForPrint = filterCumulativeByProduct(total, printData.productIcode);
            }
          } catch {
            // Fallback: baseCount + unsynced receipts (already includes just-saved offline receipts)
            const total = await getFarmerTotalCumulative(printData.farmerIdForCumulative, printData.routeCode || undefined);
            cumulativeForPrint = filterCumulativeByProduct(total, printData.productIcode);
          }
        }

        // v2.10.102: Diagnostic — if cumulative was supposed to print but
        // resolved to 0, emit a single warn row so /debug surfaces the gap.
        // Most common cause: device captured offline before route-wide
        // pre-warm populated farmer_cumulative for this farmer.
        if (
          printData.shouldShowCumulativeForFarmer &&
          (!cumulativeForPrint || cumulativeForPrint.total === 0)
        ) {
          try {
            plog.warn('CUM:OFFLINE-MISS', 'Cumulative empty at print time', {
              farmerId: printData.farmerIdForCumulative,
              route: printData.routeCode,
              icode: printData.productIcode,
              online: navigator.onLine,
              reason: 'no-baseCount-cached',
            });
          } catch {}
        }

        // Print in background - don't block anything
        printMilkReceiptDirect(printData.collections, {
          companyName: printData.companyName,
          printCopies: printData.printCopies,
          routeLabel: printData.routeLabel,
          periodLabel: printData.periodLabel,
          locationCode: printData.locationCode,
          locationName: printData.locationName,
          cumulativeFrequency: cumulativeForPrint?.total,
          cumulativeByProduct: cumulativeForPrint?.byProduct,
          showCumulativeFrequency: printData.shouldShowCumulativeForFarmer,
          clerkName: printData.clerkName,
          productName: printData.productName,
          deliveredBy: printData.deliveredBy,
        }).catch(err => console.warn('Background print failed:', err));
        
        // Save receipt for reprinting WITH the correct cumulative value
        addMilkReceipt(printData.collections, cumulativeForPrint?.total, cumulativeForPrint?.byProduct).catch(() => {});
      })();
    } else {
      // If not in collection view (shouldn't happen), fall back to modal
      setReceiptModalOpen(true);
      setIsSubmitting(false);
    }
  };

  const handlePrintAllCaptures = () => {
    if (capturedCollections.length === 0) {
      toast.error('No collections captured yet');
      return;
    }
    
    // Open modal with all captured collections
    setReceiptModalOpen(true);
  };

  const handleClearCaptures = async () => {
    try {
      // Get count of unsynced receipts
      const unsyncedReceipts = await getUnsyncedReceipts();
      const count = unsyncedReceipts.length;
      
      if (count === 0) {
        toast.error('No pending receipts to delete');
        return;
      }
      
      // Clear all unsynced receipts from IndexedDB
      await clearUnsyncedReceipts();
      toast.success(`Deleted ${count} pending receipt${count !== 1 ? 's' : ''} waiting to sync`);
      
      // Trigger refresh to update UI if needed
      setRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error('Failed to clear pending receipts:', error);
      toast.error('Failed to delete pending receipts');
    }
  };

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      setSidebarOpen(false);
    }
  };

  const handleTestPrint = () => {
    toast.success('Test print initiated');
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Test Print</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                padding: 40px; 
                text-align: center;
              }
              h1 { 
                font-size: 48px; 
                color: #667eea; 
                margin: 0;
              }
            </style>
          </head>
          <body>
            <h1>Testing Print</h1>
            <p style="font-size: 24px; color: #333;">It is working!</p>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
    setSidebarOpen(false);
  };

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  // Authorization check happens in background - don't block the UI
  // Only block if we've confirmed the device is NOT authorized (not during loading)
  if (isDeviceAuthorized === false && !settingsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-card rounded-lg shadow-lg p-8 text-center border border-amber-500/30">
          {isPendingApproval ? (
            // Pending approval state
            <>
              <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">Pending Admin Approval</h2>
              <p className="text-muted-foreground mb-4">
                This device has been registered and is waiting for administrator approval.
                Please share the Device ID below with your administrator.
              </p>
              
              {/* Device Fingerprint Display */}
              {deviceFingerprint && (
                <div className="bg-muted/50 rounded-lg p-4 mb-4">
                  <p className="text-xs text-muted-foreground mb-2">Device ID</p>
                  <code className="text-xs font-mono text-foreground break-all select-all">
                    {deviceFingerprint}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(deviceFingerprint);
                      toast.success('Device ID copied to clipboard');
                    }}
                    className="mt-2 text-xs text-primary hover:underline flex items-center justify-center gap-1 mx-auto"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy to clipboard
                  </button>
                </div>
              )}
              
              <div className="flex gap-2">
                <button
                  onClick={() => refreshSettings()}
                  className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Check Status
                </button>
                <button
                  onClick={() => {
                    logout();
                    window.location.reload();
                  }}
                  className="flex-1 bg-muted text-muted-foreground px-4 py-2 rounded-lg hover:bg-muted/80 transition-colors"
                >
                  Logout
                </button>
              </div>
            </>
          ) : (
            // Not registered state
            <>
              <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">Device Not Authorized</h2>
              <p className="text-muted-foreground mb-4">
                This device could not be registered. Please check your network connection and try again.
              </p>
              
              {/* Device Fingerprint Display */}
              {deviceFingerprint && (
                <div className="bg-muted/50 rounded-lg p-4 mb-4">
                  <p className="text-xs text-muted-foreground mb-2">Device ID</p>
                  <code className="text-xs font-mono text-foreground break-all select-all">
                    {deviceFingerprint}
                  </code>
                </div>
              )}
              
              <div className="flex gap-2">
                <button
                  onClick={() => refreshSettings()}
                  className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Retry
                </button>
                <button
                  onClick={() => {
                    logout();
                    window.location.reload();
                  }}
                  className="flex-1 bg-muted text-muted-foreground px-4 py-2 rounded-lg hover:bg-muted/80 transition-colors"
                >
                  Logout
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Show Dashboard first
  if (!showCollection) {
  const captureMode = getCaptureMode(currentUser?.supervisor);
  
  return (
    <>
      <Dashboard
        userName={currentUser?.username || currentUser?.user_id || 'User'}
        companyName={companyName}
        isOnline={navigator.onLine}
        pendingCount={pendingCount}
        pendingMilkCount={pendingMilkCount}
        pendingSalesCount={pendingSalesCount}
        conflictedReceiptsCount={conflictedReceiptsCount}
        onStartCollection={handleStartCollection}
        onStartSelling={handleStartSelling}
        onLogout={handleLogout}
        onOpenRecentReceipts={() => setReprintModalOpen(true)}
        allowZReport={captureMode.allowZReport}
      />
        
        {/* Reprint Modal - accessible from Dashboard */}
        <ReprintModal
          open={reprintModalOpen}
          onClose={() => setReprintModalOpen(false)}
          receipts={printedReceipts}
          companyName={companyName}
          printCopies={printCopies}
          routeLabel={routeLabel}
          periodLabel={periodLabel}
          locationName={routeName}
          onDeleteReceipts={(indices) => {
            deleteReceipts(indices);
          }}
        />
      </>
    );
  }

  // Collection View - render Buy or Sell screen based on mode
  // Get capture mode from supervisor setting
  const captureMode = getCaptureMode(currentUser?.supervisor);
  
  // For multOpt=0: Allow unlimited weight captures, only disable Submit after first successful submission
  const cleanFarmerIdForCheck = farmerId?.replace(/^#/, '').trim() || '';
  
  const isSelectedFarmerBlacklisted =
    !!selectedFarmer &&
    (selectedFarmer.multOpt ?? 1) === 0 &&
    !!farmerId &&
    (isBlacklisted(farmerId) || sessionSubmittedFarmers.has(cleanFarmerIdForCheck));
  
  // NEVER disable capture - farmers can always capture weight (multiple buckets)
  const captureDisabledForSelectedFarmer = false;
  
  // For multOpt=0: disable Submit only after first successful submission in this session
  // Check both: hook blacklist (persistent) AND local session tracking (edge case coverage)
  // For multOpt=1: never disable Submit (allow unlimited submissions)
  // Also disable Submit if no weight has been captured (weight <= 0)
  // Submit is disabled if farmer is blacklisted OR no collections captured yet
  const submitDisabledForSelectedFarmer = isSelectedFarmerBlacklisted || capturedCollections.length === 0;

  return (
    <>
      {!activeSession ? null : collectionMode === 'buy' ? (
        <BuyProduceScreen
          route={{ tcode: selectedRouteCode, descript: routeName, mprefix: selectedRouteMprefix } as Route}
          session={activeSession}
          userName={currentUser?.username || currentUser?.user_id || 'User'}
          weight={weight}
          capturedCollections={capturedCollections}
          onBack={handleBackToDashboard}
          onCapture={handleCapture}
          onSubmit={handleSubmit}
          onSelectFarmer={handleSelectFarmer}
          onClearFarmer={handleClearFarmer}
          selectedFarmer={farmerId ? { id: farmerId, name: farmerName } : null}
          todayWeight={0}
          onManualWeightChange={(w) => {
            setWeight(w);
            setEntryType('manual');
          }}
          onWeightChange={setWeight}
          onEntryTypeChange={setEntryType}
          blacklistedFarmerIds={blacklistedFarmerIds}
          sessionSubmittedFarmerIds={sessionSubmittedFarmers}
          onFarmersLoaded={handleFarmersLoaded}
          captureDisabled={captureDisabledForSelectedFarmer}
          submitDisabled={submitDisabledForSelectedFarmer}
          allowDigital={captureMode.allowDigital}
          allowManual={captureMode.allowManual}
          // Coffee mode: gross/tare/net weight handling
          grossWeight={grossWeight}
          onGrossWeightChange={setGrossWeight}
          onNetWeightChange={setWeight}
          onTareWeightChange={setTareWeight}
          sackTareWeight={sackTareWeight}
          allowSackEdit={allowSackEdit}
          zeroOptBlocked={requireZeroScale && captureLocked && weight > 0.5}
          deliveredBy={deliveredBy}
          onDeliveredByChange={setDeliveredBy}
          isSubmitting={isSubmitting}
        />
      ) : (
        <SellProduceScreen
          route={{ tcode: selectedRouteCode, descript: routeName, mprefix: selectedRouteMprefix } as Route}
          session={activeSession}
          userName={currentUser?.username || currentUser?.user_id || 'User'}
          weight={weight}
          capturedCollections={capturedCollections}
          onBack={handleBackToDashboard}
          onCapture={handleCapture}
          onSubmit={handleSubmit}
          onSelectFarmer={handleSelectFarmer}
          onClearFarmer={handleClearFarmer}
          selectedFarmer={farmerId ? { id: farmerId, name: farmerName } : null}
          todayWeight={0}
          onManualWeightChange={(w) => {
            setWeight(w);
            setEntryType('manual');
          }}
          onWeightChange={setWeight}
          onEntryTypeChange={setEntryType}
          blacklistedFarmerIds={blacklistedFarmerIds}
          sessionSubmittedFarmerIds={sessionSubmittedFarmers}
          captureDisabled={captureDisabledForSelectedFarmer}
          submitDisabled={submitDisabledForSelectedFarmer}
          allowDigital={captureMode.allowDigital}
          allowManual={captureMode.allowManual}
          // Coffee mode: gross/tare/net weight handling
          grossWeight={grossWeight}
          onGrossWeightChange={setGrossWeight}
          onNetWeightChange={setWeight}
          onTareWeightChange={setTareWeight}
          sackTareWeight={sackTareWeight}
          allowSackEdit={allowSackEdit}
          zeroOptBlocked={requireZeroScale && captureLocked && weight > 0.5}
          deliveredBy={deliveredBy}
          onDeliveredByChange={setDeliveredBy}
          isSubmitting={isSubmitting}
        />
      )}

      {/* Receipt Modal */}
      <ReceiptModal
        receipts={capturedCollections}
        companyName={companyName}
        open={receiptModalOpen}
        onClose={() => {
          setReceiptModalOpen(false);
          setCapturedCollections([]);
          setCumulativeFrequency(undefined);
          // Clear farmer selection after submit to prepare for next farmer (silently)
          setFarmerId('');
          setFarmerName('');
          setSelectedFarmer(null);
          setSearchValue('');
          setWeight(0);
          setGrossWeight(0); // Reset coffee gross weight
          setLastSavedWeight(0);
          setDeliveredBy('owner'); // Reset for next farmer
          // Dispatch event to notify child components to focus input
          window.dispatchEvent(new CustomEvent('receiptModalClosed'));
        }}
        cumulativeFrequency={cumulativeFrequency?.total}
        cumulativeByProduct={cumulativeFrequency?.byProduct}
        showCumulativeFrequency={showCumulative}
        printCopies={printCopies}
        routeLabel={routeLabel}
        periodLabel={periodLabel}
        locationCode={selectedRouteCode}
        locationName={routeName}
      />

      {/* Reprint Modal */}
      <ReprintModal
        open={reprintModalOpen}
        onClose={() => setReprintModalOpen(false)}
        receipts={printedReceipts}
        companyName={companyName}
        printCopies={printCopies}
        routeLabel={routeLabel}
        periodLabel={periodLabel}
        locationName={routeName}
        onDeleteReceipts={(indices) => {
          deleteReceipts(indices);
        }}
      />
    </>
  );
};

export default Index;
