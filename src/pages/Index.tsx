import { useState, useEffect } from 'react';
import { Login } from '@/components/Login';
import { FarmerSearch } from '@/components/FarmerSearch';
import { WeightInput } from '@/components/WeightInput';
import { ReceiptList } from '@/components/ReceiptList';
import { ReceiptModal } from '@/components/ReceiptModal';
import { supabase, type AppUser, type Farmer, type MilkCollection } from '@/lib/supabase';
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
  const [section, setSection] = useState('');
  const [searchValue, setSearchValue] = useState('');

  // Weight and price
  const [weight, setWeight] = useState(0);
  const [pricePerLiter, setPricePerLiter] = useState(50);

  // Receipt modal
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [currentReceipt, setCurrentReceipt] = useState<MilkCollection | null>(null);

  const { saveReceipt } = useIndexedDB();

  useEffect(() => {
    const savedUser = localStorage.getItem('loggedInUser');
    if (savedUser) {
      try {
        const user = JSON.parse(savedUser);
        setCurrentUser(user);
      } catch (err) {
        console.error('Error parsing saved user:', err);
      }
    }
  }, []);

  const handleLogin = (user: AppUser, offline: boolean) => {
    setCurrentUser(user);
    setIsOffline(offline);
    localStorage.setItem('loggedInUser', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setIsOffline(false);
    localStorage.removeItem('loggedInUser');
    toast.success('Logged out successfully');
  };

  const handleSelectFarmer = (farmer: Farmer) => {
    setFarmerId(farmer.farmer_id);
    setFarmerName(farmer.name);
    setRoute(farmer.route);
    setSearchValue(`${farmer.farmer_id} - ${farmer.name}`);
  };

  const handleSaveCollection = async () => {
    if (!farmerId || !route || !weight || !section) {
      toast.error('Enter farmer, route, section, and weight');
      return;
    }

    const orderId = Date.now();
    const total = weight * pricePerLiter;
    const referenceNo = `MC-${Date.now()}-${farmerId}`;

    const milkData: MilkCollection = {
      reference_no: referenceNo,
      farmer_id: farmerId,
      farmer_name: farmerName,
      route,
      section,
      weight: parseFloat(weight.toFixed(2)),
      collected_by: currentUser ? currentUser.user_id : null,
      clerk_name: currentUser ? currentUser.user_id : 'unknown',
      price_per_liter: parseFloat(pricePerLiter.toFixed(2)),
      total_amount: parseFloat(total.toFixed(2)),
      collection_date: new Date(),
      orderId,
      synced: false,
    };

    // Save to IndexedDB
    saveReceipt(milkData);

    // Try to sync online
    if (navigator.onLine) {
      try {
        const { error } = await supabase.from('milk_collection').insert([milkData]);
        if (!error) {
          saveReceipt({ ...milkData, synced: true });
          toast.success('Collection saved and synced');
        } else {
          toast.warning('Saved locally, will sync when online');
        }
      } catch (err) {
        console.error('Save error:', err);
        toast.warning('Saved locally, will sync when online');
      }
    } else {
      toast.warning('Saved locally, will sync when online');
    }

    // Show receipt
    setCurrentReceipt(milkData);
    setReceiptModalOpen(true);

    // Reset form
    setFarmerId('');
    setFarmerName('');
    setRoute('');
    setSection('');
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
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:border-[#667eea]"
          >
            <option value="">Select Section</option>
            <option value="AM">AM (Morning)</option>
            <option value="PM">PM (Evening)</option>
          </select>
        </div>

        {/* Weight Card */}
        <div id="weight-card" className="scroll-mt-20">
          <WeightInput
            weight={weight}
            onWeightChange={setWeight}
            pricePerLiter={pricePerLiter}
            onPriceChange={setPricePerLiter}
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
          <ReceiptList />
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
