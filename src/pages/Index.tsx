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

  // Weight
  const [weight, setWeight] = useState(0);
  const [entryType, setEntryType] = useState<'scale' | 'manual'>('manual');
  const [lastSavedWeight, setLastSavedWeight] = useState(0);

  // Receipt modal
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
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
    updateFarmerCumulative,
    getFarmerTotalCumulative
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
    isCoffee
  } = useAppSettings();

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

  // NOTE: Printed receipts are now loaded from ReprintContext, no need to load here
  // The ReprintProvider handles loading from IndexedDB

  // Reset lastSavedWeight when weight is 0 (ready for next collection) - applies to both scale and manual entry
  useEffect(() => {
    if (weight === 0 && lastSavedWeight > 0) {
      setLastSavedWeight(0);
    }
  }, [weight, lastSavedWeight]);

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

    if (!farmerId || !route || !weight || !session) {
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

    // Check if scale reads 0 before next collection (enforced when zeroOpt=1 or for scale entry)
    if ((requireZeroScale || entryType === 'scale') && lastSavedWeight > 0 && weight > 0) {
      toast.error('Scale must read 0 before next collection');
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
    const farmerMultOpt = selectedFarmer?.multOpt ?? 1; // Default to 1 (allow multiple)
    // ========== END multOpt CHECK ==========

    // Generate reference number for this capture
    // Rule: Each capture gets unique transrefno, but all captures for same farmer in session share ONE uploadrefno
    const deviceFingerprint = await generateDeviceFingerprint();
    let referenceNo = '';
    let uploadRefNo: string | undefined;
    
    // Check if we already have captures for this farmer (same session) - reuse their uploadrefno
    const existingFarmerCapture = capturedCollections.find(c => c.farmer_id === farmerId.replace(/^#/, '').trim());
    
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
    
    const captureData: MilkCollection = {
      reference_no: referenceNo,
      uploadrefno: uploadRefNo, // Type-specific ID for approval workflow
      farmer_id: cleanFarmerId,
      farmer_name: farmerName.trim(),
      route: selectedRouteCode.trim(), // Use fm_tanks.tcode, not farmer.route
      session: currentSessionType, // Use already-computed session
      weight: parseFloat(Number(weight).toFixed(2)),
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
    };

    console.log('🔵 CAPTURE #' + (capturedCollections.length + 1) + ' - Local capture only (not submitted)');
    console.log('📝 Reference:', referenceNo, 'UploadRef:', uploadRefNo);
    console.log('👤 Farmer:', farmerId, farmerName);
    console.log('⚖️ Weight:', captureData.weight, 'Kg');

    // Add to captured collections for display
    setCapturedCollections(prev => [...prev, captureData]);
    
    // NOTE: For multOpt=0 farmers, we do NOT add to blacklist on capture.
    // Blacklisting happens ONLY after successful submission in handleSubmit.
    // This allows unlimited weight captures (multiple buckets) but only one submission per session.
    
    // Store the saved weight for next collection check
    setLastSavedWeight(weight);

    // Reset weight for next capture
    setWeight(0);
    
    toast.success(`Captured ${captureData.weight} Kg`);
  };

  // SUBMIT: Saves all captured collections to database (online) or IndexedDB (offline)
  // For multOpt=0 farmers: ALL captures are SUMMED into ONE submission
  // For multOpt=1 farmers: Each capture is submitted separately
  const handleSubmit = async () => {
    if (capturedCollections.length === 0) {
      toast.error('No collections captured yet');
      return;
    }

    const deviceFingerprint = await generateDeviceFingerprint();
    
    // ========== PRE-SUBMIT VALIDATION for multOpt=0 ==========
    // Check if ANY captured collection is from a farmer who has already submitted
    // This is the ONLY place where blacklist/sessionSubmittedFarmers checks occur
    for (const capture of capturedCollections) {
      if (capture.multOpt === 0) {
        const cleanFarmerId = capture.farmer_id.replace(/^#/, '').trim();
        
        // Check local session tracking first (immediate feedback)
        if (sessionSubmittedFarmers.has(cleanFarmerId)) {
          toast.error(
            `${capture.farmer_name} has already submitted in this session. Clear captures and try again.`,
            { duration: 5000 }
          );
          setCapturedCollections([]);
          return;
        }
        
        // Check blacklist (populated from IndexedDB + online records)
        if (isBlacklisted(cleanFarmerId)) {
          toast.error(
            `${capture.farmer_name} has already delivered in this session today. Clear captures and try again.`,
            { duration: 5000 }
          );
          setCapturedCollections([]);
          return;
        }
      }
    }
    // ========== END PRE-SUBMIT VALIDATION ==========

    let successCount = 0;
    let offlineCount = 0;

    // Check network status first
    const isOnline = navigator.onLine;
    console.log(`📡 Network status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

    // Dispatch sync start event
    window.dispatchEvent(new CustomEvent('syncStart'));

    // Each capture is saved separately in the database - no accumulation
    console.log(`📦 Processing ${capturedCollections.length} captures (each saved separately)`);

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
              setCapturedCollections([]);
              window.dispatchEvent(new CustomEvent('syncComplete'));
              return; // Stop processing
            }
            // API returned failure, save locally for retry
            console.warn('⚠️ Submit returned failure, saving locally');
            await saveReceipt({...capture, reference_no: referenceNo});
            offlineCount++;
          }
        } catch (err: unknown) {
          // Check if the error response contains duplicate session info
          const errorData = (err as { data?: { error?: string; message?: string; existing_reference?: string } })?.data;
          if (errorData?.error === 'DUPLICATE_SESSION_DELIVERY') {
            console.warn(`⚠️ Member already delivered in ${capture.session} session`);
            toast.error(
              `${capture.farmer_name} has already delivered in the ${capture.session} session today.`,
              { duration: 6000 }
            );
            setCapturedCollections([]);
            window.dispatchEvent(new CustomEvent('syncComplete'));
            return; // Stop processing
          }
          console.error('❌ Submit error, saving locally:', err);
          // Network error or other failure - save to IndexedDB for later sync
          await saveReceipt(capture);
          offlineCount++;
        }
      } else {
        // OFFLINE: Save to IndexedDB for later sync
        await saveReceipt(capture);
        offlineCount++;
        console.log('📦 Saved offline for sync:', capture.reference_no);
      }
    }

    // Dispatch sync complete event
    window.dispatchEvent(new CustomEvent('syncComplete'));

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

    // After successful submission, add multOpt=0 farmers to blacklist and local tracking
    // This ensures they cannot submit again in this session
    if (successCount > 0 || offlineCount > 0) {
      const newlySubmittedFarmers = new Set<string>();
      
      capturedCollections.forEach(capture => {
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

    // Save receipt for reprinting IMMEDIATELY after submission (before modal opens)
    // This ensures receipt is saved even if user closes modal without clicking Print
    await addMilkReceipt(capturedCollections);
    
    const shouldShowCumulativeForFarmer =
      showCumulative && Number(selectedFarmer?.currqty) === 1;

    // Calculate cumulative weight if farmer has currqty=1 and global showCumulative is enabled
    // CLOUD-BASED ACCUMULATION: ALWAYS fetch fresh from backend - never use stale local cache
    // IMPORTANT: If we submitted online successfully, the cloud ALREADY includes our submission
    // If we saved offline, we need to add the current weight to the cloud value
    if (shouldShowCumulativeForFarmer && deviceFingerprint) {
      const cleanFarmerId = selectedFarmer!.farmer_id.replace(/^#/, '').trim();
      const currentCollectionWeight = capturedCollections.reduce((sum, c) => sum + c.weight, 0);
      
      // Determine if our collection was synced to cloud (successCount > 0 means it's already in the cloud)
      const wasSubmittedOnline = successCount > 0;

      // FORCE CLOUD REFRESH: Always fetch fresh cumulative from backend
      // Retry up to 3 times with timeout to ensure we get the latest cloud value
      let cloudCumulative: number | null = null;
      let attempts = 0;
      const maxAttempts = 3;
      
      // If submitted online, wait a moment for the database to settle
      if (wasSubmittedOnline) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      while (attempts < maxAttempts && cloudCumulative === null) {
        attempts++;
        try {
          console.log(`🔄 Fetching cloud cumulative (attempt ${attempts}/${maxAttempts})...`);
          
          // Fetch cloud cumulative with timeout
          const freqResult = await Promise.race([
            mysqlApi.farmerFrequency.getMonthlyFrequency(cleanFarmerId, deviceFingerprint),
            new Promise<{ success: false }>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 5000)
            )
          ]);

          if (freqResult.success && freqResult.data) {
            cloudCumulative = freqResult.data.cumulative_weight ?? 0;
            console.log(`✅ Cloud Cumulative fetched: ${cloudCumulative} (attempt ${attempts})`);
          }
        } catch (error) {
          console.warn(`⚠️ Cloud fetch attempt ${attempts} failed:`, error);
          if (attempts < maxAttempts) {
            // Wait 500ms before retry
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      if (cloudCumulative !== null) {
        // SUCCESS: Got fresh cloud value
        // CRITICAL FIX: If we submitted ONLINE, the cloud cumulative ALREADY includes our submission
        // Only add currentCollectionWeight if we saved OFFLINE (it's not in cloud yet)
        let displayTotal: number;
        
        if (wasSubmittedOnline) {
          // Cloud already has our data, just use cloud value directly
          displayTotal = cloudCumulative;
          console.log(`📊 ONLINE: Cloud Cumulative already includes submission: ${cloudCumulative}`);
        } else {
          // Offline: cloud doesn't have our data yet, add it
          displayTotal = cloudCumulative + currentCollectionWeight;
          console.log(`📊 OFFLINE: Cloud Cumulative: ${cloudCumulative} + Current: ${currentCollectionWeight} = ${displayTotal}`);
        }
        
        await updateFarmerCumulative(cleanFarmerId, cloudCumulative, true);
        setCumulativeFrequency(displayTotal);
      } else {
        // FAILED after all retries - show toast warning and use local cache as last resort
        console.error('❌ Failed to fetch cloud cumulative after all retries, using local cache');
        toast.warning('Could not fetch latest cumulative from cloud - showing cached value');
        const cachedTotal = await getFarmerTotalCumulative(cleanFarmerId);
        const newTotal = cachedTotal + currentCollectionWeight;
        await updateFarmerCumulative(cleanFarmerId, currentCollectionWeight, false);
        setCumulativeFrequency(newTotal);
      }
    } else {
      setCumulativeFrequency(undefined);
    }

    // Open receipt modal for printing
    setReceiptModalOpen(true);
    
    // Trigger refresh
    setRefreshTrigger(prev => prev + 1);
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
          onFarmersLoaded={handleFarmersLoaded}
          captureDisabled={captureDisabledForSelectedFarmer}
          submitDisabled={submitDisabledForSelectedFarmer}
          allowDigital={captureMode.allowDigital}
          allowManual={captureMode.allowManual}
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
          captureDisabled={captureDisabledForSelectedFarmer}
          submitDisabled={submitDisabledForSelectedFarmer}
          allowDigital={captureMode.allowDigital}
          allowManual={captureMode.allowManual}
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
        }}
        cumulativeFrequency={cumulativeFrequency}
        showCumulativeFrequency={showCumulative && Number(selectedFarmer?.currqty) === 1}
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
