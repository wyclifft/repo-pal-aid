import { useState, useEffect } from 'react';
import { Login } from '@/components/Login';
import { FarmerSearch } from '@/components/FarmerSearch';
import { WeightInput } from '@/components/WeightInput';
import { ReceiptList } from '@/components/ReceiptList';
import { ReceiptModal } from '@/components/ReceiptModal';
import { type AppUser, type Farmer, type MilkCollection } from '@/lib/supabase';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { toast } from 'sonner';

const Index = () => {
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

  // No auto-login on page refresh - user must log in manually

  const handleLogin = (user: AppUser, offline: boolean) => {
    setCurrentUser(user);
    setIsOffline(offline);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setIsOffline(false);
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
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const monthKey = `${year}-${month}`; // YYYY-MM format
    const referenceNo = `MC-${monthKey}-${farmerId}-${session}`;

    // Get start and end of current month
    const monthStart = new Date(year, now.getMonth(), 1);
    const monthEnd = new Date(year, now.getMonth() + 1, 0, 23, 59, 59);

    // Try to sync online with monthly accumulation using MySQL API
    if (navigator.onLine) {
      try {
        // Check if record already exists for this farmer, session, and current month
        const existing = await mysqlApi.milkCollection.getByFarmerSessionDate(
          farmerId,
          session,
          monthStart.toISOString(),
          monthEnd.toISOString()
        ).catch(() => null);

        if (existing && existing.reference_no) {
          // Accumulate weight for the month
          const newWeight = parseFloat((Number(existing.weight) + Number(weight)).toFixed(2));
          const updated = await mysqlApi.milkCollection.update(existing.reference_no, {
            weight: newWeight,
            collection_date: new Date()
          });

          if (updated) {
            toast.success(`Monthly total: ${newWeight.toFixed(1)} Kg`);
            setCurrentReceipt({
              ...existing,
              weight: newWeight,
              collection_date: new Date(),
              synced: true,
            });
          } else {
            throw new Error('Failed to update MySQL record');
          }
        } else {
          // Create new record
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

          const created = await mysqlApi.milkCollection.create({
            ...milkData,
            session: session as 'AM' | 'PM'
          });
          if (created) {
            toast.success('Collection saved and synced to MySQL');
            setCurrentReceipt({ ...milkData, synced: true });
          } else {
            throw new Error('Failed to create MySQL record');
          }
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
            className="text-2xl p-1 hover:bg-gray-100 rounded"
          >
            ☰
          </button>
          <h1 className="text-xl font-bold text-[#667eea]">Milk Collection</h1>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-colors"
          >
            Logout
          </button>
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
            className="text-2xl mb-4 hover:bg-gray-100 rounded p-1"
          >
            ✕
          </button>
          <button
            onClick={() => scrollToSection('farmer-card')}
            className="block w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            👤 Farmer
          </button>
          <button
            onClick={() => scrollToSection('weight-card')}
            className="block w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            ⚖️ Weight
          </button>
          <button
            onClick={() => scrollToSection('receipts-card')}
            className="block w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            📋 Receipts
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              window.location.href = '/z-report';
            }}
            className="block w-full text-left px-4 py-3 rounded-lg hover:bg-gray-100 mb-2 text-lg"
          >
            📊 Z Report
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
            👤 Farmer Details
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
              
              // Block AM selection after 12 PM (noon)
              if (selectedSession === 'AM' && currentHour >= 12) {
                toast.error('Cannot select AM session after 12:00 PM');
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
