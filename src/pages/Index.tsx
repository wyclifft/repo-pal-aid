import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Login } from '@/components/Login';
import { FarmerSearch } from '@/components/FarmerSearch';
import { WeightInput } from '@/components/WeightInput';
import { ReceiptList } from '@/components/ReceiptList';
import { ReceiptModal } from '@/components/ReceiptModal';
import { DeviceAuthStatus } from '@/components/DeviceAuthStatus';
import { type AppUser, type Farmer, type MilkCollection } from '@/lib/supabase';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { generateOfflineReference, syncReferenceCounter } from '@/utils/referenceGenerator';
import { toast } from 'sonner';
import { Menu, X, User, Scale, FileText, BarChart3, Printer, ShoppingBag, FileBarChart, Settings } from 'lucide-react';

const Index = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Farmer details
  const [farmerId, setFarmerId] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [route, setRoute] = useState('');
  const [session, setSession] = useState('');
  const [searchValue, setSearchValue] = useState('');

  // Weight
  const [weight, setWeight] = useState(0);

  // Receipt modal
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [currentReceipt, setCurrentReceipt] = useState<MilkCollection | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const { saveReceipt } = useIndexedDB();

  // Restore auth state from localStorage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('currentUser');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        setCurrentUser(user);
        setIsOffline(!navigator.onLine);
      } catch (error) {
        console.error('Failed to restore user session:', error);
        localStorage.removeItem('currentUser');
      }
    }
  }, []);

  const handleLogin = (user: AppUser, offline: boolean) => {
    setCurrentUser(user);
    setIsOffline(offline);
    // Store user in localStorage for other pages to access
    localStorage.setItem('currentUser', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setIsOffline(false);
    // Clear user from localStorage
    localStorage.removeItem('currentUser');
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

    const now = new Date();
    const year = now.getFullYear();

    // Get device fingerprint
    const deviceFingerprint = await generateDeviceFingerprint();

    // Generate reference number - OFFLINE FIRST approach
    let referenceNo = '';
    
    // Try offline generation first
    const offlineRef = generateOfflineReference();
    if (offlineRef) {
      referenceNo = offlineRef;
      console.log('✅ Using offline-generated reference:', referenceNo);
      
      // If online, sync with backend to ensure we're in sync
      if (navigator.onLine) {
        try {
          const refResult = await mysqlApi.milkCollection.getNextReference(deviceFingerprint);
          if (refResult.data?.reference_no) {
            syncReferenceCounter(refResult.data.reference_no);
            console.log('📡 Synced reference counter with backend');
          }
        } catch (error) {
          console.warn('Failed to sync with backend (continuing with offline reference):', error);
        }
      }
    } else {
      // No offline config available - must be online to get reference from backend
      if (!navigator.onLine) {
        toast.error('Cannot generate reference offline. Please connect to internet first or log in again.');
        return;
      }
      
      try {
        console.log('Fetching reference from backend...');
        const refResult = await mysqlApi.milkCollection.getNextReference(deviceFingerprint);
        if (refResult.data?.reference_no) {
          referenceNo = refResult.data.reference_no;
          syncReferenceCounter(referenceNo);
          console.log('✅ Using backend reference:', referenceNo);
        } else {
          throw new Error('No reference_no in response');
        }
      } catch (error) {
        console.error('Failed to generate reference number:', error);
        toast.error('Failed to generate reference number. Please check your connection.');
        return;
      }
    }

    // Get start and end of current month
    const monthStart = new Date(year, now.getMonth(), 1);
    const monthEnd = new Date(year, now.getMonth() + 1, 0, 23, 59, 59);

    // Save online - always create new record
    if (navigator.onLine) {
      try {
        const milkData: any = {
          reference_no: referenceNo,
          farmer_id: farmerId,
          farmer_name: farmerName,
          route: route,
          session: session as 'AM' | 'PM',
          weight: parseFloat(Number(weight).toFixed(2)),
          clerk_name: currentUser ? currentUser.user_id : 'unknown',
          collection_date: new Date(),
          device_fingerprint: deviceFingerprint,
          orderId: Date.now(),
          synced: false,
        };

        const created = await mysqlApi.milkCollection.create(milkData);
        if (created) {
          toast.success('Collection saved and synced');
          setCurrentReceipt({ ...milkData, synced: true });
        } else {
          throw new Error('Failed to create record');
        }
      } catch (err) {
        console.error('Save error:', err);
        // Save locally on error
        const milkData: MilkCollection = {
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
        setCurrentReceipt(milkData);
        toast.warning('Saved locally, will sync when online');
      }
    } else {
      // Offline mode - save locally
      const milkData: MilkCollection = {
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
      setCurrentReceipt(milkData);
      toast.warning('Saved locally, will sync when online');
    }

    // Show receipt
    setReceiptModalOpen(true);
    
    // Trigger refresh of receipt list
    setRefreshTrigger(prev => prev + 1);

    // Reset form
    setFarmerId('');
    setFarmerName('');
    setRoute('');
    setSession('');
    setSearchValue('');
    setWeight(0);
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

  if (!currentUser) {
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
              onClick={() => window.location.href = '/settings'}
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
              window.location.href = '/z-report';
            }}
            className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            <BarChart3 className="h-5 w-5 text-[#667eea]" />
            Z Report
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              window.location.href = '/store';
            }}
            className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            <ShoppingBag className="h-5 w-5 text-[#667eea]" />
            Store
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              window.location.href = '/periodic-report';
            }}
            className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            <FileBarChart className="h-5 w-5 text-[#667eea]" />
            Periodic Report
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              window.location.href = '/settings';
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
          Logged in as {currentUser.user_id} ({currentUser.role})
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
            currentUserRole={currentUser.role}
          />
          <button
            onClick={handleSaveCollection}
            className="w-full mt-4 py-3 bg-[#667eea] text-white rounded-lg font-semibold hover:bg-[#5568d3] transition-colors"
          >
            Save Collection
          </button>
        </div>

        {/* Receipts Card */}
        <div id="receipts-card" className="scroll-mt-20">
          <ReceiptList refreshTrigger={refreshTrigger} />
        </div>
      </div>

      {/* Receipt Modal */}
      <ReceiptModal
        receipt={currentReceipt}
        open={receiptModalOpen}
        onClose={() => setReceiptModalOpen(false)}
      />
    </div>
  );
};

export default Index;
