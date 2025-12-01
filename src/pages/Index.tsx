import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Login } from '@/components/Login';
import { FarmerSearch } from '@/components/FarmerSearch';
import { WeightInput } from '@/components/WeightInput';
import { ReceiptList } from '@/components/ReceiptList';
import { ReceiptModal } from '@/components/ReceiptModal';
import { DeviceAuthStatus } from '@/components/DeviceAuthStatus';
import { useAuth } from '@/contexts/AuthContext';
import { type AppUser, type Farmer, type MilkCollection } from '@/lib/supabase';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { generateOfflineReference, syncReferenceCounter } from '@/utils/referenceGenerator';
import { toast } from 'sonner';
import { Menu, X, User, Scale, FileText, BarChart3, Printer, ShoppingBag, FileBarChart, Settings } from 'lucide-react';

const Index = () => {
  const navigate = useNavigate();
  const { currentUser, isOffline, login, logout, isAuthenticated } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Farmer details
  const [farmerId, setFarmerId] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [route, setRoute] = useState('');
  const [session, setSession] = useState('');
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

  const { saveReceipt } = useIndexedDB();

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

  const handleSaveCollection = async () => {
    if (!farmerId || !route || !weight || !session) {
      toast.error('Enter farmer, route, session, and weight');
      return;
    }

    // Check if scale reads 0 for consecutive collections (except manual entry)
    if (entryType === 'scale' && lastSavedWeight > 0 && weight > 0) {
      toast.error('Scale must read 0 before next collection');
      return;
    }

    const now = new Date();
    const year = now.getFullYear();

    // Get device fingerprint
    const deviceFingerprint = await generateDeviceFingerprint();

    // Generate reference number - BACKEND FIRST approach for consistency
    let referenceNo = '';
    
    if (navigator.onLine) {
      // ONLINE: Always get reference from backend first
      try {
        console.log('Fetching reference from backend...');
        const refResult = await mysqlApi.milkCollection.getNextReference(deviceFingerprint);
        if (refResult.data?.reference_no) {
          referenceNo = refResult.data.reference_no;
          // Sync local counter with backend to keep them aligned
          syncReferenceCounter(referenceNo);
          console.log('✅ Using backend reference:', referenceNo);
        } else {
          throw new Error('No reference_no in response');
        }
      } catch (error) {
        console.error('Failed to get backend reference, falling back to offline:', error);
        // Fallback to offline if backend fails
        const offlineRef = generateOfflineReference();
        if (offlineRef) {
          referenceNo = offlineRef;
          console.log('⚠️ Using offline reference as fallback:', referenceNo);
        } else {
          toast.error('Failed to generate reference number.');
          return;
        }
      }
    } else {
      // OFFLINE: Use local counter
      const offlineRef = generateOfflineReference();
      if (offlineRef) {
        referenceNo = offlineRef;
        console.log('✅ Using offline-generated reference:', referenceNo);
      } else {
        toast.error('Cannot generate reference offline. Please connect to internet first or log in again.');
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

    // Reset form (keep session for consecutive entries)
    setFarmerId('');
    setFarmerName('');
    setRoute('');
    setSearchValue('');
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#667eea] to-[#764ba2]">
      {/* Header */}
      <header className="bg-white shadow-md sticky top-0 z-50">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-gray-100 rounded"
          >
            <Menu className="h-6 w-6 text-gray-700" />
          </button>
          <div className="flex flex-col items-center gap-1">
            <h1 className="text-xl font-bold text-[#667eea]">Milk Collection</h1>
            <DeviceAuthStatus />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/settings')}
              className="p-2 hover:bg-gray-100 rounded"
              aria-label="Settings"
            >
              <Settings className="h-5 w-5 text-gray-700" />
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <nav
        className={`fixed top-0 left-0 h-screen w-72 bg-white shadow-xl z-50 transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4">
          <button
            onClick={() => setSidebarOpen(false)}
            className="mb-4 hover:bg-gray-100 rounded p-2"
          >
            <X className="h-6 w-6 text-gray-700" />
          </button>
          <button
            onClick={() => scrollToSection('farmer-card')}
            className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            <User className="h-5 w-5 text-[#667eea]" />
            Farmer
          </button>
          <button
            onClick={() => scrollToSection('weight-card')}
            className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            <Scale className="h-5 w-5 text-[#667eea]" />
            Weight
          </button>
          <button
            onClick={() => scrollToSection('receipts-card')}
            className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            <FileText className="h-5 w-5 text-[#667eea]" />
            Receipts
          </button>
          <button
            onClick={handleTestPrint}
            className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            <Printer className="h-5 w-5 text-[#667eea]" />
            Test Print
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              navigate('/z-report');
            }}
            className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            <BarChart3 className="h-5 w-5 text-[#667eea]" />
            Z Report
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              navigate('/store');
            }}
            className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            <ShoppingBag className="h-5 w-5 text-[#667eea]" />
            Store
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              navigate('/periodic-report');
            }}
            className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            <FileBarChart className="h-5 w-5 text-[#667eea]" />
            Periodic Report
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              navigate('/settings');
            }}
            className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            <Settings className="h-5 w-5 text-[#667eea]" />
            Settings
          </button>
        </div>
      </nav>

      {/* Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* User Info */}
        <div className="bg-white rounded-lg p-3 text-center text-sm shadow">
          Logged in as {currentUser?.user_id} ({currentUser?.role})
          {isOffline && ' [Offline]'}
        </div>

        {/* Farmer Card */}
        <div id="farmer-card" className="bg-white rounded-xl p-6 shadow-lg scroll-mt-20">
          <h3 className="text-xl font-bold mb-4 text-[#667eea] flex items-center gap-2">
            <User className="h-6 w-6" />
            Farmer Details
          </h3>
          <FarmerSearch onSelectFarmer={handleSelectFarmer} value={searchValue} />
          <input
            type="text"
            placeholder="Farmer ID"
            value={farmerId}
            readOnly
            className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 mb-3"
          />
          <input
            type="text"
            placeholder="Farmer Name"
            value={farmerName}
            readOnly
            className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 mb-3"
          />
          <input
            type="text"
            placeholder="Route"
            value={route}
            readOnly
            className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 mb-3"
          />
          <select
            value={session}
            onChange={(e) => {
              const selectedSession = e.target.value;
              const currentHour = new Date().getHours();
              
              // Block PM selection during AM hours (before 12 PM)
              if (selectedSession === 'PM' && currentHour < 12) {
                toast.error('Cannot select PM session during AM hours');
                return;
              }
              
              // Block AM selection during PM hours (after 12 PM)
              if (selectedSession === 'AM' && currentHour >= 12) {
                toast.error('Cannot select AM session during PM hours');
                return;
              }
              
              setSession(selectedSession);
            }}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#667eea]"
          >
            <option value="">Select Session</option>
            <option value="AM">AM (Morning)</option>
            <option value="PM">PM (Evening)</option>
          </select>
        </div>

        {/* Weight Card */}
        <div id="weight-card" className="scroll-mt-20">
          <WeightInput
            weight={weight}
            onWeightChange={setWeight}
            onEntryTypeChange={setEntryType}
            currentUserRole={currentUser.role}
          />
          
          {/* Captured Collections Count */}
          {capturedCollections.length > 0 && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm font-semibold text-green-700">
                {capturedCollections.length} collection{capturedCollections.length !== 1 ? 's' : ''} captured for:
              </p>
              <p className="text-base font-bold text-green-800 mt-1">
                {capturedCollections[0].farmer_name} ({capturedCollections[0].farmer_id})
              </p>
            </div>
          )}

          <div className="flex gap-3 mt-4">
            <button
              onClick={handleSaveCollection}
              className="flex-1 py-3 bg-[#667eea] text-white rounded-lg font-semibold hover:bg-[#5568d3] transition-colors"
            >
              Capture
            </button>
            <button
              onClick={handlePrintAllCaptures}
              disabled={capturedCollections.length === 0}
              className="flex-1 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Printer className="h-5 w-5" />
              Print All
            </button>
          </div>
        </div>

        {/* Receipts Card */}
        <div id="receipts-card" className="scroll-mt-20">
          <ReceiptList refreshTrigger={refreshTrigger} />
        </div>
      </div>

      {/* Receipt Modal */}
        <ReceiptModal
          receipts={capturedCollections}
          open={receiptModalOpen}
          onClose={() => {
            setReceiptModalOpen(false);
            setCapturedCollections([]);
          }}
        />
    </div>
  );
};

export default Index;
