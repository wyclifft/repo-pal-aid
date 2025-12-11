import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Login } from '@/components/Login';
import { Dashboard } from '@/components/Dashboard';
import { BuyProduceScreen } from '@/components/BuyProduceScreen';
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
    
    const newPrintedReceipt = {
      farmerId: capturedCollections[0].farmer_id,
      farmerName: capturedCollections[0].farmer_name,
      collections: capturedCollections,
      printedAt: new Date()
    };
    
    // Keep only last 20 receipts
    const updatedReceipts = [newPrintedReceipt, ...printedReceipts].slice(0, 20);
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

  // Load printed receipts from IndexedDB on mount
  useEffect(() => {
    if (!isReady) return;
    
    const loadPrintedReceipts = async () => {
      try {
        const cached = await getPrintedReceipts();
        if (cached && cached.length > 0) {
          setPrintedReceipts(cached);
          console.log(`📦 Loaded ${cached.length} printed receipts from cache`);
        }
      } catch (error) {
        console.error('Failed to load printed receipts:', error);
      }
    };
    
    loadPrintedReceipts();
  }, [isReady, getPrintedReceipts]);

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

  // Handle starting collection from Dashboard
  const handleStartCollection = (route: Route, session: Session) => {
    setSelectedRouteCode(route.tcode);
    setRouteName(route.descript);
    setSession(session.descript);
    setActiveSession(session);
    setShowCollection(true);
  };

  // Handle going back to dashboard
  const handleBackToDashboard = () => {
    setShowCollection(false);
    // Clear collection state
    handleClearRoute();
  };

  const handleSaveCollection = async () => {
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

    // Check if scale reads 0 before next collection (only for scale entry)
    if (entryType === 'scale' && lastSavedWeight > 0 && weight > 0) {
      toast.error('Scale must read 0 before next collection');
      return;
    }

    const now = new Date();
    const year = now.getFullYear();

    // Get device fingerprint
    const deviceFingerprint = await generateDeviceFingerprint();

    // Generate reference number - SIMPLE APPROACH
    let referenceNo = '';
    
    if (navigator.onLine) {
      // ONLINE: Get reference from backend
      try {
        console.log('📡 Fetching reference from backend...');
        const refResult = await mysqlApi.milkCollection.getNextReference(deviceFingerprint);
        if (refResult.data?.reference_no) {
          referenceNo = refResult.data.reference_no;
          console.log('✅ Backend reference:', referenceNo);
        } else {
          throw new Error('No reference_no in response');
        }
      } catch (error: any) {
        console.error('Backend reference failed:', error);
        
        // Check if it's a 401 authorization error
        const errorMessage = error?.message || '';
        if (errorMessage.includes('401') || errorMessage.includes('not authorized')) {
          localStorage.setItem('device_authorized', 'false');
          setIsDeviceAuthorized(false);
          toast.error('Device not authorized. Please contact admin.');
          return;
        }
        
        // Fallback to offline for other errors
        const offlineRef = await generateOfflineReference();
        if (offlineRef) {
          referenceNo = offlineRef;
          console.log('⚠️ Using offline fallback reference:', referenceNo);
        } else {
          toast.error('Failed to generate reference number.');
          return;
        }
      }
    } else {
      // OFFLINE: Generate timestamp-based reference
      const offlineRef = await generateOfflineReference();
      if (offlineRef) {
        referenceNo = offlineRef;
        console.log('✅ Offline reference:', referenceNo);
      } else {
        toast.error('Failed to generate offline reference.');
        return;
      }
    }

    // Get start and end of current month
    const monthStart = new Date(year, now.getMonth(), 1);
    const monthEnd = new Date(year, now.getMonth() + 1, 0, 23, 59, 59);

    // Prepare milk data for capture
    let milkData: MilkCollection;

    // Save online - always create new record
    if (navigator.onLine) {
      try {
        const onlineMilkData: any = {
          reference_no: referenceNo,
          farmer_id: farmerId,
          farmer_name: farmerName,
          route: route,
          session: session as 'AM' | 'PM',
          weight: parseFloat(Number(weight).toFixed(2)),
          clerk_name: currentUser ? currentUser.user_id : 'unknown',
          collection_date: new Date(),
          device_fingerprint: deviceFingerprint,
          entry_type: entryType,
          orderId: Date.now(),
          synced: false,
        };

        console.log('🔵 CAPTURE #' + (capturedCollections.length + 1) + ' - Creating NEW record online');
        console.log('📝 Reference:', referenceNo);
        console.log('👤 Farmer:', farmerId, farmerName);
        console.log('⚖️ Weight:', onlineMilkData.weight, 'Kg');
        console.log('📅 Session:', session);
        
        const result = await mysqlApi.milkCollection.create(onlineMilkData);
        
        if (result.success) {
          // Check if backend regenerated the reference number
          const finalReferenceNo = result.reference_no || referenceNo;
          if (finalReferenceNo !== referenceNo) {
            console.log(`🔄 Backend regenerated reference: ${referenceNo} → ${finalReferenceNo}`);
          }
          
          console.log('✅ NEW record created successfully in database');
          milkData = { 
            ...onlineMilkData, 
            reference_no: finalReferenceNo,
            synced: true 
          };
        } else {
          throw new Error('Failed to create record');
        }
      } catch (err) {
        console.error('Save error:', err);
        // Save locally on error
        milkData = {
          reference_no: referenceNo,
          farmer_id: farmerId,
          farmer_name: farmerName,
          route: route,
          session: session as 'AM' | 'PM',
          weight: parseFloat(Number(weight).toFixed(2)),
          clerk_name: currentUser ? currentUser.user_id : 'unknown',
          collection_date: new Date(),
          orderId: Date.now(),
          synced: false,
        };
        saveReceipt(milkData);
        toast.warning('Saved locally, will sync when online');
      }
    } else {
      // Save locally when offline
      milkData = {
        reference_no: referenceNo,
        farmer_id: farmerId,
        farmer_name: farmerName,
        route: route,
        session: session as 'AM' | 'PM',
        weight: parseFloat(Number(weight).toFixed(2)),
        clerk_name: currentUser ? currentUser.user_id : 'unknown',
        collection_date: new Date(),
        orderId: Date.now(),
        synced: false,
      };
      saveReceipt(milkData);
      toast.warning('Saved locally, will sync when online');
    }

    // Validate single farmer for consecutive captures
    if (capturedCollections.length > 0) {
      const firstCapture = capturedCollections[0];
      if (firstCapture.farmer_id !== farmerId) {
        toast.error(`Please print receipts for ${firstCapture.farmer_name} before capturing for a different farmer`);
        return;
      }
    }

    // Add to captured collections
    setCapturedCollections(prev => [...prev, milkData]);
    
    // Trigger refresh of receipt list
    setRefreshTrigger(prev => prev + 1);

    // Store the saved weight for next collection check
    setLastSavedWeight(weight);

    // Success message
    toast.success('Collection captured! Ready for next entry.');

    // Keep farmer details for quick consecutive captures, only reset weight
    // Scale-based entries require scale to return to 0 before next capture (handled by validation)
    setWeight(0);
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
      <Dashboard
        userName={currentUser?.user_id || 'User'}
        companyName={companyName}
        isOnline={navigator.onLine}
        pendingCount={pendingCount}
        onStartCollection={handleStartCollection}
        onLogout={handleLogout}
      />
    );
  }

  // Collection View - use new BuyProduceScreen
  return (
    <>
      <BuyProduceScreen
        route={{ tcode: selectedRouteCode, descript: routeName } as Route}
        session={activeSession!}
        userName={currentUser?.user_id || 'User'}
        weight={weight}
        capturedCollections={capturedCollections}
        onBack={handleBackToDashboard}
        onCapture={handleSaveCollection}
        onSubmit={handlePrintAllCaptures}
        onSelectFarmer={handleSelectFarmer}
        onClearFarmer={handleClearFarmer}
        selectedFarmer={farmerId ? { id: farmerId, name: farmerName } : null}
        todayWeight={0}
      />

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
