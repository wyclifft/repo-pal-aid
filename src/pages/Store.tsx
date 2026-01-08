import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { mysqlApi, type Item, type Sale, type Farmer } from '@/services/mysqlApi';
import { toast } from 'sonner';
import { ArrowLeft, Search, X, CornerDownLeft } from 'lucide-react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { API_CONFIG } from '@/config/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface CartItem {
  item: Item;
  quantity: number;
  lineTotal: number;
}

const Store = () => {
  const navigate = useNavigate();
  const { isAuthenticated, currentUser } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [hasRoutes, setHasRoutes] = useState<boolean | null>(null);
  const [storeEnabled, setStoreEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Member/Farmer state
  const [farmerId, setFarmerId] = useState('');
  const [selectedFarmer, setSelectedFarmer] = useState<Farmer | null>(null);
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [showFarmerSearch, setShowFarmerSearch] = useState(false);
  const [isMemberMode, setIsMemberMode] = useState(true);
  const farmerInputRef = useRef<HTMLInputElement>(null);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showItemSearch, setShowItemSearch] = useState(false);
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [filteredItems, setFilteredItems] = useState<Item[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Clerk info
  const clerkName = currentUser?.username || currentUser?.user_id || 'Unknown';

  const { getFarmers, saveSale, getUnsyncedSales, deleteSale, getItems, isReady } = useIndexedDB();

  // Check authentication
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!isReady) return;
    const timer = setTimeout(() => {
      checkRoutesAndLoadItems();
      loadFarmers();
      syncPendingSales();
    }, 100);
    return () => clearTimeout(timer);
  }, [isReady]);

  const checkRoutesAndLoadItems = async () => {
    try {
      setLoading(true);
      const deviceFingerprint = await generateDeviceFingerprint();
      
      if (navigator.onLine) {
        try {
          const apiUrl = API_CONFIG.MYSQL_API_URL;
          const response = await fetch(
            `${apiUrl}/api/routes/by-device/${encodeURIComponent(deviceFingerprint)}`,
            { signal: AbortSignal.timeout(5000) }
          );
          
          if (response.status === 404) {
            setHasRoutes(true);
            setStoreEnabled(true);
          } else if (response.ok) {
            const data = await response.json();
            const routes = data.data || [];
            const routesExist = data.success && routes.length > 0;
            setHasRoutes(routesExist);
            
            if (!routesExist) {
              setItems([]);
              setLoading(false);
              return;
            }
            
            const hasStoreEnabled = routes.some((route: { allowStore?: boolean }) => route.allowStore === true);
            setStoreEnabled(hasStoreEnabled);
            
            if (!hasStoreEnabled) {
              setItems([]);
              setLoading(false);
              return;
            }
          } else {
            setHasRoutes(true);
            setStoreEnabled(true);
          }
        } catch (err) {
          setHasRoutes(true);
          setStoreEnabled(true);
        }
      } else {
        setHasRoutes(true);
        setStoreEnabled(true);
      }
      
      await loadItems();
    } catch (error) {
      setHasRoutes(true);
      setStoreEnabled(true);
      setLoading(false);
    }
  };

  const loadFarmers = async () => {
    try {
      const localFarmers = await getFarmers();
      if (localFarmers.length > 0) {
        setFarmers(localFarmers);
      }
    } catch (error) {
      console.error('Failed to load farmers:', error);
    }
  };

  const loadItems = async () => {
    try {
      setLoading(true);
      const cachedItems = await getItems();
      if (cachedItems.length > 0) {
        setItems(cachedItems);
      }
      setLoading(false);
    } catch (error) {
      console.error('Failed to load items:', error);
      setLoading(false);
    }
  };

  const syncPendingSales = async () => {
    if (!navigator.onLine || !isReady) return;
    
    try {
      const pendingSales = await getUnsyncedSales();
      if (pendingSales.length === 0) return;
      
      for (const saleRecord of pendingSales) {
        try {
          const deviceFingerprint = await generateDeviceFingerprint();
          const cleanSale: Sale = {
            farmer_id: String(saleRecord.farmer_id || '').replace(/^#/, '').trim(),
            farmer_name: String(saleRecord.farmer_name || '').trim(),
            item_code: String(saleRecord.item_code || '').trim(),
            item_name: String(saleRecord.item_name || '').trim(),
            quantity: Number(saleRecord.quantity) || 0,
            price: Number(saleRecord.price) || 0,
            sold_by: String(saleRecord.sold_by || '').trim(),
            device_fingerprint: deviceFingerprint,
          };
          
          const success = await mysqlApi.sales.create(cleanSale);
          if (success && saleRecord.orderId) {
            await deleteSale(saleRecord.orderId);
          }
        } catch (error) {
          console.error('Sync error for sale:', error);
        }
      }
      toast.success('Offline sales synced');
    } catch (error) {
      console.error('Failed to sync sales:', error);
    }
  };

  // Resolve member ID to farmer
  const resolveFarmerId = useCallback((input: string): Farmer | null => {
    if (!input.trim()) return null;
    const numericInput = input.replace(/\D/g, '');
    
    const exactMatch = farmers.find(f => f.farmer_id.toLowerCase() === input.toLowerCase());
    if (exactMatch) return exactMatch;
    
    if (numericInput && numericInput === input.trim()) {
      const paddedId = `M${numericInput.padStart(5, '0')}`;
      const paddedMatch = farmers.find(f => f.farmer_id.toUpperCase() === paddedId.toUpperCase());
      if (paddedMatch) return paddedMatch;
      
      const numericMatch = farmers.find(f => {
        const farmerNumeric = f.farmer_id.replace(/\D/g, '');
        return parseInt(farmerNumeric, 10) === parseInt(numericInput, 10);
      });
      if (numericMatch) return numericMatch;
    }
    return null;
  }, [farmers]);

  // Handle Enter key on member input
  const handleMemberEnter = () => {
    if (!farmerId.trim()) return;
    const farmer = resolveFarmerId(farmerId);
    if (farmer) {
      setSelectedFarmer(farmer);
      setFarmerId(farmer.farmer_id);
      try { Haptics.impact({ style: ImpactStyle.Light }); } catch {}
    } else {
      toast.error('Member not found');
    }
  };

  // Clear member selection
  const handleMemberClear = () => {
    setFarmerId('');
    setSelectedFarmer(null);
    setCart([]);
    try { Haptics.impact({ style: ImpactStyle.Light }); } catch {}
  };

  // Filter items for search
  useEffect(() => {
    if (!itemSearchQuery.trim()) {
      setFilteredItems(items.slice(0, 50));
      return;
    }
    const query = itemSearchQuery.toLowerCase();
    const filtered = items.filter(item =>
      item.descript.toLowerCase().includes(query) ||
      item.icode.toLowerCase().includes(query)
    ).slice(0, 50);
    setFilteredItems(filtered);
  }, [itemSearchQuery, items]);

  // Add item to cart
  const handleAddItem = (item: Item) => {
    const existingIndex = cart.findIndex(c => c.item.icode === item.icode);
    if (existingIndex >= 0) {
      const updated = [...cart];
      updated[existingIndex].quantity += 1;
      updated[existingIndex].lineTotal = updated[existingIndex].quantity * item.sprice;
      setCart(updated);
    } else {
      setCart([...cart, { item, quantity: 1, lineTotal: item.sprice }]);
    }
    setShowItemSearch(false);
    setItemSearchQuery('');
    try { Haptics.impact({ style: ImpactStyle.Medium }); } catch {}
  };

  // Update item quantity
  const handleQuantityChange = (index: number, newQty: number) => {
    if (newQty <= 0) {
      setCart(cart.filter((_, i) => i !== index));
    } else {
      const updated = [...cart];
      updated[index].quantity = newQty;
      updated[index].lineTotal = newQty * updated[index].item.sprice;
      setCart(updated);
    }
  };

  // Calculate total
  const cartTotal = cart.reduce((sum, c) => sum + c.lineTotal, 0);

  // Submit sale
  const handleSubmit = async () => {
    if (!selectedFarmer) {
      toast.error('Please select a member first');
      return;
    }
    if (cart.length === 0) {
      toast.error('Please add items to cart');
      return;
    }

    setSubmitting(true);
    setSyncing(true);
    const deviceFingerprint = await generateDeviceFingerprint();

    try {
      for (const cartItem of cart) {
        const sale: Sale = {
          farmer_id: selectedFarmer.farmer_id,
          farmer_name: selectedFarmer.name,
          item_code: cartItem.item.icode,
          item_name: cartItem.item.descript,
          quantity: cartItem.quantity,
          price: cartItem.item.sprice,
          sold_by: currentUser?.user_id || 'Unknown',
          device_fingerprint: deviceFingerprint,
        };

        if (navigator.onLine) {
          await mysqlApi.sales.create(sale);
        } else {
          await saveSale(sale);
        }
      }

      toast.success(`Sale completed: KES${cartTotal.toFixed(0)}`);
      setCart([]);
      try { Haptics.impact({ style: ImpactStyle.Heavy }); } catch {}
    } catch (error) {
      console.error('Sale error:', error);
      toast.error('Failed to complete sale');
    } finally {
      setSubmitting(false);
      setSyncing(false);
    }
  };

  // Farmer search modal filtering
  const [farmerSearchQuery, setFarmerSearchQuery] = useState('');
  const filteredFarmers = farmerSearchQuery.trim()
    ? farmers.filter(f =>
        f.farmer_id.toLowerCase().includes(farmerSearchQuery.toLowerCase()) ||
        f.name.toLowerCase().includes(farmerSearchQuery.toLowerCase())
      ).slice(0, 50)
    : farmers.slice(0, 50);

  return (
    <div className="min-h-screen flex flex-col bg-[#26A69A]">
      {/* Purple Header */}
      <div className="bg-[#5E35B1] text-white px-4 py-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-1">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold">Store</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-[#26A69A] px-4 py-3">
        {/* Members Toggle */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-white font-medium text-lg">Members</span>
          <button
            onClick={() => setIsMemberMode(!isMemberMode)}
            className={`w-12 h-6 rounded-full transition-colors relative ${isMemberMode ? 'bg-gray-700' : 'bg-gray-400'}`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-gray-900 transition-transform ${isMemberMode ? 'right-0.5' : 'left-0.5'}`} />
          </button>
        </div>

        {/* Member Input Row */}
        <div className="flex gap-1.5 mb-3">
          <input
            ref={farmerInputRef}
            type="text"
            inputMode="text"
            placeholder="Enter Member No."
            value={farmerId}
            onChange={(e) => setFarmerId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleMemberEnter()}
            className="flex-1 px-4 py-3 bg-white border-2 border-gray-300 rounded-lg text-lg font-medium"
          />
          <button
            onClick={handleMemberEnter}
            className="w-12 bg-[#00695C] text-white rounded-lg flex items-center justify-center"
          >
            <CornerDownLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => setShowFarmerSearch(true)}
            className="w-12 bg-[#00695C] text-white rounded-lg flex items-center justify-center"
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            onClick={handleMemberClear}
            className="w-12 bg-[#E53935] text-white rounded-lg flex items-center justify-center"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Member Info Card */}
        <div className="bg-white rounded-lg p-3 mb-3 border-l-4 border-gray-400">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-sm font-bold text-gray-700">MEMBER</div>
              <div className="text-sm text-gray-600">
                {selectedFarmer ? (
                  <>
                    {selectedFarmer.name} [{selectedFarmer.route || 'T000'}] - MULTI OPT =
                    <br />
                    <span className="text-[#1565C0] underline">[1] -&gt;&gt;VIEW MORE&lt;&lt;</span>
                  </>
                ) : '-'}
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium">{selectedFarmer?.farmer_id || '-'}</div>
              <div className="text-sm text-gray-600">-KGS</div>
            </div>
          </div>
          <div className="mt-2 border-t pt-2">
            <div className="text-sm font-bold text-gray-700">CLERK</div>
            <div className="text-sm text-gray-600">{clerkName.toUpperCase()}</div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 mb-3">
          <button
            className="flex-1 py-3 bg-[#9E9E9E] text-white font-bold rounded-full opacity-60"
            disabled
          >
            REPRINT
          </button>
          <button
            onClick={() => {
              if (!selectedFarmer) {
                toast.error('Please select a member first');
                return;
              }
              setShowItemSearch(true);
            }}
            className="flex-1 py-3 bg-[#7E57C2] text-white font-bold rounded-full"
          >
            ADD ITEM
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || cart.length === 0}
            className="flex-1 py-3 bg-[#7E57C2] text-white font-bold rounded-full disabled:opacity-50"
          >
            {submitting ? 'SUBMITTING...' : 'SUBMIT'}
          </button>
        </div>

        {/* Cart Items */}
        <div className="bg-white rounded-lg overflow-hidden mb-3">
          {cart.length === 0 ? (
            <div className="text-center py-4 text-gray-500 font-medium">
              NO TRANSACTIONS ...
            </div>
          ) : (
            <div className="divide-y">
              {cart.map((cartItem, index) => (
                <div key={cartItem.item.icode} className="flex items-center px-3 py-2 gap-2">
                  <div className="w-8 h-8 border-2 border-gray-300 rounded flex items-center justify-center text-sm font-medium">
                    {index + 1}
                  </div>
                  <div className="flex-1 text-sm">
                    {cartItem.item.descript}[{cartItem.item.sprice}]
                  </div>
                  <input
                    type="number"
                    value={cartItem.quantity}
                    onChange={(e) => handleQuantityChange(index, parseFloat(e.target.value) || 0)}
                    className="w-14 text-center border rounded py-1 text-sm"
                    min="0"
                    step="0.1"
                  />
                  <div className="w-12 text-right font-medium text-sm">
                    {cartItem.lineTotal.toFixed(0)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Total */}
        <div className="bg-white rounded-lg px-4 py-3 flex justify-between items-center">
          <span className="font-bold text-lg">TOTAL</span>
          <span className="font-bold text-lg">KES{cartTotal.toFixed(0)}</span>
        </div>
      </div>

      {/* Bottom Decoration */}
      <div className="relative h-32 bg-[#26A69A] overflow-hidden">
        <div className="absolute -bottom-16 -right-16 w-48 h-48 rounded-full bg-[#4DD0C5] opacity-60" />
        <div className="absolute -bottom-8 right-16 w-32 h-32 rounded-full bg-[#80DEEA] opacity-40" />
      </div>

      {/* Farmer Search Modal */}
      <Dialog open={showFarmerSearch} onOpenChange={setShowFarmerSearch}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="px-4 py-3 border-b flex flex-row items-center justify-between">
            <DialogTitle>SEARCH MEMBER</DialogTitle>
            <button onClick={() => setShowFarmerSearch(false)} className="p-2 bg-[#E53935] text-white rounded">
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>
          <div className="p-4">
            <input
              type="text"
              placeholder="Search by ID or name..."
              value={farmerSearchQuery}
              onChange={(e) => setFarmerSearchQuery(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg mb-3"
              autoFocus
            />
            <div className="max-h-64 overflow-y-auto space-y-2">
              {filteredFarmers.map((farmer, i) => (
                <button
                  key={farmer.farmer_id}
                  onClick={() => {
                    setSelectedFarmer(farmer);
                    setFarmerId(farmer.farmer_id);
                    setShowFarmerSearch(false);
                    setFarmerSearchQuery('');
                  }}
                  className="w-full flex items-center gap-3 p-2 hover:bg-gray-100 rounded text-left"
                >
                  <div className="w-8 h-8 border-2 border-gray-300 rounded flex items-center justify-center text-sm">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">[{farmer.farmer_id}] - {farmer.name}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Item Search Modal */}
      <Dialog open={showItemSearch} onOpenChange={setShowItemSearch}>
        <DialogContent className="sm:max-w-md p-0">
          <DialogHeader className="px-4 py-3 border-b flex flex-row items-center justify-between">
            <DialogTitle>SEARCH ITEM</DialogTitle>
            <button onClick={() => setShowItemSearch(false)} className="p-2 bg-[#E53935] text-white rounded">
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>
          <div className="p-4">
            <input
              type="text"
              placeholder="Search by name or code..."
              value={itemSearchQuery}
              onChange={(e) => setItemSearchQuery(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg mb-3"
              autoFocus
            />
            <div className="max-h-64 overflow-y-auto space-y-2">
              {filteredItems.map((item, i) => (
                <button
                  key={item.ID}
                  onClick={() => handleAddItem(item)}
                  className="w-full flex items-center gap-3 p-2 hover:bg-gray-100 rounded text-left"
                >
                  <div className="w-8 h-8 border-2 border-gray-300 rounded flex items-center justify-center text-sm">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium">[{item.icode}] - {item.descript}</div>
                    <div className="text-xs text-gray-500">[qty:{item.stockbal}]</div>
                  </div>
                  <div className="font-medium">{item.sprice.toFixed(1)}</div>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Syncing Overlay */}
      {syncing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 text-center">
            <div className="animate-spin w-10 h-10 border-4 border-[#7E57C2] border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-semibold">Processing...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Store;
