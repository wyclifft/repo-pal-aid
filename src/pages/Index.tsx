import { useState, useEffect, useCallback, useRef } from 'react';
import { formatWeight, roundWeight } from '@/utils/weightUtils';
import { useNavigate } from 'react-router-dom';
import { MoreVertical, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Login } from '@/components/Login';
import { Dashboard } from '@/components/Dashboard';
import { BuyProduceScreen } from '@/components/BuyProduceScreen';
import { SellProduceScreen } from '@/components/SellProduceScreen';
import { SupervisorTransactions } from '@/components/SupervisorTransactions';
import { ReceiptModal } from '@/components/ReceiptModal';
import { ReprintModal } from '@/components/ReprintModal';
import { FarmerDashboard } from '@/components/farmer/FarmerDashboard';

import { useAuth } from '@/contexts/AuthContext';
import { useReprint } from '@/contexts/ReprintContext';
import { useSync } from '@/contexts/SyncContext';
import { type AppUser, type Farmer, type MilkCollection, getCaptureMode } from '@/lib/supabase';
import { type Route, type Session, type Item } from '@/services/mysqlApi';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useSessionBlacklist } from '@/hooks/useSessionBlacklist';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useSessionExpiration } from '@/hooks/useSessionExpiration';
import { SessionExpiredDialog } from '@/components/SessionExpiredDialog';
import { isFarmerInactive } from '@/hooks/useFarmerResolution';
import { InactiveMemberDialog } from '@/components/InactiveMemberDialog';
import { DuplicateDeliveryDialog } from '@/components/DuplicateDeliveryDialog';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { resolveDashboardMilkSessionId } from '@/utils/sessionMetadata';
import { cumulativeMonitor, logPrintFinal } from '@/utils/cumulativeMonitor';
import { generateReferenceWithUploadRef, generateTransRefOnly } from '@/utils/referenceGenerator';
import { printMilkReceiptDirect } from '@/hooks/useDirectPrint';
import { saveToLocalDB, markNativeRecordSynced } from '@/services/offlineStorage';
import { plog } from '@/utils/persistentLogger';
import { addRegressionPin, clearRegressionPin, takeRegressionPinsForReplay } from '@/utils/cumulativeRegressionPins';
import { toast } from 'sonner';

