import { useState, useEffect, useCallback } from 'react';
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
import { generateReferenceWithUploadRef, generateTransRefOnly } from '@/utils/referenceGenerator';
import { printMilkReceiptDirect } from '@/hooks/useDirectPrint';
import { toast } from 'sonner';

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
  const [cumulativeFrequency, setCumulativeFrequency] = useState<number | undefined>(undefined);
  
  // Captured collections for batch printing
  const [capturedCollections, setCapturedCollections] = useState<MilkCollection[]>([]);

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
  const { isSyncing, pendingCount, syncAllData } = useDataSync();
  
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
    allowSackEdit
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

  // Session blacklist for farmers with multOpt=0
  const [loadedFarmers, setLoadedFarmers] = useState<Farmer[]>([]);
  const [lastSessionType, setLastSessionType] = useState<'AM' | 'PM' | null>(null);
  const activeSessionTimeFrom = activeSession ? 
    (typeof activeSession.time_from === 'number' ? activeSession.time_from : parseInt(String(activeSession.time_from), 10)) 
    : undefined;
  const { blacklistedFarmerIds, isBlacklisted, addToBlacklist, refreshBlacklist, clearBlacklist, getSessionType } = useSessionBlacklist(activeSessionTimeFrom);
  
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

  // Automatic cumulative sync removed — cumulative refresh is manual only (via FarmerSyncDashboard)
  // or triggered programmatically after successful data sync via 'cumulativeRefreshNeeded' event.

  // Automatic cumulative pre-fetch removed — handled by manual refresh in FarmerSyncDashboard

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
              mysqlApi.farmerFrequency.getMonthlyFrequency(cleanFarmerId, deviceFingerprint),
              new Promise<{ success: false }>((resolve) => setTimeout(() => resolve({ success: false }), 3000))
            ]);
            if (freqResult.success && freqResult.data) {
              const cloudCumulative = freqResult.data.cumulative_weight ?? 0;
              await updateFarmerCumulative(cleanFarmerId, cloudCumulative, true);
              // Fresh unsynced weight from actual IndexedDB receipts (no cached localCount)
              const unsyncedWeight = await getUnsyncedWeightForFarmer(cleanFarmerId);
              setCumulativeFrequency(cloudCumulative + unsyncedWeight);
              console.log(`📊 Pre-fetched cumulative for ${cleanFarmerId}: cloud=${cloudCumulative}, unsynced=${unsyncedWeight}`);
              return;
            }
          }
          // Offline or fetch failed: baseCount + fresh unsynced receipts (no double-counting)
          const total = await getFarmerTotalCumulative(cleanFarmerId);
          setCumulativeFrequency(total > 0 ? total : undefined);
          console.log(`📊 Offline cumulative for ${cleanFarmerId}: total=${total}`);
        } catch (err) {
          console.warn('Failed to pre-fetch cumulative:', err);
        }
      })();
    }
  };

  const handleRouteChange = (selectedRoute: Route | null) => {
    if (selectedRoute) {
      setSelectedRouteCode(selectedRoute.tcode);
      setSelectedRouteMprefix(selectedRoute.mprefix || '');
      setRouteName(selectedRoute.descript);
      // Clear farmer when route changes
      setFarmerId('');
      setFarmerName('');
      setRoute('');
      setSearchValue('');
    } else {
      setSelectedRouteCode('');
      setSelectedRouteMprefix('');
      setRouteName('');
      setFarmerId('');
      setFarmerName('');
      setRoute('');
      setSearchValue('');
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

    // Derive AM/PM from the active session's time_from (hour-based)
    // For coffee mode (season), use the season name (descript) instead of AM/PM
    const timeFrom = typeof activeSession.time_from === 'number' 
      ? activeSession.time_from 
      : parseInt(String(activeSession.time_from), 10);
    const amPmSession: 'AM' | 'PM' = (timeFrom >= 12) ? 'PM' : 'AM';
    // For coffee (season mode), use season name; for dairy (session mode), use AM/PM
    const currentSessionType = isCoffee ? (activeSession.descript || amPmSession) : amPmSession;
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
    };

    // OPTIMIZED: Process submissions in parallel batches for faster throughput

    for (const capture of capturedCollections) {
      if (isOnline) {
        // ONLINE: Submit directly to database
        try {
          console.log(`📤 Submitting online: ${capture.reference_no} (${capture.weight} Kg)`);

          // Normalize session to AM/PM - handle legacy data that might have description
          let normalizedSession: 'AM' | 'PM' = 'AM';
          const sessionVal = (capture.session || '').trim().toUpperCase();
          if (sessionVal === 'PM' || sessionVal.includes('PM') || sessionVal.includes('EVENING') || sessionVal.includes('AFTERNOON')) {
            normalizedSession = 'PM';
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
            session: normalizedSession,
            weight: capture.weight,
            user_id: capture.user_id, // Login user_id for DB userId column
            clerk_name: capture.clerk_name, // Display name for clerk column
            collection_date: capture.collection_date,
            device_fingerprint: deviceFingerprint, // CRITICAL: Required for authorization
            entry_type: capture.entry_type, // Pass entry_type to backend
            product_code: capture.product_code, // Pass selected product icode → DB: icode column
            season_code: capture.season_code, // Pass session SCODE → DB: CAN column
            transtype: capture.transtype, // Pass transtype: 1 = Buy, 2 = Sell
          });

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

    // If the server rejected inserts as duplicates, do not proceed with receipt saving or blacklisting.
    // Keep captures intact so the user can review/clear intentionally.
    if (hardStopped) {
      toast.error('Submission stopped: server reports this farmer already submitted for this session.', {
        duration: 6000,
      });
      setIsSubmitting(false);
      return;
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

    // OPTIMIZED: Save receipt for reprinting in background (don't block UI)
    addMilkReceipt(printData.collections).catch(() => {});
    
    // Trigger refresh
    setRefreshTrigger(prev => prev + 1);

    // OPTIMIZED: Reset UI IMMEDIATELY for fast response - don't wait for print/cumulative
    if (showCollection) {
      // When printCopies === 0, show receipt modal on screen without printing
      // Calculate cumulative BEFORE showing modal so it displays correctly
      if (printCopies === 0) {
        if (showCumulative && deviceFingerprint && capturedCollections.length > 0) {
          const firstCapture = capturedCollections[0];
          const cleanId = firstCapture.farmer_id.replace(/^#/, '').trim();
          try {
            if (navigator.onLine) {
              const freqResult = await Promise.race([
                mysqlApi.farmerFrequency.getMonthlyFrequency(cleanId, deviceFingerprint),
                new Promise<{ success: false }>((resolve) => setTimeout(() => resolve({ success: false }), 2000))
              ]);
              if (freqResult.success && freqResult.data) {
                const cloudCumulative = freqResult.data.cumulative_weight ?? 0;
                await updateFarmerCumulative(cleanId, cloudCumulative, true);
                const unsyncedWeight = await getUnsyncedWeightForFarmer(cleanId);
                setCumulativeFrequency(cloudCumulative + unsyncedWeight);
              } else {
                const total = await getFarmerTotalCumulative(cleanId);
                setCumulativeFrequency(total > 0 ? total : undefined);
              }
            } else {
              // Offline: use cached baseCount + unsynced receipts
              const total = await getFarmerTotalCumulative(cleanId);
              setCumulativeFrequency(total > 0 ? total : undefined);
            }
          } catch {
            const total = await getFarmerTotalCumulative(cleanId);
            setCumulativeFrequency(total > 0 ? total : undefined);
          }
        }
        setIsSubmitting(false);
        setReceiptModalOpen(true);
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
      
      // Reset submitting state immediately
      setIsSubmitting(false);
      
      // Dispatch event to notify child components to focus input
      window.dispatchEvent(new CustomEvent('receiptModalClosed'));
      window.dispatchEvent(new CustomEvent('syncComplete'));
      
      // OPTIMIZED: Run printing and cumulative fetch AFTER UI is reset (non-blocking)
      // This allows user to immediately start next transaction while printing happens in background
      (async () => {
        let cumulativeForPrint: number | undefined = undefined;
        
        // Calculate cumulative in background with very short timeout
        if (printData.shouldShowCumulativeForFarmer && deviceFingerprint) {
          try {
            if (navigator.onLine) {
              // Very short timeout - prioritize fast printing over accurate cumulative
              const freqResult = await Promise.race([
                mysqlApi.farmerFrequency.getMonthlyFrequency(printData.farmerIdForCumulative, deviceFingerprint),
                new Promise<{ success: false }>((resolve) => 
                  setTimeout(() => resolve({ success: false }), 1500) // 1.5s timeout
                )
              ]);

              if (freqResult.success && freqResult.data) {
                const cloudCumulative = freqResult.data.cumulative_weight ?? 0;
                // cloudCumulative covers online-submitted weights; unsyncedWeight covers offline-saved receipts
                // Together they cover everything — no need to add currentCollectionWeight
                const unsyncedWeight = await getUnsyncedWeightForFarmer(printData.farmerIdForCumulative);
                cumulativeForPrint = cloudCumulative + unsyncedWeight;
                // Update cache in background
                updateFarmerCumulative(printData.farmerIdForCumulative, cloudCumulative, true).catch(() => {});
              }
            }
            
            // Offline or cloud fetch failed: use baseCount + fresh unsynced receipts
            if (cumulativeForPrint === undefined) {
              // getFarmerTotalCumulative = baseCount + unsyncedWeight from IndexedDB
              // Offline-saved receipts are already in IndexedDB, so unsyncedWeight includes them
              // Do NOT add currentCollectionWeight — that would double-count
              cumulativeForPrint = await getFarmerTotalCumulative(printData.farmerIdForCumulative);
            }
          } catch {
            // Fallback: baseCount + unsynced receipts (already includes just-saved offline receipts)
            cumulativeForPrint = await getFarmerTotalCumulative(printData.farmerIdForCumulative);
          }
        }
        
        // Print in background - don't block anything
        printMilkReceiptDirect(printData.collections, {
          companyName: printData.companyName,
          printCopies: printData.printCopies,
          routeLabel: printData.routeLabel,
          periodLabel: printData.periodLabel,
          locationCode: printData.locationCode,
          locationName: printData.locationName,
          cumulativeFrequency: cumulativeForPrint,
          showCumulativeFrequency: printData.shouldShowCumulativeForFarmer,
          clerkName: printData.clerkName,
          productName: printData.productName
        }).catch(err => console.warn('Background print failed:', err));
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
  // Get capture mode from user's supervisor setting
  const captureMode = getCaptureMode(currentUser?.supervisor);
  
  // Debug logging for supervisor mode
  console.log('📋 Dashboard - User supervisor value:', currentUser?.supervisor, '| Capture mode:', captureMode);
  
  return (
    <>
      <Dashboard
        userName={currentUser?.username || currentUser?.user_id || 'User'}
        companyName={companyName}
        isOnline={navigator.onLine}
        pendingCount={pendingCount}
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
  
  // Debug logging for supervisor mode in collection view
  console.log('📋 Collection View - User supervisor value:', currentUser?.supervisor, '| Capture mode:', captureMode);
  
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
      {collectionMode === 'buy' ? (
        <BuyProduceScreen
          route={{ tcode: selectedRouteCode, descript: routeName, mprefix: selectedRouteMprefix } as Route}
          session={activeSession!}
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
          isSubmitting={isSubmitting}
        />
      ) : (
        <SellProduceScreen
          route={{ tcode: selectedRouteCode, descript: routeName, mprefix: selectedRouteMprefix } as Route}
          session={activeSession!}
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
          // Dispatch event to notify child components to focus input
          window.dispatchEvent(new CustomEvent('receiptModalClosed'));
        }}
        cumulativeFrequency={cumulativeFrequency}
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
