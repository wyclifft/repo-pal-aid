import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Login } from '@/components/Login';
import { Dashboard } from '@/components/Dashboard';
import { BuyProduceScreen } from '@/components/BuyProduceScreen';
import { SellProduceScreen } from '@/components/SellProduceScreen';
import { ReceiptModal } from '@/components/ReceiptModal';
import { ReprintModal } from '@/components/ReprintModal';

import { useAuth } from '@/contexts/AuthContext';
import { type AppUser, type Farmer, type MilkCollection } from '@/lib/supabase';
import { type Route, type Session } from '@/services/mysqlApi';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useDataSync } from '@/hooks/useDataSync';
import { useSessionBlacklist } from '@/hooks/useSessionBlacklist';
import { useAppSettings } from '@/hooks/useAppSettings';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { generateOfflineReference } from '@/utils/referenceGenerator';
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

  // Reprint receipts state
  const [reprintModalOpen, setReprintModalOpen] = useState(false);
  const [printedReceipts, setPrintedReceipts] = useState<Array<{
    farmerId: string;
    farmerName: string;
    collections: MilkCollection[];
    printedAt: Date;
  }>>([]);

  const handleSavePrintedReceipt = async () => {
    if (capturedCollections.length === 0) return;
    
    // Check for duplicate - don't save if same farmer and same collections already exist
    const existingReceipt = printedReceipts.find(r => 
      r.farmerId === capturedCollections[0].farmer_id &&
      r.collections.length === capturedCollections.length &&
      r.collections.every((c, i) => c.reference_no === capturedCollections[i].reference_no)
    );
    
    if (existingReceipt) {
      console.log('⚠️ Receipt already saved, skipping duplicate');
      return;
    }
    
    const newPrintedReceipt = {
      farmerId: capturedCollections[0].farmer_id,
      farmerName: capturedCollections[0].farmer_name,
      collections: [...capturedCollections], // Create a copy
      printedAt: new Date()
    };
    
    // Filter out receipts older than 1 day and keep new ones
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentReceipts = printedReceipts.filter(r => {
      const printedAt = new Date(r.printedAt);
      return printedAt > oneDayAgo;
    });
    
    // Add new receipt and keep all receipts from the last 24 hours (no count limit)
    const updatedReceipts = [newPrintedReceipt, ...recentReceipts];
    setPrintedReceipts(updatedReceipts);
    
    // Persist to IndexedDB for offline access
    try {
      await savePrintedReceipts(updatedReceipts);
      console.log('✅ Printed receipt saved to IndexedDB');
    } catch (error) {
      console.error('Failed to save printed receipt:', error);
    }
  };
  const [farmerId, setFarmerId] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [selectedFarmer, setSelectedFarmer] = useState<Farmer | null>(null); // Full farmer object with multOpt
  const [route, setRoute] = useState('');
  const [routeName, setRouteName] = useState('');
  const [selectedRouteCode, setSelectedRouteCode] = useState(''); // tcode from fm_tanks
  const [session, setSession] = useState(''); // Session description from sessions table
  const [activeSession, setActiveSession] = useState<Session | null>(null); // Currently active session object
  const [searchValue, setSearchValue] = useState('');

  // Weight
  const [weight, setWeight] = useState(0);
  const [entryType, setEntryType] = useState<'scale' | 'manual'>('manual');
  const [lastSavedWeight, setLastSavedWeight] = useState(0);

  // Receipt modal
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // Captured collections for batch printing
  const [capturedCollections, setCapturedCollections] = useState<MilkCollection[]>([]);

  const { saveReceipt, savePrintedReceipts, getPrintedReceipts, getUnsyncedReceipts, clearUnsyncedReceipts, isReady } = useIndexedDB();
  
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
    routeLabel
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

  // Load printed receipts from IndexedDB on mount and filter out old ones
  useEffect(() => {
    if (!isReady) return;
    
    const loadPrintedReceipts = async () => {
      try {
        const cached = await getPrintedReceipts();
        if (cached && cached.length > 0) {
          // Filter out receipts older than 1 day
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const recentReceipts = cached.filter((r: any) => {
            const printedAt = new Date(r.printedAt);
            return printedAt > oneDayAgo;
          });
          
          setPrintedReceipts(recentReceipts);
          console.log(`📦 Loaded ${recentReceipts.length} recent receipts from cache (${cached.length - recentReceipts.length} expired)`);
          
          // Update cache if we removed old receipts
          if (recentReceipts.length !== cached.length) {
            await savePrintedReceipts(recentReceipts);
          }
        }
      } catch (error) {
        console.error('Failed to load printed receipts:', error);
      }
    };
    
    loadPrintedReceipts();
  }, [isReady, getPrintedReceipts, savePrintedReceipts]);

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
      setRouteName(selectedRoute.descript);
      // Clear farmer when route changes
      setFarmerId('');
      setFarmerName('');
      setRoute('');
      setSearchValue('');
    } else {
      setSelectedRouteCode('');
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
  const handleStartCollection = (route: Route, session: Session) => {
    setSelectedRouteCode(route.tcode);
    setRouteName(route.descript);
    setSession(session.descript);
    setActiveSession(session);
    setCollectionMode('buy');
    setShowCollection(true);
  };

  // Handle starting selling from Dashboard (Sell Produce)
  const handleStartSelling = (route: Route, session: Session) => {
    setSelectedRouteCode(route.tcode);
    setRouteName(route.descript);
    setSession(session.descript);
    setActiveSession(session);
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

    // Prevent capturing zero weight entries
    if (weight === 0) {
      toast.error('Cannot capture zero weight entry');
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
    
    // Enforce autow: restrict to digital scale only when enabled
    if (autoWeightOnly && entryType === 'manual') {
      toast.error('Manual weight entry is disabled. Please use the digital scale.');
      return;
    }

    // Derive AM/PM from the active session's time_from (hour-based)
    const timeFrom = typeof activeSession.time_from === 'number' 
      ? activeSession.time_from 
      : parseInt(String(activeSession.time_from), 10);
    const currentSessionType: 'AM' | 'PM' = (timeFrom >= 12) ? 'PM' : 'AM';
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // ========== multOpt=0 DUPLICATE SESSION CHECK (works online & offline) ==========
    // If farmer has multOpt=0, only ONE delivery per session per day is allowed
    const farmerMultOpt = selectedFarmer?.multOpt ?? 1; // Default to 1 (allow multiple)
    
    if (farmerMultOpt === 0) {
      const cleanFarmerIdCheck = farmerId.replace(/^#/, '').trim();
      
      // NOTE: We NO LONGER block duplicate captures here.
      // Multiple captures are allowed (e.g., farmer brings 3 buckets = 3 captures).
      // Blocking only happens at SUBMIT time (once per session).
      
      // 1. Check IndexedDB for unsynced receipts (already SUBMITTED offline)
      try {
        const unsyncedReceipts = await getUnsyncedReceipts();
        const offlineDuplicate = unsyncedReceipts.some((r: MilkCollection) => {
          const receiptDate = new Date(r.collection_date).toISOString().split('T')[0];
          return (
            r.farmer_id === cleanFarmerIdCheck &&
            r.session === currentSessionType &&
            receiptDate === today
          );
        });
        if (offlineDuplicate) {
          toast.error(
            `${farmerName} already submitted in ${currentSessionType} session. Found in pending sync.`,
            { duration: 5000 }
          );
          return;
        }
      } catch (e) {
        console.warn('Could not check IndexedDB for duplicates:', e);
      }

      // 2. Check online API if connected (already SUBMITTED online)
      if (navigator.onLine) {
        try {
          const deviceFingerprint = await generateDeviceFingerprint();
          const existing = await mysqlApi.milkCollection.getByFarmerSessionDate(
            cleanFarmerIdCheck,
            currentSessionType,
            today,
            today,
            deviceFingerprint
          );
          if (existing) {
            toast.error(
              `${farmerName} already delivered in ${currentSessionType} session today. Use Reprint for previous slip.`,
              { duration: 6000 }
            );
            setReprintModalOpen(true);
            return;
          }
        } catch (apiErr) {
          console.warn('Online duplicate check failed, proceeding:', apiErr);
        }
      }
    }
    // ========== END multOpt CHECK ==========

    // Generate reference number for this capture
    const deviceFingerprint = await generateDeviceFingerprint();
    let referenceNo = '';
    
    // Always generate offline-style reference for captures (will be validated on submit)
    const offlineRef = await generateOfflineReference();
    if (offlineRef) {
      referenceNo = offlineRef;
    } else {
      toast.error('Failed to generate reference number.');
      return;
    }

    // Create local capture record (NOT synced to DB yet)
    // Clean farmer_id - reuse currentSessionType computed above
    const cleanFarmerId = farmerId.replace(/^#/, '').trim();
    
    const captureData: MilkCollection = {
      reference_no: referenceNo,
      farmer_id: cleanFarmerId,
      farmer_name: farmerName.trim(),
      route: route.trim(),
      session: currentSessionType, // Use already-computed session
      weight: parseFloat(Number(weight).toFixed(2)),
      clerk_name: currentUser ? currentUser.user_id : 'unknown',
      collection_date: new Date(),
      multOpt: farmerMultOpt,
      orderId: Date.now(),
      synced: false, // Not synced - only locally captured
    };

    console.log('🔵 CAPTURE #' + (capturedCollections.length + 1) + ' - Local capture only (not submitted)');
    console.log('📝 Reference:', referenceNo);
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
  const handleSubmit = async () => {
    if (capturedCollections.length === 0) {
      toast.error('No collections captured yet');
      return;
    }

    const deviceFingerprint = await generateDeviceFingerprint();
    let successCount = 0;
    let offlineCount = 0;

    // Check network status first
    const isOnline = navigator.onLine;
    console.log(`📡 Network status: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);

    // Dispatch sync start event
    window.dispatchEvent(new CustomEvent('syncStart'));

    for (const capture of capturedCollections) {
      if (isOnline) {
        // ONLINE: Submit directly to database
        try {
          console.log(`📤 Submitting online: ${capture.reference_no}`);

          // Normalize session to AM/PM - handle legacy data that might have description
          let normalizedSession: 'AM' | 'PM' = 'AM';
          const sessionVal = (capture.session || '').trim().toUpperCase();
          if (sessionVal === 'PM' || sessionVal.includes('PM') || sessionVal.includes('EVENING') || sessionVal.includes('AFTERNOON')) {
            normalizedSession = 'PM';
          }

          // Client-side FINAL GUARD for multOpt=0 (works even if backend is not enforcing yet)
          if (capture.multOpt === 0) {
            const captureDate = new Date(capture.collection_date).toISOString().split('T')[0];
            const existing = await mysqlApi.milkCollection.getByFarmerSessionDate(
              capture.farmer_id.replace(/^#/, '').trim(),
              normalizedSession,
              captureDate,
              captureDate,
              deviceFingerprint
            );

            if (existing) {
              toast.error(
                `${capture.farmer_name} has already delivered in the ${normalizedSession} session today. Use Reprint for previous slip.`,
                { duration: 6000 }
              );
              setCapturedCollections([]);
              setReprintModalOpen(true);
              window.dispatchEvent(new CustomEvent('syncComplete'));
              return;
            }
          }

          // Get fresh reference from backend for online submissions
          let referenceNo = capture.reference_no;
          try {
            const refResult = await mysqlApi.milkCollection.getNextReference(deviceFingerprint);
            if (refResult.data?.reference_no) {
              referenceNo = refResult.data.reference_no;
              console.log(`🔢 Got fresh reference: ${referenceNo}`);
            }
          } catch (refError) {
            console.warn('Could not get backend reference, using existing:', refError);
          }

          const result = await mysqlApi.milkCollection.create({
            reference_no: referenceNo,
            farmer_id: capture.farmer_id.replace(/^#/, '').trim(),
            farmer_name: capture.farmer_name.trim(),
            route: capture.route.trim(),
            session: normalizedSession,
            weight: capture.weight,
            clerk_name: capture.clerk_name,
            collection_date: capture.collection_date,
            device_fingerprint: deviceFingerprint, // CRITICAL: Required for authorization
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
                `${capture.farmer_name} has already delivered in the ${capture.session} session today. Open Reprint to print the previous slip.`,
                { duration: 6000 }
              );
              // Clear this capture and open reprint modal
              setCapturedCollections([]);
              setReprintModalOpen(true);
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
              `${capture.farmer_name} has already delivered in the ${capture.session} session today. Open Reprint to print the previous slip.`,
              { duration: 6000 }
            );
            // Clear this capture and open reprint modal
            setCapturedCollections([]);
            setReprintModalOpen(true);
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
    return (
      <>
        <Dashboard
          userName={currentUser?.user_id || 'User'}
          companyName={companyName}
          isOnline={navigator.onLine}
          pendingCount={pendingCount}
          onStartCollection={handleStartCollection}
          onStartSelling={handleStartSelling}
          onLogout={handleLogout}
          onOpenRecentReceipts={() => setReprintModalOpen(true)}
        />
        
        {/* Reprint Modal - accessible from Dashboard */}
        <ReprintModal
          open={reprintModalOpen}
          onClose={() => setReprintModalOpen(false)}
          receipts={printedReceipts}
          companyName={companyName}
        />
      </>
    );
  }

  // Collection View - render Buy or Sell screen based on mode
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
  const submitDisabledForSelectedFarmer = isSelectedFarmerBlacklisted;

  return (
    <>
      {collectionMode === 'buy' ? (
        <BuyProduceScreen
          route={{ tcode: selectedRouteCode, descript: routeName } as Route}
          session={activeSession!}
          userName={currentUser?.user_id || 'User'}
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
          blacklistedFarmerIds={blacklistedFarmerIds}
          onFarmersLoaded={handleFarmersLoaded}
          captureDisabled={captureDisabledForSelectedFarmer}
          submitDisabled={submitDisabledForSelectedFarmer}
        />
      ) : (
        <SellProduceScreen
          route={{ tcode: selectedRouteCode, descript: routeName } as Route}
          session={activeSession!}
          userName={currentUser?.user_id || 'User'}
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
          captureDisabled={captureDisabledForSelectedFarmer}
          submitDisabled={submitDisabledForSelectedFarmer}
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
        }}
        onPrint={handleSavePrintedReceipt}
        showCumulativeFrequency={showCumulative}
        printCopies={printCopies}
        routeLabel={routeLabel}
      />

      {/* Reprint Modal */}
      <ReprintModal
        open={reprintModalOpen}
        onClose={() => setReprintModalOpen(false)}
        receipts={printedReceipts}
        companyName={companyName}
        printCopies={printCopies}
        routeLabel={routeLabel}
      />
    </>
  );
};

export default Index;