// Helper: filter cumulative data to only the selected produce type
const filterCumulativeByProduct = (
  cumData: { total: number; byProduct: Array<{ icode: string; product_name: string; weight: number }> } | undefined,
  productIcode?: string
): { total: number; byProduct: Array<{ icode: string; product_name: string; weight: number }> } | undefined => {
  if (!cumData || !productIcode) return cumData;
  // v2.12.16: If a product is specified, we MUST only return weight for that
  // product. If the breakdown is missing, we return 0 instead of falling back
  // to the global total, preventing over-reporting of cumulative weight.
  const cleanIcode = productIcode.trim().toUpperCase();
  const match = cumData.byProduct.find(p => String(p.icode || '').trim().toUpperCase() === cleanIcode);
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
  const [showSupervisor, setShowSupervisor] = useState(false); // v2.12.17: Supervisor portal
  const [showUnsavedCapturesDialog, setShowUnsavedCapturesDialog] = useState(false);

  // v2.12.19: Handle hardware back button to navigate to Dashboard
  useEffect(() => {
    const handleBackButton = (e: any) => {
      // If supervisor portal is open, back button returns to dashboard
      if (showSupervisor) {
        e.preventDefault();
        setShowSupervisor(false);
        return;
      }
      // If collection portal (Buy/Sell) is open, back button returns to dashboard
      if (showCollection) {
        e.preventDefault();
        setShowCollection(false);
        return;
      }
    };

    window.addEventListener('ionBackButton', handleBackButton);
    return () => window.removeEventListener('ionBackButton', handleBackButton);
  }, [showSupervisor, showCollection]);

  // Reprint receipts state - now from shared context
  const [reprintModalOpen, setReprintModalOpen] = useState(false);
  const { printedReceipts, addMilkReceipt, deleteReceipts } = useReprint();
  const [farmerId, setFarmerId] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [selectedFarmer, setSelectedFarmer] = useState<Farmer | null>(null); // Full farmer object with multOpt
  const [inactiveFarmerDialog, setInactiveFarmerDialog] = useState<Farmer | null>(null);
  const [route, setRoute] = useState('');
  const [routeName, setRouteName] = useState('');
  const [selectedRouteCode, setSelectedRouteCode] = useState(''); // tcode from fm_tanks
  const [selectedRouteMprefix, setSelectedRouteMprefix] = useState(''); // mprefix from fm_tanks for chkroute=0
  const [selectedRouteClientFetch, setSelectedRouteClientFetch] = useState<number | undefined>(undefined);
  const [session, setSession] = useState(''); // Session description from sessions table
  const [activeSession, setActiveSession] = useState<Session | null>(null); // Currently active session object
  const [selectedProduct, setSelectedProduct] = useState<Item | null>(null); // Selected produce item (invtype=01)
  const [searchValue, setSearchValue] = useState('');

  // Weight - for dairy: weight is total weight; for coffee: weight is net (after tare deduction)
  const [weight, setWeight] = useState(0);
  const [entryType, setEntryType] = useState<'scale' | 'manual'>('manual');
  const [lastSavedWeight, setLastSavedWeight] = useState(0);
  
  // ========== zeroOpt CAPTURE LOCK (psettings.zeroopt) ==========
  // If zeroopt=1: After a capture, captureLocked=true blocks next capture until weight ≤0.2 kg
  // Lock applies to BOTH scale and manual entry
  // Lock resets ONLY when: (1) weight drops to ≤0.2 kg
  // NOTE: Lock strictly persists across member changes to prevent bypass
  // If zeroopt=0: Captures allowed normally without zero check
  const [captureLocked, setCaptureLocked] = useState(false);
  const [lastCapturedFarmerId, setLastCapturedFarmerId] = useState<string | null>(null);

  // ========== stableOpt CAPTURE PROTECTION (psettings.stableOpt) ==========
  // If stableopt=1: Capture button disabled until scale reports stable reading
  // If stableopt=0: Normal capture behavior
  const [isScaleStable, setIsScaleStable] = useState(true);

  // Listen for scale stability changes
  useEffect(() => {
    const handleStabilityChange = (e: any) => {
      const { isStable } = e.detail;
      console.log(`⚖️ Index: Scale stability changed: ${isStable}`);
      setIsScaleStable(isStable);
    };

    window.addEventListener('scaleStabilityChange', handleStabilityChange as EventListener);

    // Reset stability when scale disconnects
    const handleConnectionChange = (e: any) => {
      if (!e.detail.connected) {
        setIsScaleStable(true);
      }
    };
    window.addEventListener('scaleConnectionChange', handleConnectionChange as EventListener);

    return () => {
      window.removeEventListener('scaleStabilityChange', handleStabilityChange as EventListener);
      window.removeEventListener('scaleConnectionChange', handleConnectionChange as EventListener);
    };
  }, []);

  // Reset stability when changing farmer or clearing
  useEffect(() => {
    if (!selectedFarmer) {
      setIsScaleStable(true);
    }
  }, [selectedFarmer]);
  // ========== END stableOpt CAPTURE PROTECTION ==========
  
  // Coffee sack weighing - gross/tare/net (orgtype C only)
  // Tare weight comes from psettings.sackTare (default 1 kg)
  const [grossWeight, setGrossWeight] = useState(0);
  const [tareWeight, setTareWeight] = useState(1); // Will be set from psettings
  // Net weight is calculated: gross - tare (minimum 0)

  // Receipt modal
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  // v2.12.33: Receipt modal state ref for use in background refresh closures.
  // Prevents cumulative values jumping on screen while the modal is open.
  const receiptModalOpenRef = useRef(receiptModalOpen);
  useEffect(() => { receiptModalOpenRef.current = receiptModalOpen; }, [receiptModalOpen]);

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Cumulative frequency for current farmer (monthly collection count)
  const [cumulativeFrequency, setCumulativeFrequency] = useState<{ total: number; byProduct: Array<{ icode: string; product_name: string; weight: number }> } | undefined>(undefined);
  
  // Captured collections for batch printing
  const [capturedCollections, setCapturedCollections] = useState<MilkCollection[]>([]);
  
  // All farmers for the company (for Delivered By search)
  const [allCompanyFarmers, setAllCompanyFarmers] = useState<Farmer[]>([]);

  // Delivered by state for Buy/Sell portals
  const [deliveredBy, setDeliveredBy] = useState('owner');
  const [selectedDeliverer, setSelectedDeliverer] = useState<Farmer | null>(null);

  // Handle manual edits to Delivered By field
  const handleDeliveredByChange = (newValue: string) => {
    setDeliveredBy(newValue);

    // If we had a selected member, check if the new text still matches their display string.
    // If the user typed anything different, clear the selected member so the manual text is used.
    if (selectedDeliverer) {
      const displayString = `${selectedDeliverer.farmer_id} - ${selectedDeliverer.name}`;
      if (newValue !== displayString) {
        setSelectedDeliverer(null);
      }
    }
  };

  // Sync deliveredBy changes to all captured collections BEFORE submission
  // This ensures if a user edits 'Delivered By' after capturing multiple items, all get updated.
  useEffect(() => {
    if (capturedCollections.length > 0) {
      const currentDelivererValue = selectedDeliverer
        ? `${selectedDeliverer.farmer_id} - ${selectedDeliverer.name}`
        : (deliveredBy || 'owner');

      setCapturedCollections(prev => {
        // Only update if there's actually a change to avoid infinite loops
        const needsUpdate = prev.some(c => c.delivered_by !== currentDelivererValue);
        if (!needsUpdate) return prev;

        return prev.map(c => ({
          ...c,
          delivered_by: currentDelivererValue
        }));
      });
    }
  }, [deliveredBy, selectedDeliverer]);

  const { 
    saveReceipt, 
    savePrintedReceipts, 
    getPrintedReceipts, 
    getUnsyncedReceipts, 
    clearUnsyncedReceipts, 
    markReceiptSynced,
    isReady,
    getFarmers,
    saveFarmers,
    updateFarmerCumulative,
    getFarmerCumulative,
    getFarmerTotalCumulative,
    getUnsyncedWeightForFarmer,
    bumpFarmerCumulativeBase
  } = useIndexedDB();

  // Duplicate delivery prompt state for sync conflicts
  const [syncConflict, setSyncConflict] = useState<{
    farmerId: string;
    farmerName?: string;
    session: string;
    date: string;
    route?: string;
    device?: string;
    localRef?: string;
    orderId?: number;
  } | null>(null);

  // Data sync hook for background syncing
  const { isSyncing, pendingCount, pendingMilkCount, pendingMilkKgs, pendingMilkAmKgs, pendingMilkPmKgs, unsyncedMilkReceipts, pendingSalesCount, conflictedReceiptsCount, syncAllData } = useSync();
  
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
    settings,
    showProductName,
    companyName, // Use the reactive companyName from useAppSettings
    useCumulativeRouteFilter
  } = useAppSettings();

  // v2.12.36: Effective route code for cumulative calculations based on settings.
  // If useCumulativeRouteFilter is false (all routes), we pass undefined to allow
  // the backend/IndexedDB to calculate across all routes.
  const cumulativeRouteCode = useCumulativeRouteFilter ? (selectedRouteCode || undefined) : undefined;

  // Top-level Session Expiration Monitoring (protects BuyProduceScreen, SellProduceScreen, and App Resume)
  const {
    isExpired: isSessionExpired,
    acknowledgeExpiration: acknowledgeTopLevelExpiration,
  } = useSessionExpiration({
    session: activeSession,
    enabled: !!activeSession,
    checkIntervalMs: 15000,
  });

  // When session expires top-level
  useEffect(() => {
    if (isSessionExpired && activeSession) {
      if (capturedCollections.length > 0) {
        // Unsubmitted captures exist! Keep collection view open, disable NEW captures, prompt submit.
        toast.warning(
          `Session expired! Please submit your ${capturedCollections.length} captured item(s) to finish.`,
          { duration: 8000 }
        );
      } else {
        // No captures: auto-exit collection mode to Dashboard
        if (showCollection) {
          setShowCollection(false);
          setCollectionMode(null);
          setActiveSession(null);
        }
      }
    }
  }, [isSessionExpired, activeSession, capturedCollections.length, showCollection]);

  const handleTopLevelSessionExpiredSelect = useCallback(() => {
    acknowledgeTopLevelExpiration();
    setShowCollection(false);
    setCollectionMode(null);
    setActiveSession(null);
    toast.info(`Please select an active ${periodLabel.toLowerCase()}`);
  }, [acknowledgeTopLevelExpiration, periodLabel]);

  // Load all company farmers for Delivered By search
  useEffect(() => {
    if (!isReady) return;
    (async () => {
      try {
        const farmers = await getFarmers();
        setAllCompanyFarmers(farmers);
      } catch (e) {
        console.warn('Failed to load all company farmers:', e);
      }
    })();
  }, [isReady, getFarmers]);

  // Sync tare weight from psettings when loaded
  // For coffee (orgtype='C'), use psettings value (allows 0 kg)
  useEffect(() => {
    if (isCoffee) {
      const tareValue = typeof sackTareWeight === 'number' && !isNaN(sackTareWeight) && sackTareWeight >= 0 ? sackTareWeight : 1;
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
  const { blacklistedFarmerIds, getBlacklistDetail, isBlacklisted, addToBlacklist, refreshBlacklist, clearBlacklist, getSessionType } = useSessionBlacklist(activeSessionTimeFrom, activeSeasonCode);
  
  // Local session-scoped set to track submitted farmers (extra safeguard for edge cases)
  // This covers scenarios where IndexedDB might not have the record yet
  const [sessionSubmittedFarmers, setSessionSubmittedFarmers] = useState<Set<string>>(new Set());
  
  // v2.12.41: Listen for duplicate detection events from sync engine
  useEffect(() => {
    const handleDuplicate = (e: any) => {
      const { farmerId: fId, session: sVal, date: dVal, device: dev, route: rt, localRef, orderId } = e.detail || {};
      const currentSessionType = getSessionType();

      // Only blacklist if it matches current session
      if (sVal === currentSessionType) {
        const cleanId = String(fId || '').replace(/^#/, '').trim();
        addToBlacklist(cleanId);
        setSessionSubmittedFarmers(prev => new Set([...prev, cleanId]));
        console.log(`🚫 Blacklisted ${cleanId} due to sync conflict event`);
      }

      const cleanFId = String(fId || '').replace(/^#/, '').trim();
      const matchedFarmer = loadedFarmers.find(
        f => f.farmer_id.replace(/^#/, '').trim() === cleanFId
      );

      setSyncConflict({
        farmerId: cleanFId,
        farmerName: matchedFarmer?.name || '',
        session: sVal || '',
        date: dVal || new Date().toISOString().split('T')[0],
        route: rt || matchedFarmer?.route || '',
        device: dev || 'Other Device',
        localRef: localRef || '',
        orderId: orderId
      });
    };

    window.addEventListener('duplicateDetected', handleDuplicate);
    return () => window.removeEventListener('duplicateDetected', handleDuplicate);
  }, [addToBlacklist, getSessionType, loadedFarmers]);

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

  const handleRefreshBlacklist = useCallback(() => {
    if (activeSession) {
      refreshBlacklist([], farmersWithMultOptZero());
    }
  }, [activeSession, refreshBlacklist, farmersWithMultOptZero]);

  // Refresh blacklist when session changes or farmers load
  // NOTE: We don't include capturedCollections because blacklisting happens AFTER submission, not capture
  useEffect(() => {
    handleRefreshBlacklist();
  }, [handleRefreshBlacklist]);

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
        const batchResult = await mysqlApi.farmerFrequency.getMonthlyFrequencyBatch(deviceFingerprint, cumulativeRouteCode, activeSeasonCode);
        // v2.12.6: the backend answers `pending: true` while the background
        // warmer recomputes the season snapshot. It carries an EMPTY farmer
        // list — writing it would zero every cached cumulative. Skip entirely.
        if ((batchResult as any)?.data?.pending || (batchResult as any)?.pending) {
          console.log(`⏳ Cumulative refresh (${reason}): backend snapshot warming — keeping cached values`);
          return;
        }
        if (batchResult.success && batchResult.data && batchResult.data.farmers) {
          const batchMap = new Map<string, number>();
          for (const f of batchResult.data.farmers) {
            batchMap.set(f.farmer_id.trim(), f.cumulative_weight);
          }

          const response = await mysqlApi.farmers.getByDevice(deviceFingerprint);
          if (response.success && response.data) {
            saveFarmers(response.data);
            const cumulativeEnabled = (settings.cumulative_frequency_status === 1) || (settings.printcumm === 1);
            const qualifying = cumulativeEnabled ? response.data : [];

            const WRITE_BATCH = 50;
            let written = 0;
            let failedCount = 0;
            for (let i = 0; i < qualifying.length; i += WRITE_BATCH) {
              const batch = qualifying.slice(i, i + WRITE_BATCH);
              await Promise.all(batch.map(async (farmer) => {
                const fId = farmer.farmer_id.replace(/^#/, '').trim();
                const weight = batchMap.get(fId) ?? 0;
                const byProd = batchResult.data.farmers.find(f => f.farmer_id.trim() === fId)?.by_product || [];
                const vs = reason === 'post-sync' ? 'W5:postcapture-refresh' : `W3:prewarm-batch(${reason})`;
                try {
                  await updateFarmerCumulative(fId, weight, true, byProd, cumulativeRouteCode, activeSeasonCode, { verifySource: vs, caller: `Index/refreshCumulativesBatch(${reason})` });
                  written++;
                } catch (e) {
                  failedCount++;
                }
              }));
              if (i + WRITE_BATCH < qualifying.length) {
                await new Promise(r => setTimeout(r, 0));
              }
            }
            console.log(`✅ Cumulative refresh (${reason}): ${written}/${qualifying.length} farmers updated successfully (${failedCount} failed)`);
          }
        }

        // Update currently selected farmer's display immediately with FLOOR GUARD (read from refs)
        const currentFarmer = selectedFarmerRef.current;
        const currentProduct = selectedProductRef.current;
        if (currentFarmer) {
          const cleanId = currentFarmer.farmer_id.replace(/^#/, '').trim();
          const cached = await getFarmerCumulativeRef.current(cleanId, cumulativeRouteCode);
          const baseCount = cached?.baseCount || 0;
          const baseProd = cached?.byProduct || [];
          const unsynced = await getUnsyncedWeightForFarmerRef.current(cleanId, cumulativeRouteCode);
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
            // v2.12.33: If the receipt modal is open, we "lock" the cumulative
            // value to prevent jumps on screen (e.g. from Route total to Global total).
            // The background refresh is still useful for the next capture, but
            // shouldn't change the current receipt.
            if (receiptModalOpenRef.current) return prev;

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
  }, [selectedRouteCode, activeSeasonCode, deviceFingerprint, showCumulative, updateFarmerCumulative, saveFarmers, settings.cumulative_frequency_status, settings.printcumm]);

  // ========== FAST CUMULATIVE PRE-FETCH (BATCH API) ==========
  // Uses single batch endpoint instead of 3558 individual API calls
  // Falls back to individual calls only if batch endpoint is unavailable
  useEffect(() => {
    if (!showCumulative || !deviceFingerprint || !navigator.onLine || !isReady) return;

    // v2.12.18: Skip internal pre-fetch if a global blocking sync was recently completed
    // or is currently running. This avoids redundant heavy API calls.
    const lastSync = localStorage.getItem('lastSyncTime');
    if (lastSync && Date.now() - parseInt(lastSync, 10) < 5 * 60 * 1000) {
      console.log('📦 Pre-fetch: skipped (global sync completed < 5 mins ago)');
      return;
    }

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
        const cumulativeEnabled = (settings.cumulative_frequency_status === 1) || (settings.printcumm === 1);
        const qualifying = cumulativeEnabled ? allFarmers : [];
        const farmersToCache = qualifying;

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
        // v2.12.5: when the batch fails because the SERVER is busy (503 / timeout /
        // pool pressure), the per-farmer fallback would fire hundreds of requests and
        // make the pool exhaustion worse. Retry the batch with backoff instead, and
        // suppress the fallback entirely for server-busy failures.
        let batchServerBusy = false;
        const batchLabel = `cumulative-prefetch route=${cumulativeRouteCode || 'ALL'}`;
        cumulativeMonitor.startBatch(batchLabel, farmersToCache.length, { source: 'prefetch' });
        try {
          const isServerBusy = (r: any) =>
            !!r?.offline || /503|timed out|timeout|Server unavailable|too many|busy|ECONNRESET/i.test(String(r?.error || ''));
          // v2.12.6: `pending` means the backend is warming the season snapshot
          // in the background and returned an EMPTY farmer list. Treat it like
          // "server busy": retry with backoff, never write, never fall back to
          // per-farmer calls (that is what saturated the pool).
          const isPending = (r: any) => !!(r?.pending || r?.data?.pending);

          let batchResult: any = null;
          let batchPending = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            batchResult = await mysqlApi.farmerFrequency.getMonthlyFrequencyBatch(deviceFingerprint, cumulativeRouteCode, activeSeasonCode);
            batchPending = isPending(batchResult);
            if (!batchPending && batchResult?.success && batchResult.data?.farmers?.length) { batchServerBusy = false; break; }
            batchServerBusy = batchPending || isServerBusy(batchResult);
            if (!batchServerBusy || attempt === 3 || !navigator.onLine) break;
            const waitMs = batchPending ? attempt * 3000 : attempt * 4000;
            console.warn(`📦 Batch cumulative attempt ${attempt} ${batchPending ? 'pending (backend warming)' : `failed (${batchResult?.error})`} — retrying in ${waitMs / 1000}s`);
            await new Promise(r => setTimeout(r, waitMs));
          }

          if (batchPending) {
            console.log('⏳ Pre-fetch: backend cumulative snapshot still warming — cached values kept untouched');
          }

          if (!batchPending && batchResult && batchResult.success && batchResult.data && batchResult.data.farmers) {
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
            // v2.10.120: track which farmers got a fresh batch read this cycle —
            // the sticky-regression replay queue excludes these so we don't
            // double-fetch them.
            const coveredFarmerIds = new Set<string>();
            for (let i = 0; i < farmersToCache.length; i += WRITE_BATCH) {
              const batch = farmersToCache.slice(i, i + WRITE_BATCH);
              await Promise.all(batch.map(async (farmer) => {
                const fId = farmer.farmer_id.replace(/^#/, '').trim();
                coveredFarmerIds.add(fId);
                const weight = batchMap.get(fId) ?? 0;
                try {
                  const persistedAfter = await updateFarmerCumulative(fId, weight, true, batchByProductMap.get(fId) || [], cumulativeRouteCode, activeSeasonCode, { verifySource: 'W3:prewarm-batch', caller: 'Index/loadCumulativeBatch' });
                  cumulativeMonitor.batchOk(batchLabel);
                  // Stale-reject signature: returned baseCount strictly greater
                  // than the value we tried to write. Schedule reconfirm AND
                  // pin for cross-session replay (v2.10.120).
                  if (typeof persistedAfter === 'number' && persistedAfter > weight + 0.0001) {
                    reconfirmCandidates.push({ fId, batchIncoming: weight, persisted: persistedAfter });
                    addRegressionPin(fId, cumulativeRouteCode || 'ALL', persistedAfter, weight);
                  } else if (typeof persistedAfter === 'number' && Math.abs(persistedAfter - weight) < 0.0001) {
                    // Cache and backend agree — any prior pin is resolved.
                    clearRegressionPin(fId, cumulativeRouteCode || 'ALL');
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

            // v2.10.120: W3-RECONFIRM pass — capped, fire-and-forget, never
            // blocks the prewarm. Two-stage:
            //   STAGE A — today's stale-reject candidates from the just-finished
            //   batch (in-session over-counts).
            //   STAGE B — sticky pins from previous sessions/days that weren't
            //   re-evaluated by today's batch (e.g. M01859, M03544 that were
            //   never re-touched after their v2.10.118 rejection).
            // Heal-down rules — ALL must be true to lower the cache:
            //   1. Two independent backend reads agree (batch == individual,
            //      or for stage B: two consecutive individual reads agree).
            //   2. Both reads are strictly less than the persisted cache.
            //   3. snapshot_max_id present from at least one read.
            //   4. The farmer has ZERO unsynced local receipts on this route
            //      (otherwise persisted legitimately > backend).
            // If any gate fails → log PERSISTENT-GAP and keep persisted
            // (today's behaviour). On heal-down: updateFarmerCumulative is
            // called with allowDecrease=true (existing supported flag), and
            // the pin is cleared.
            if (navigator.onLine) {
              const MAX_RECONFIRM = 25;
              const MAX_PIN_REPLAY = 25;
              const stageA = reconfirmCandidates.slice(0, MAX_RECONFIRM);
              const stageBPins = takeRegressionPinsForReplay(cumulativeRouteCode || 'ALL', coveredFarmerIds, MAX_PIN_REPLAY);
              if (stageA.length === 0 && stageBPins.length === 0) {
                // nothing to do
              } else {
                setTimeout(() => {
                  (async () => {
                    // ---- STAGE A: in-session candidates ----
                    for (const t of stageA) {
                      try {
                        const indPromise = mysqlApi.farmerFrequency.getMonthlyFrequency(t.fId, deviceFingerprint, cumulativeRouteCode);
                        const indRes: any = await Promise.race([
                          indPromise,
                          new Promise((resolve) => setTimeout(() => resolve({ success: false, _timeout: true }), 6000))
                        ]);
                        if (!indRes || !indRes.success || !indRes.data) {
                          plog.info('CUM:W3-RECONFIRM-TIMEOUT',
                            `${t.fId} route=${cumulativeRouteCode || 'ALL'} individual fetch failed/timeout; keeping persisted=${t.persisted}`,
                            { farmerId: t.fId, route: cumulativeRouteCode || 'ALL', persisted: t.persisted, batchIncoming: t.batchIncoming, snapshot_max_id_batch: batchSnapshotId });
                          continue;
                        }
                        const individual = Number(indRes.data.cumulative_weight) || 0;
                        if (individual > t.persisted + 0.0001) {
                          await updateFarmerCumulative(t.fId, individual, true, indRes.data.by_product || [], cumulativeRouteCode, activeSeasonCode, { verifySource: 'W3:reconfirm-heal', caller: 'Index/w3Reconfirm' });
                          clearRegressionPin(t.fId, cumulativeRouteCode || 'ALL');
                          plog.pinned('info', 'CUM:W3-RECONFIRM-HEAL-UP',
                            `${t.fId} route=${cumulativeRouteCode || 'ALL'} individual=${individual} > persisted=${t.persisted} (batch=${t.batchIncoming})`,
                            { farmerId: t.fId, route: cumulativeRouteCode || 'ALL', persisted: t.persisted, batchIncoming: t.batchIncoming, individual, snapshot_max_id_batch: batchSnapshotId });
                        } else if (Math.abs(individual - t.batchIncoming) < 0.0001 && individual < t.persisted) {
                          // v2.10.120: two reads agree AND both < persisted → confirmed over-count.
                          // Apply heal-down only when farmer has no unsynced local rows.
                          let unsyncedTotal = 0;
                          try {
                            const u = await getUnsyncedWeightForFarmerRef.current(t.fId, cumulativeRouteCode);
                            unsyncedTotal = u?.total || 0;
                          } catch { /* treat as unknown — block heal-down */ unsyncedTotal = -1; }
                          if (unsyncedTotal === 0) {
                            await updateFarmerCumulative(t.fId, individual, true, indRes.data.by_product || [], cumulativeRouteCode, activeSeasonCode, { verifySource: 'W3:reconfirm-heal-down', caller: 'Index/w3Reconfirm', allowDecrease: true });
                            clearRegressionPin(t.fId, cumulativeRouteCode || 'ALL');
                            plog.pinned('warn', 'CUM:W3-RECONFIRM-HEAL-DOWN',
                              `${t.fId} route=${cumulativeRouteCode || 'ALL'} HEAL-DOWN persisted=${t.persisted} → ${individual} (batch=${t.batchIncoming} == individual=${individual})`,
                              { farmerId: t.fId, route: cumulativeRouteCode || 'ALL', persisted: t.persisted, batchIncoming: t.batchIncoming, individual, unsyncedTotal, snapshot_max_id_batch: batchSnapshotId, stage: 'A' });
                          } else {
                            plog.pinned('info', 'CUM:W3-RECONFIRM-PERSISTENT-GAP',
                              `${t.fId} route=${cumulativeRouteCode || 'ALL'} batch=${t.batchIncoming} individual=${individual} both < persisted=${t.persisted} — held (unsyncedTotal=${unsyncedTotal})`,
                              { farmerId: t.fId, route: cumulativeRouteCode || 'ALL', persisted: t.persisted, batchIncoming: t.batchIncoming, individual, unsyncedTotal, snapshot_max_id_batch: batchSnapshotId, reason: unsyncedTotal > 0 ? 'unsynced-rows-present' : 'unsynced-fetch-error', stage: 'A' });
                          }
                        } else {
                          plog.info('CUM:W3-RECONFIRM-OK',
                            `${t.fId} route=${cumulativeRouteCode || 'ALL'} individual=${individual} ≥ persisted=${t.persisted} (batch=${t.batchIncoming}) — keeping persisted`,
                            { farmerId: t.fId, route: cumulativeRouteCode || 'ALL', persisted: t.persisted, batchIncoming: t.batchIncoming, individual, snapshot_max_id_batch: batchSnapshotId });
                        }
                      } catch (e) {
                        // Never throw from reconfirm
                      }
                      await new Promise(r => setTimeout(r, 50));
                    }
                    // ---- STAGE B: sticky pins not in today's batch ----
                    for (const pin of stageBPins) {
                      try {
                        // Read CURRENT persisted from cache (may differ from pin.lastPersisted
                        // if a write landed since the pin was created).
                        const cached = await getFarmerCumulativeRef.current(pin.farmerId, pin.route === 'ALL' ? undefined : pin.route);
                        const currentPersisted = (cached?.baseCount || 0);
                        if (currentPersisted <= 0) {
                          clearRegressionPin(pin.farmerId, pin.route);
                          continue;
                        }
                        // First independent read
                        const r1Promise = mysqlApi.farmerFrequency.getMonthlyFrequency(pin.farmerId, deviceFingerprint, pin.route === 'ALL' ? undefined : pin.route);
                        const r1: any = await Promise.race([
                          r1Promise,
                          new Promise((resolve) => setTimeout(() => resolve({ success: false, _timeout: true }), 6000))
                        ]);
                        if (!r1 || !r1.success || !r1.data) {
                          plog.info('CUM:W3-PIN-TIMEOUT',
                            `${pin.farmerId} route=${pin.route} stage-B read#1 failed/timeout; pin kept`,
                            { farmerId: pin.farmerId, route: pin.route, currentPersisted, stage: 'B' });
                          continue;
                        }
                        const v1 = Number(r1.data.cumulative_weight) || 0;
                        if (v1 >= currentPersisted - 0.0001) {
                          // Backend caught up or exceeded cache → pin resolved naturally.
                          if (v1 > currentPersisted + 0.0001) {
                            await updateFarmerCumulative(pin.farmerId, v1, true, r1.data.by_product || [], pin.route === 'ALL' ? undefined : pin.route, activeSeasonCode, { verifySource: 'W3:reconfirm-heal', caller: 'Index/w3PinReplay' });
                          }
                          clearRegressionPin(pin.farmerId, pin.route);
                          plog.info('CUM:W3-PIN-RESOLVED',
                            `${pin.farmerId} route=${pin.route} stage-B individual=${v1} ≥ persisted=${currentPersisted} — pin cleared`,
                            { farmerId: pin.farmerId, route: pin.route, currentPersisted, individual: v1, stage: 'B' });
                          await new Promise(r => setTimeout(r, 50));
                          continue;
                        }
                        // v1 < currentPersisted — do a second confirming read.
                        await new Promise(r => setTimeout(r, 150));
                        const r2Promise = mysqlApi.farmerFrequency.getMonthlyFrequency(pin.farmerId, deviceFingerprint, pin.route === 'ALL' ? undefined : pin.route);
                        const r2: any = await Promise.race([
                          r2Promise,
                          new Promise((resolve) => setTimeout(() => resolve({ success: false, _timeout: true }), 6000))
                        ]);
                        if (!r2 || !r2.success || !r2.data) {
                          plog.info('CUM:W3-PIN-TIMEOUT',
                            `${pin.farmerId} route=${pin.route} stage-B read#2 failed/timeout; pin kept`,
                            { farmerId: pin.farmerId, route: pin.route, currentPersisted, v1, stage: 'B' });
                          continue;
                        }
                        const v2 = Number(r2.data.cumulative_weight) || 0;
                        const snapshot2 = (r2.data as any)?.snapshot_max_id;
                        if (Math.abs(v1 - v2) > 0.0001) {
                          plog.info('CUM:W3-PIN-DRIFT',
                            `${pin.farmerId} route=${pin.route} stage-B reads disagree (v1=${v1} v2=${v2}) — pin kept`,
                            { farmerId: pin.farmerId, route: pin.route, currentPersisted, v1, v2, snapshot2, stage: 'B' });
                          continue;
                        }
                        // Two reads agree AND both < currentPersisted.
                        let unsyncedTotal = 0;
                        try {
                          const u = await getUnsyncedWeightForFarmerRef.current(pin.farmerId, pin.route === 'ALL' ? undefined : pin.route);
                          unsyncedTotal = u?.total || 0;
                        } catch { unsyncedTotal = -1; }
                        if (unsyncedTotal === 0) {
                          await updateFarmerCumulative(pin.farmerId, v2, true, r2.data.by_product || [], pin.route === 'ALL' ? undefined : pin.route, activeSeasonCode, { verifySource: 'W3:reconfirm-heal-down', caller: 'Index/w3PinReplay', allowDecrease: true });
                          clearRegressionPin(pin.farmerId, pin.route);
                          plog.pinned('warn', 'CUM:W3-RECONFIRM-HEAL-DOWN',
                            `${pin.farmerId} route=${pin.route} STAGE-B HEAL-DOWN persisted=${currentPersisted} → ${v2} (two-read confirm v1=${v1}==v2=${v2})`,
                            { farmerId: pin.farmerId, route: pin.route, persisted: currentPersisted, v1, v2, unsyncedTotal, snapshot_max_id: snapshot2, stage: 'B', pinFirstSeenAt: pin.firstSeenAt, pinSessions: pin.sessions });
                        } else {
                          plog.pinned('info', 'CUM:W3-RECONFIRM-PERSISTENT-GAP',
                            `${pin.farmerId} route=${pin.route} STAGE-B v1=${v1}==v2=${v2} < persisted=${currentPersisted} — held (unsyncedTotal=${unsyncedTotal})`,
                            { farmerId: pin.farmerId, route: pin.route, persisted: currentPersisted, v1, v2, unsyncedTotal, snapshot_max_id: snapshot2, stage: 'B', reason: unsyncedTotal > 0 ? 'unsynced-rows-present' : 'unsynced-fetch-error' });
                        }
                      } catch (e) {
                        // Never throw from pin replay
                      }
                      await new Promise(r => setTimeout(r, 50));
                    }
                  })();
                }, 0);
              }
            }
          }
        } catch (batchErr) {
          console.warn('📦 Batch endpoint unavailable, falling back to individual calls:', batchErr);
        }
        if (batchSuccess) cumulativeMonitor.endBatch(batchLabel);
        
        
        // Step 3: Fallback — individual calls with multi-pass retry (only if batch failed)
        // v2.12.5: never run the per-farmer fallback when the batch failed because the
        // server was busy (503/timeout) — that only deepens backend pool exhaustion.
        if (!batchSuccess && batchServerBusy) {
          console.warn('📦 Batch cumulative unavailable (server busy) — skipping per-farmer fallback to protect the backend pool');
        }
        if (!batchSuccess && !batchServerBusy) {
          const now = new Date();
          const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const uncachedFarmers: typeof farmersToCache = [];
          
          for (const farmer of farmersToCache) {
            const fId = farmer.farmer_id.replace(/^#/, '').trim();
            const cached = await getFarmerCumulative(fId, cumulativeRouteCode);
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
              
              // v2.12.5: hard concurrency cap (was 25) so a failed batch can never
              // saturate the backend connection pool.
              const BATCH_SIZE = pass === 1 ? 4 : 3;
              const TIMEOUT = pass === 1 ? 5000 : pass <= 3 ? 8000 : 12000;
              const failed: typeof remaining = [];
              let passSuccess = 0;
              
              for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
                if (!navigator.onLine) break;
                const batch = remaining.slice(i, i + BATCH_SIZE);
                
                const results = await Promise.allSettled(batch.map(async (farmer) => {
                  const fId = farmer.farmer_id.replace(/^#/, '').trim();
                  const res = await Promise.race([
                    mysqlApi.farmerFrequency.getMonthlyFrequency(fId, deviceFingerprint, cumulativeRouteCode, activeSeasonCode),
                    new Promise<{ success: false }>((resolve) => setTimeout(() => resolve({ success: false }), TIMEOUT))
                  ]);
                  if (res.success && res.data) {
                    await updateFarmerCumulative(fId, res.data.cumulative_weight ?? 0, true, res.data.by_product || [], cumulativeRouteCode, activeSeasonCode, { verifySource: 'W3:prewarm-batch-fallback', caller: 'Index/cumulativeFallbackPass' });
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
                  // v2.12.5: inter-wave pacing (was 20ms) to keep server load low
                  await new Promise(r => setTimeout(r, pass === 1 ? 150 : 250));
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
  }, [isReady, showCumulative, deviceFingerprint, selectedRouteCode, activeSeasonCode, updateFarmerCumulative, saveFarmers, getFarmerCumulative]);

  // NOTE: Printed receipts are now loaded from ReprintContext, no need to load here
  // The ReprintProvider handles loading from IndexedDB

  // Reset lastSavedWeight when weight is 0 (ready for next collection) - applies to both scale and manual entry
  useEffect(() => {
    if (weight === 0 && lastSavedWeight > 0) {
      setLastSavedWeight(0);
    }
  }, [weight, lastSavedWeight]);

  // zeroOpt: Continuously check weight - unlock when it drops to ≤0.2 kg
  // This applies to BOTH scale readings AND manual weight changes
  useEffect(() => {
    if (requireZeroScale && captureLocked && weight <= 0.2) {
      setCaptureLocked(false);
      console.log('🔓 zeroOpt: Weight ≤0.2 kg detected, captureLocked=false, next capture allowed');
    }
  }, [weight, requireZeroScale, captureLocked]);

  const handleLogin = (user: AppUser, offline: boolean, password?: string) => {
    login(user, offline, password);
  };

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
  };

  const handleSelectFarmer = async (farmer: Farmer) => {
    if (isFarmerInactive(farmer)) {
      setInactiveFarmerDialog(farmer);
      setFarmerId('');
      setFarmerName('');
      setRoute('');
      setSelectedFarmer(null);
      setSearchValue('');
      return;
    }

    // Strip any leading # from farmer_id (some databases store it with prefix)
    const cleanFarmerId = farmer.farmer_id.replace(/^#/, '');
    setFarmerId(cleanFarmerId);
    setFarmerName(farmer.name);
    setRoute(farmer.route);
    setSelectedFarmer(farmer); // Store full farmer object including multOpt
    setSearchValue(`${farmer.farmer_id} - ${farmer.name}`);

    // Reset deliverer info when farmer changes
    setDeliveredBy('owner');
    setSelectedDeliverer(null);

    // v2.12.23: Derive target month from session metadata (e.g. for past seasons)
    const sessionMonth = activeSession?.datefrom ? activeSession.datefrom.substring(0, 7) : undefined;

    // 1. INSTANT LOCAL CUMULATIVE LOAD (0ms) so cumulative is immediately available
    if (showCumulative) {
      try {
        const total = await getFarmerTotalCumulative(cleanFarmerId, cumulativeRouteCode, activeSeasonCode, sessionMonth);
        const filtered = filterCumulativeByProduct(total, selectedProduct?.icode);
        setCumulativeFrequency(filtered);
      } catch (e) {
        console.warn('Instant local cumulative load failed:', e);
      }
    }

    // 2. Pre-fetch cumulative from cloud in background (online: seed cache)
    if (showCumulative && deviceFingerprint && navigator.onLine) {
      (async () => {
        try {
          const freqResult = await Promise.race([
            mysqlApi.farmerFrequency.getMonthlyFrequency(cleanFarmerId, deviceFingerprint, cumulativeRouteCode, activeSeasonCode),
            new Promise<{ success: false }>((resolve) => setTimeout(() => resolve({ success: false }), 5000))
          ]);
          if (freqResult.success && freqResult.data) {
            const cloudCumulative = freqResult.data.cumulative_weight ?? 0;
            const cloudByProduct = freqResult.data.by_product || [];
            const cloudMonth = freqResult.data.month_start ? freqResult.data.month_start.substring(0, 7) : sessionMonth;

            await updateFarmerCumulative(cleanFarmerId, cloudCumulative, true, cloudByProduct, cumulativeRouteCode, activeSeasonCode, {
              verifySource: 'W4:on-select-fetch',
              caller: 'Index/onFarmerSelect',
              monthOverride: cloudMonth
            });
            // Fresh unsynced weight from actual IndexedDB receipts (no cached localCount)
            const unsynced = await getUnsyncedWeightForFarmer(cleanFarmerId, cumulativeRouteCode, activeSeasonCode, { monthOverride: cloudMonth });
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
            console.log(`📊 Pre-fetched cumulative for ${cleanFarmerId}: cloud=${cloudCumulative}, unsynced=${unsynced.total}, month=${cloudMonth}`);
          }
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
      setSelectedRouteClientFetch(selectedRoute.clientFetch);
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
      setSelectedRouteClientFetch(undefined);
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
    // v2.12.54: Remove captured transactions one by one before clearing farmer
    if (capturedCollections.length > 0) {
      if (!window.confirm('Are you sure you want to remove the last captured transaction?')) {
        return;
      }

      const newCollections = [...capturedCollections];
      newCollections.pop();
      setCapturedCollections(newCollections);

      if (newCollections.length > 0) {
        toast.info(`Last capture removed (${newCollections.length} remaining)`);
        return; // Don't clear farmer yet
      }

      // If we just removed the last capture, proceed to clear farmer below
      toast.info('Last capture removed');
    } else if (selectedFarmer) {
      // If no captures but a farmer is selected, confirm clearing the farmer
      if (!window.confirm(`Are you sure you want to clear ${selectedFarmer.name}?`)) {
        return;
      }
    }

    setFarmerId('');
    setFarmerName('');
    setSelectedFarmer(null);
    setRoute('');
    setSearchValue('');

    // v2.12.55: Persistent zeroOpt lock — do not clear weight if scale must return to zero
    // This ensures the Capture button remains disabled for the next farmer.
    if (!requireZeroScale || !captureLocked) {
      setWeight(0);
      setLastSavedWeight(0);
    }

    setCapturedCollections([]);
    // Clear cumulative to prevent stale data display
    setCumulativeFrequency(undefined);
    // Keep route selection when clearing farmer
    toast.info('Farmer details cleared');
  };

  const handleClearRoute = () => {
    setSelectedRouteCode('');
    setSelectedRouteMprefix('');
    setSelectedRouteClientFetch(undefined);
    setRouteName('');
    setFarmerId('');
    setFarmerName('');
    setSelectedFarmer(null);
    setRoute('');
    setSearchValue('');

    // v2.12.55: Persistent zeroOpt lock — do not clear weight if scale must return to zero
    // This ensures the Capture button remains disabled for the next farmer.
    if (!requireZeroScale || !captureLocked) {
      setWeight(0);
      setLastSavedWeight(0);
    }

    setCapturedCollections([]);
    // Clear cumulative to prevent stale data display
    setCumulativeFrequency(undefined);
    toast.info('Route and farmer cleared');
  };

  // Handle starting collection from Dashboard (Buy Produce)
  const handleStartCollection = (route: Route, session: Session, product: Item | null) => {
    setSelectedRouteCode(String(route.tcode || '').trim());
    setSelectedRouteMprefix(route.mprefix || '');
    setSelectedRouteClientFetch(route.clientFetch);
    setRouteName(route.descript);
    setSession(session.descript);
    setActiveSession(session);
    setSelectedProduct(product);
    setCollectionMode('buy');
    setShowCollection(true);
  };

  // Handle starting selling from Dashboard (Sell Produce)
  const handleStartSelling = (route: Route, session: Session, product: Item | null) => {
    setSelectedRouteCode(String(route.tcode || '').trim());
    setSelectedRouteMprefix(route.mprefix || '');
    setSelectedRouteClientFetch(route.clientFetch);
    setRouteName(route.descript);
    setSession(session.descript);
    setActiveSession(session);
    setSelectedProduct(product);
    setCollectionMode('sell');
    setShowCollection(true);
  };

  // Handle going back to dashboard
  const handleBackToDashboard = () => {
    if (isSubmitting) return;
    if (capturedCollections.length > 0) {
      setShowUnsavedCapturesDialog(true);
      return;
    }
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

    // v2.12.40: Block capture if farmer is blacklisted (multOpt=0 check)
    if (isSelectedFarmerBlacklisted) {
      toast.error(`${farmerName} has already submitted for this session. Duplicate deliveries are disabled for this member.`);
      return;
    }

    // Prevent capturing zero weight entries - must have actual weight from scale or manual
    if (weight === 0 || weight <= 0) {
      toast.error('Cannot capture zero weight. Please place item on scale or enter weight manually.');
      return;
    }

    // For coffee mode: weight = net, also store gross/tare/net
    // For dairy mode: weight = total weight (no tare deduction)
    const captureWeight = roundWeight(Number(weight), 3);

    // Validate single farmer for consecutive captures
    if (capturedCollections.length > 0) {
      const firstCapture = capturedCollections[0];
      if (firstCapture.farmer_id !== farmerId) {
        toast.error(`Please submit/print receipts for ${firstCapture.farmer_name} before capturing for a different farmer`);
        return;
      }

      // Consecutive same weight prompt (applies for ALL orgtypes regardless of entry type)
      const lastCapture = capturedCollections[capturedCollections.length - 1];
      if (lastCapture.weight === captureWeight) {
        if (!window.confirm(`Are you sure you want to capture the exact same weight (${captureWeight} Kg) again?`)) {
          return; // User cancelled
        }
      }
    }

    // zeroOpt enforcement (psettings.zeroopt=1):
    // While captureLocked=true, do NOT allow capture (scale or manual)
    // Only one capture per unlock - lock must reset before another record can be captured
    if (requireZeroScale && captureLocked && weight > 0.2) {
      toast.error('Weight must drop to 0.2 Kg or below before next capture. Clear weight or remove container.');
      return;
    }

    // stableOpt enforcement (psettings.stableopt=1):
    // If enabled, block capture if scale is fluctuating
    if (appSettings.stableopt === 1 && !isScaleStable && entryType === 'scale') {
      toast.error('Scale reading is not stable. Please wait for the reading to settle.');
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

    // Preserve exact session code/description from activeSession for both Dairy & Coffee
    const exactSessionName = String(
      (activeSession as any)?.Icode || activeSession?.SCODE || activeSession?.descript || ''
    ).trim();

    let amPmSession: 'AM' | 'PM';
    const rawUpper = exactSessionName.toUpperCase();
    if (rawUpper === 'PM' || rawUpper.includes('PM') || rawUpper.includes('EVENING') || rawUpper.includes('AFTERNOON')) {
      amPmSession = 'PM';
    } else if (rawUpper === 'AM' || rawUpper.includes('AM') || rawUpper.includes('MORNING')) {
      amPmSession = 'AM';
    } else {
      const timeFrom = typeof activeSession?.time_from === 'number'
        ? activeSession.time_from
        : parseInt(String(activeSession?.time_from), 10);
      const hour = timeFrom >= 100 ? Math.floor(timeFrom / 100) : timeFrom;
      amPmSession = (!isNaN(hour) && hour >= 12) ? 'PM' : 'AM';
    }

    const currentSessionType = exactSessionName || amPmSession;
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
      referenceNo = await generateTransRefOnly(selectedRouteClientFetch) || '';
      if (!referenceNo) {
        toast.error('Failed to generate reference number.');
        return;
      }
      console.log(`⚡ Reusing uploadrefno=${uploadRefNo}, new transrefno=${referenceNo}`);
    } else {
      // First capture for this farmer - generate both transrefno and uploadrefno
      const refResult = await generateReferenceWithUploadRef('milk', selectedRouteClientFetch);
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

    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const transdate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

    const captureData: MilkCollection = {
      reference_no: referenceNo,
      uploadrefno: uploadRefNo, // Type-specific ID for approval workflow
      farmer_id: cleanFarmerId,
      farmer_name: farmerName.trim(),
      route: (selectedRouteCode || routeName || '').trim(), // Strict active collection center/route selected on Dashboard
      memberRoute: (selectedFarmer?.route || '').trim(), // Farmer's registered route
      session: currentSessionType, // Use already-computed session
      session_descript: activeSession?.descript || currentSessionType, // Full session description for display
      weight: captureWeight, // Net weight for coffee, total for dairy
      user_id: currentUser?.user_id || 'unknown', // Login user_id for DB userId column
      clerk_name: currentUser ? (currentUser.username || currentUser.user_id) : 'unknown', // Display name for clerk column
      collection_date: now,
      transdate, // v2.12.60: Explicit local date for server to avoid timezone shift
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
      // 10-digit unique milk_session_id for Dairy Buy/Sell (ensure it falls back properly)
      milk_session_id: resolveDashboardMilkSessionId() || (isCoffee ? undefined : '0'),
      // Transaction type: 1 = Buy Produce (from farmers), 2 = Sell Produce (to farmers/debtors)
      transtype: collectionMode === 'sell' ? 2 : 1,
      // Delivery tracking: save Member ID if a member was searched/selected, otherwise manual name
      delivered_by: selectedDeliverer ? selectedDeliverer.farmer_id : (deliveredBy || 'owner'),
      // Coffee sack weighing - gross/tare/net (orgtype C only)
      ...(isCoffee && {
        gross_weight: roundWeight(Number(grossWeight), 3),
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
    // Next capture blocked until weight ≤0.2 kg (scale or manual)
    setCaptureLocked(true);
    setLastCapturedFarmerId(farmerId);
    console.log('🔒 zeroOpt: Capture completed, captureLocked=true, next capture blocked until weight ≤0.2 kg');
    
    // NOTE: For multOpt=0 farmers, we do NOT add to blacklist on capture.
    // Blacklisting happens ONLY after successful submission in handleSubmit.
    // This allows unlimited weight captures (multiple buckets) but only one submission per session.
    
    // Store the saved weight for next collection check
    setLastSavedWeight(weight);

    // Reset weight for next capture (only if zeroOpt is NOT active)
    // If zeroOpt=1, weight remains until cleared by user or scale
    if (!requireZeroScale) {
      setWeight(0);
      setGrossWeight(0);
    }
    
    toast.success(`Captured ${captureData.weight} Kg${isCoffee ? ' (net)' : ''}`);
  };

  // SUBMIT: Saves all captured collections to database (online) or IndexedDB (offline)
  // Rule: Each capture is its own DB transaction with its own transrefno (reference_no).
  // Related captures (same farmer workflow) share the same uploadrefno.
  // SUBMIT: Saves all captured collections instantly (0.1ms offline-first, background async sync)
  const handleSubmit = async () => {
    if (capturedCollections.length === 0) {
      toast.error('No collections captured yet');
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);

    const deviceFingerprint = await generateDeviceFingerprint();
    
    // Pre-submit validation for multOpt=0 (instant check)
    for (const capture of capturedCollections) {
      if (capture.transtype === 2) continue;
      
      if (capture.multOpt === 0) {
        const cleanFarmerId = capture.farmer_id.replace(/^#/, '').trim();
        if (sessionSubmittedFarmers.has(cleanFarmerId) || isBlacklisted(cleanFarmerId)) {
          toast.error(
            `${capture.farmer_name} has already submitted in this session. Clear captures and try again.`,
            { duration: 4000 }
          );
          setCapturedCollections([]);
          setIsSubmitting(false);
          return;
        }
      }
    }

    // 1. INSTANT LOCAL SAVE & RECEIPT PRODUCTION (0.1ms / < 1ms response)
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
      shouldShowCumulativeForFarmer: showCumulative && collectionMode === 'buy',
      farmerIdForCumulative: selectedFarmer?.farmer_id?.replace(/^#/, '').trim() || '',
      productIcode: selectedProduct?.icode,
      routeCode: cumulativeRouteCode,
      previousCumulativeTotal: cumulativeFrequency?.total ?? 0,
      justSubmittedWeight: capturedCollections.reduce((sum, c) => sum + Number(c.weight || 0), 0),
      submittedRefs: capturedCollections.map((c) => c.reference_no).filter(Boolean) as string[],
      memberRoute: (selectedFarmer?.route || capturedCollections[0]?.route || '').trim(),
      deliveredBy: selectedDeliverer
        ? `${selectedDeliverer.farmer_id} - ${selectedDeliverer.name}`
        : (deliveredBy || 'owner'),
    };

    try {
      for (const capture of capturedCollections) {
        const referenceNo = capture.reference_no;
        const saveResult = await saveReceipt({ ...capture, reference_no: referenceNo });
        if (saveResult?.success) {
          saveToLocalDB(referenceNo, 'milk_collection', capture, currentUser?.user_id, deviceFingerprint).catch(() => {});
        }
      }
      window.dispatchEvent(new Event('receiptSaved'));
    } catch (err) {
      console.error('[ERROR] Instant local save failed:', err);
    }

    // Update blacklist & session tracking immediately
    const newlySubmittedFarmers = new Set<string>();
    capturedCollections.forEach(capture => {
      if (capture.transtype !== 2 && capture.multOpt === 0) {
        const cleanId = capture.farmer_id.replace(/^#/, '').trim();
        addToBlacklist(cleanId);
        newlySubmittedFarmers.add(cleanId);
      }
    });
    if (newlySubmittedFarmers.size > 0) {
      setSessionSubmittedFarmers(prev => new Set([...prev, ...newlySubmittedFarmers]));
    }
    setRefreshTrigger(prev => prev + 1);

    // 2. INSTANT UI RESET & RECEIPT MODAL (< 1ms response time)
    if (showCollection) {
      const prevCum = printData.previousCumulativeTotal;
      const justSubmitted = printData.justSubmittedWeight;
      const instantTotal = prevCum + justSubmitted;

      const computedCumulative = {
        total: instantTotal,
        byProduct: printData.productIcode
          ? [{ icode: printData.productIcode, product_name: printData.productName || printData.productIcode, weight: instantTotal }]
          : (cumulativeFrequency?.byProduct || [])
      };

      if (printCopies === 0) {
        setCumulativeFrequency(computedCumulative);
        setIsSubmitting(false);
        setReceiptModalOpen(true);
        addMilkReceipt(printData.collections, computedCumulative.total, computedCumulative.byProduct, {
          routeLabel: printData.routeLabel,
          periodLabel: printData.periodLabel,
          locationCode: printData.locationCode,
          locationName: printData.locationName,
          productName: printData.productName,
          memberRoute: printData.memberRoute
        }).catch(() => {});
        window.dispatchEvent(new CustomEvent('receiptModalClosed'));
        window.dispatchEvent(new CustomEvent('syncComplete'));

        triggerBackgroundSync(capturedCollections, deviceFingerprint, printData, lastCumulativeResult => {});
        return;
      }

      setCapturedCollections([]);
      setCumulativeFrequency(undefined);
      setFarmerId('');
      setFarmerName('');
      setSelectedFarmer(null);
      setSearchValue('');
      setWeight(0);
      setGrossWeight(0);
      setLastSavedWeight(0);
      setDeliveredBy('owner');
      
      setIsSubmitting(false);
      window.dispatchEvent(new CustomEvent('receiptModalClosed'));
      window.dispatchEvent(new CustomEvent('syncComplete'));

      // Print directly instantly with optimistic cumulative frequency and byProduct
      printMilkReceiptDirect(printData.collections, {
        companyName: printData.companyName,
        printCopies: printData.printCopies,
        routeLabel: printData.routeLabel,
        periodLabel: printData.periodLabel,
        locationCode: printData.locationCode,
        locationName: printData.locationName,
        cumulativeFrequency: computedCumulative.total,
        cumulativeByProduct: computedCumulative.byProduct,
        showCumulativeFrequency: printData.shouldShowCumulativeForFarmer,
        clerkName: printData.clerkName,
        productName: printData.productName,
        memberRoute: printData.memberRoute,
        deliveredBy: printData.deliveredBy,
        orgtype: settings.orgtype,
        showProductName,
      }).catch(err => console.warn('Direct print failed:', err));

      addMilkReceipt(printData.collections, computedCumulative.total, computedCumulative.byProduct, {
        routeLabel: printData.routeLabel,
        periodLabel: printData.periodLabel,
        locationCode: printData.locationCode,
        locationName: printData.locationName,
        productName: printData.productName,
        memberRoute: printData.memberRoute
      }).catch(() => {});

      // Trigger background sync
      triggerBackgroundSync(capturedCollections, deviceFingerprint, printData, lastCumulativeResult => {});
    } else {
      setReceiptModalOpen(true);
      setIsSubmitting(false);
    }
  };

  // Helper for non-blocking background async sync with instant offline fallback
  const triggerBackgroundSync = async (collections: any[], deviceFingerprint: string, printData: any, onSynced: (res: any) => void) => {
    setTimeout(async () => {
      if (!navigator.onLine) return;
      try {
        window.dispatchEvent(new CustomEvent('syncStart'));
        for (const capture of collections) {
          const sessionToSend = String(capture.session || capture.season_code || '').trim() || 'AM';
          const referenceNo = capture.reference_no;

          const apiPromise = mysqlApi.milkCollection.create({
            reference_no: referenceNo,
            uploadrefno: capture.uploadrefno,
            farmer_id: capture.farmer_id.replace(/^#/, '').trim(),
            farmer_name: capture.farmer_name.trim(),
            route: capture.route.trim(),
            session: sessionToSend,
            weight: capture.weight,
            user_id: capture.user_id,
            clerk_name: capture.clerk_name,
            collection_date: capture.collection_date,
            device_fingerprint: deviceFingerprint,
            entry_type: capture.entry_type,
            product_code: capture.product_code,
            season_code: capture.season_code,
            milk_session_id: capture.milk_session_id,
            session_descript: capture.session_descript,
            transtype: capture.transtype,
            delivered_by: capture.delivered_by,
          } as any);

          // Fast timeout (1500ms) - if slow internet, fallback to offline immediately without blocking user
          const timeoutPromise = new Promise<any>((resolve) => setTimeout(() => resolve({ success: false, timeout: true }), 1500));
          const result = await Promise.race([apiPromise, timeoutPromise]);

          if (result && result.success) {
            console.log('✅ Background synced successfully:', referenceNo);
            saveReceipt({ ...capture, reference_no: referenceNo, synced: true }).catch(() => {});
            markNativeRecordSynced(referenceNo).catch(() => {});
            onSynced(result);
          } else {
            console.warn('⚠️ Background sync slow/offline, keeping local offline record for retry:', referenceNo);
          }
        }
        window.dispatchEvent(new CustomEvent('syncComplete'));
      } catch (e) {
        console.warn('Background sync exception (falling back to offline):', e);
        window.dispatchEvent(new CustomEvent('syncComplete'));
      }
    }, 50);
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

  // v2.12.12: Handle hardware back button to close portal instead of exiting app
  useEffect(() => {
    const handleBackButton = (e: Event) => {
      if (showCollection) {
        e.preventDefault();
        handleBackToDashboard();
        console.log('[BACK] Intercepted in Index: closing portal');
      }
    };

    window.addEventListener('ionBackButton', handleBackButton);
    return () => window.removeEventListener('ionBackButton', handleBackButton);
  }, [showCollection]);

  if (!isAuthenticated) {
    console.log('[INDEX] Not authenticated, showing Login');
    return <Login onLogin={handleLogin} />;
  }

  // v2.12.14: Log authorization state to debug blank screen reports
  console.log('[INDEX] Auth state:', {
    isAuthenticated,
    isDeviceAuthorized,
    settingsLoading,
    showCollection
  });

  // 1. While authorization status is actively loading and not yet confirmed:
  if (settingsLoading && isDeviceAuthorized === null) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
        <p className="text-sm text-muted-foreground font-medium">Verifying device authorization...</p>
      </div>
    );
  }

  // 2. Block access if device is NOT authorized or is pending admin approval:
  if (isDeviceAuthorized === false || isPendingApproval) {
    console.log('[INDEX] Device NOT authorized or pending approval, showing blocking screen');
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
  if (!showCollection && !showSupervisor) {
    if ((currentUser as any)?.is_farmer) {
      return (
        <FarmerDashboard
          farmer={{
            farmer_id: currentUser?.user_id,
            name: currentUser?.username || currentUser?.user_id,
            ccode: currentUser?.ccode
          }}
          onLogout={handleLogout}
        />
      );
    }

    console.log('[INDEX] Rendering Dashboard');
    const captureMode = getCaptureMode(currentUser?.supervisor);
  
    return (
      <>
        <Dashboard
          userName={currentUser?.username || currentUser?.user_id || 'User'}
          companyName={companyName}
          isOnline={navigator.onLine}
          pendingCount={pendingCount}
          pendingMilkCount={pendingMilkCount}
          pendingMilkKgs={pendingMilkKgs}
          pendingMilkAmKgs={pendingMilkAmKgs}
          pendingMilkPmKgs={pendingMilkPmKgs}
          unsyncedMilkReceipts={unsyncedMilkReceipts}
          pendingSalesCount={pendingSalesCount}
          conflictedReceiptsCount={conflictedReceiptsCount}
          onStartCollection={handleStartCollection}
          onStartSelling={handleStartSelling}
          onLogout={handleLogout}
          onOpenRecentReceipts={() => setReprintModalOpen(true)}
          onOpenSupervisor={() => setShowSupervisor(true)}
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

  if (showSupervisor) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header
          className="sticky top-0 z-30 flex items-center gap-4 border-b bg-[#26A69A] px-4 text-white shrink-0 shadow-md"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            height: 'calc(3.5rem + env(safe-area-inset-top))',
            minHeight: '64px'
          }}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSupervisor(false)}
            className="text-white hover:bg-white/10 shrink-0"
          >
            <MoreVertical className="h-5 w-5 rotate-90" />
          </Button>
          <h1 className="text-lg font-bold truncate">Supervisor Portal</h1>
        </header>
        <main className="flex-1 overflow-y-auto pb-10">
          <SupervisorTransactions />
        </main>
      </div>
    );
  }

  console.log('[INDEX] Rendering Collection Portal');

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
  
  // v2.12.40: Disable capture for blacklisted farmers to prevent "stuck" transactions
  // Also disable capture when session is expired to prevent adding new weights while allowing pending submission
  const captureDisabledForSelectedFarmer = isSelectedFarmerBlacklisted || (appSettings.stableopt === 1 && !isScaleStable && entryType === 'scale') || isSessionExpired;
  
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
          selectedFarmer={selectedFarmer}
          todayWeight={0}
          onManualWeightChange={(w) => {
            setWeight(w);
            setEntryType('manual');
          }}
          onWeightChange={setWeight}
          onEntryTypeChange={setEntryType}
          blacklistedFarmerIds={blacklistedFarmerIds}
          sessionSubmittedFarmerIds={sessionSubmittedFarmers}
          getBlacklistDetail={getBlacklistDetail}
          onRefreshBlacklist={handleRefreshBlacklist}
          addToBlacklist={addToBlacklist}
          onFarmersLoaded={handleFarmersLoaded}
          allFarmers={allCompanyFarmers}
          captureDisabled={captureDisabledForSelectedFarmer}
          submitDisabled={submitDisabledForSelectedFarmer}
          allowDigital={captureMode.allowDigital}
          allowManual={captureMode.allowManual}
          isManualOverride={captureMode.isManualOverride}
          // Coffee mode: gross/tare/net weight handling
          grossWeight={grossWeight}
          onGrossWeightChange={setGrossWeight}
          onNetWeightChange={setWeight}
          onTareWeightChange={setTareWeight}
          sackTareWeight={sackTareWeight}
          allowSackEdit={allowSackEdit}
          zeroOptBlocked={requireZeroScale && captureLocked && weight > 0.2}
          deliveredBy={deliveredBy}
          onDeliveredByChange={handleDeliveredByChange}
          onDeliveredByMemberSelect={setSelectedDeliverer}
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
          selectedFarmer={selectedFarmer}
          todayWeight={0}
          onManualWeightChange={(w) => {
            setWeight(w);
            setEntryType('manual');
          }}
          onWeightChange={setWeight}
          onEntryTypeChange={setEntryType}
          blacklistedFarmerIds={blacklistedFarmerIds}
          sessionSubmittedFarmerIds={sessionSubmittedFarmers}
          allFarmers={allCompanyFarmers}
          captureDisabled={captureDisabledForSelectedFarmer}
          submitDisabled={submitDisabledForSelectedFarmer}
          allowDigital={captureMode.allowDigital}
          allowManual={captureMode.allowManual}
          isManualOverride={captureMode.isManualOverride}
          // Coffee mode: gross/tare/net weight handling
          grossWeight={grossWeight}
          onGrossWeightChange={setGrossWeight}
          onNetWeightChange={setWeight}
          onTareWeightChange={setTareWeight}
          sackTareWeight={sackTareWeight}
          allowSackEdit={allowSackEdit}
          zeroOptBlocked={requireZeroScale && captureLocked && weight > 0.2}
          deliveredBy={deliveredBy}
          onDeliveredByChange={handleDeliveredByChange}
          onDeliveredByMemberSelect={setSelectedDeliverer}
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
          // If zeroOpt=1, weight remains until cleared by user or scale
          if (!requireZeroScale) {
            setWeight(0);
            setGrossWeight(0); // Reset coffee gross weight
          }
          setLastSavedWeight(0);
          setDeliveredBy('owner'); // Reset for next farmer
          setSelectedDeliverer(null); // Reset for next farmer
          // Dispatch event to notify child components to focus input
          window.dispatchEvent(new CustomEvent('receiptModalClosed'));
        }}
        cumulativeFrequency={cumulativeFrequency?.total}
        cumulativeByProduct={cumulativeFrequency?.byProduct}
        showCumulativeFrequency={showCumulative && collectionMode === 'buy'}
        printCopies={printCopies}
        routeLabel={routeLabel}
        periodLabel={periodLabel}
        locationCode={selectedRouteCode}
        locationName={routeName}
        deliveredBy={selectedDeliverer ? `${selectedDeliverer.farmer_id} - ${selectedDeliverer.name}` : deliveredBy}
      />

      {/* Inactive Member Dialog */}
      <InactiveMemberDialog
        open={!!inactiveFarmerDialog}
        farmer={inactiveFarmerDialog ? { id: inactiveFarmerDialog.farmer_id.replace(/^#/, ''), name: inactiveFarmerDialog.name } : null}
        onClose={() => {
          setInactiveFarmerDialog(null);
          setFarmerId('');
          setFarmerName('');
          setRoute('');
          setSelectedFarmer(null);
          setSearchValue('');
        }}
      />

      {/* Duplicate / Cross-Device Sync Conflict Dialog */}
      <DuplicateDeliveryDialog
        open={!!syncConflict}
        farmer={syncConflict ? { id: syncConflict.farmerId, name: syncConflict.farmerName || '' } : null}
        sessionLabel={syncConflict?.session || ''}
        reason="blacklist"
        route={syncConflict?.route}
        device={syncConflict?.device}
        date={syncConflict?.date}
        onConfirmSync={async () => {
          if (syncConflict) {
            const refToClean = (syncConflict.localRef || '').trim().toUpperCase();

            // 1. Clean IDB by orderId if present
            if (syncConflict.orderId) {
              try { await markReceiptSynced(syncConflict.orderId); } catch (e) {}
            }

            // 2. Clean IDB by reference_no matching
            if (refToClean) {
              try {
                const unsynced = await getUnsyncedReceipts();
                const matches = unsynced.filter(r => (r.reference_no || '').trim().toUpperCase() === refToClean);
                for (const m of matches) {
                  if (m.orderId && typeof m.orderId === 'number') {
                    await markReceiptSynced(m.orderId);
                  }
                }
              } catch (e) {}

              // 3. Clean Native SQLite storage
              try { await markNativeRecordSynced(refToClean); } catch (e) {}
            }

            toast.success(`Duplicate delivery resolved for member ${syncConflict.farmerId}.`);
            setSyncConflict(null);

            // 4. Trigger count update & background sync immediately so stuck badge updates
            window.dispatchEvent(new Event('receiptSaved'));
            window.dispatchEvent(new Event('syncDataRequested'));
            try {
              await updatePendingCount(true);
              syncAll();
            } catch (e) {}
          }
        }}
        onClose={() => setSyncConflict(null)}
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

      {/* Session Expired Dialog - App-wide global blocker (shown when no pending captures exist) */}
      <SessionExpiredDialog
        open={isSessionExpired && capturedCollections.length === 0}
        sessionName={activeSession?.descript}
        periodLabel={periodLabel}
        pendingCount={pendingCount}
        onSelectSession={handleTopLevelSessionExpiredSelect}
      />

      {/* Unsaved Captures Dialog (Back button confirmation in Buy/Sell portal) */}
      <AlertDialog open={showUnsavedCapturesDialog} onOpenChange={setShowUnsavedCapturesDialog}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Unsubmitted Captures
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-gray-600 dark:text-gray-300 pt-2">
              You have <span className="font-semibold text-gray-900 dark:text-white">{capturedCollections.length}</span> captured item{capturedCollections.length > 1 ? 's' : ''} for <span className="font-semibold text-gray-900 dark:text-white">{selectedFarmer?.name || 'the selected member'}</span> that {capturedCollections.length > 1 ? 'have' : 'has'} not been submitted yet.
              <br /><br />
              Would you like to submit them or clear them before leaving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setShowUnsavedCapturesDialog(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowUnsavedCapturesDialog(false);
                setCapturedCollections([]);
                setShowCollection(false);
                handleClearRoute();
                toast.info('Captured items cleared');
              }}
              className="w-full sm:w-auto"
            >
              Clear Captures
            </Button>
            <Button
              onClick={async () => {
                setShowUnsavedCapturesDialog(false);
                await handleSubmit();
                setShowCollection(false);
                handleClearRoute();
              }}
              className="w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white"
            >
              Submit Captures
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default Index;
