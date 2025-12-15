import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Login } from '@/components/Login';
import { Dashboard } from '@/components/Dashboard';
import { BuyProduceScreen } from '@/components/BuyProduceScreen';
import { SellProduceScreen } from '@/components/SellProduceScreen';
import { ReceiptModal } from '@/components/ReceiptModal';
import { ReprintModal } from '@/components/ReprintModal';
import { DeviceAuthStatus } from '@/components/DeviceAuthStatus';
import { useAuth } from '@/contexts/AuthContext';
import { type AppUser, type Farmer, type MilkCollection } from '@/lib/supabase';
import { type Route, type Session } from '@/services/mysqlApi';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useDataSync } from '@/hooks/useDataSync';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { generateOfflineReference } from '@/utils/referenceGenerator';
import { toast } from 'sonner';

const Index = () => {
  const navigate = useNavigate();
  const { currentUser, isOffline, login, logout, isAuthenticated } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showCollection, setShowCollection] = useState(false); // Controls dashboard vs collection view
  const [collectionMode, setCollectionMode] = useState<'buy' | 'sell'>('buy'); // Buy or Sell mode

  // Company name and authorization status from device
  const [companyName, setCompanyName] = useState<string>(() => {
    return localStorage.getItem('device_company_name') || 'DAIRY COLLECTION';
  });
  const [isDeviceAuthorized, setIsDeviceAuthorized] = useState<boolean>(() => {
    const cached = localStorage.getItem('device_authorized');
    return cached ? JSON.parse(cached) : false;
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

  // Reset lastSavedWeight when scale reads 0 (ready for next collection)
  useEffect(() => {
    if (entryType === 'scale' && weight === 0 && lastSavedWeight > 0) {
      setLastSavedWeight(0);
    }
  }, [weight, entryType, lastSavedWeight]);

  const handleLogin = (user: AppUser, offline: boolean, password?: string) => {
    login(user, offline, password);
  };

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
  };

  const handleSelectFarmer = (farmer: Farmer) => {
    setFarmerId(farmer.farmer_id);
    setFarmerName(farmer.name);
    setRoute(farmer.route);
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

  const handleAuthorizationChange = (authorized: boolean) => {
    setIsDeviceAuthorized(authorized);
    localStorage.setItem('device_authorized', JSON.stringify(authorized));
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

    // Check if scale reads 0 before next collection (only for scale entry)
    if (entryType === 'scale' && lastSavedWeight > 0 && weight > 0) {
      toast.error('Scale must read 0 before next collection');
      return;
    }

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
    const captureData: MilkCollection = {
      reference_no: referenceNo,
      farmer_id: farmerId,
      farmer_name: farmerName,
      route: route,
      session: session as 'AM' | 'PM',
      weight: parseFloat(Number(weight).toFixed(2)),
      clerk_name: currentUser ? currentUser.user_id : 'unknown',
      collection_date: new Date(),
      orderId: Date.now(),
      synced: false, // Not synced - only locally captured
    };

    console.log('🔵 CAPTURE #' + (capturedCollections.length + 1) + ' - Local capture only (not submitted)');
    console.log('📝 Reference:', referenceNo);
    console.log('👤 Farmer:', farmerId, farmerName);
    console.log('⚖️ Weight:', captureData.weight, 'Kg');

    // Add to captured collections for display
    setCapturedCollections(prev => [...prev, captureData]);
    
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
            farmer_id: capture.farmer_id,
            farmer_name: capture.farmer_name,
            route: capture.route,
            session: capture.session as 'AM' | 'PM',
            weight: capture.weight,
            clerk_name: capture.clerk_name,
            collection_date: capture.collection_date,
          } as any);

          console.log(`📨 Submit result for ${referenceNo}:`, result);

          if (result.success) {
            successCount++;
            console.log('✅ Submitted to database:', referenceNo);
          } else {
            // API returned failure, save locally for retry
            console.warn('⚠️ Submit returned failure, saving locally');
            await saveReceipt({...capture, reference_no: referenceNo});
            offlineCount++;
          }
        } catch (err) {
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
      />

      {/* Reprint Modal */}
      <ReprintModal
        open={reprintModalOpen}
        onClose={() => setReprintModalOpen(false)}
        receipts={printedReceipts}
        companyName={companyName}
      />
    </>
  );
};

export default Index;
