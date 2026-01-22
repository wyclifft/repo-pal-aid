import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { mysqlApi, type Item, type Farmer, type CreditType } from '@/services/mysqlApi';
import { toast } from 'sonner';
import { ArrowLeft, Search, X, CornerDownLeft, Wifi, WifiOff, Beef } from 'lucide-react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useSalesSync } from '@/hooks/useSalesSync';
import { useFarmerResolution } from '@/hooks/useFarmerResolution';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { API_CONFIG } from '@/config/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { CowDetailsModal, type CowDetails } from '@/components/CowDetailsModal';
import { generateReferenceWithUploadRef } from '@/utils/referenceGenerator';
import { TransactionReceipt, createAIReceiptData, type ReceiptData } from '@/components/TransactionReceipt';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { useReprint } from '@/contexts/ReprintContext';
import type { ReprintItem } from '@/components/ReprintModal';

interface CartItem {
  item: Item;
  quantity: number;
  lineTotal: number;
  cowDetails?: CowDetails; // Cow details for AI items
}

interface ParsedCredit {
  code: string;
  amount: number;
  description: string;
}

const AIPage = () => {
  const navigate = useNavigate();
  const { isAuthenticated, currentUser } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [hasRoutes, setHasRoutes] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // Member/Farmer state
  const [farmerId, setFarmerId] = useState('');
  const [selectedFarmer, setSelectedFarmer] = useState<Farmer | null>(null);
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [showFarmerSearch, setShowFarmerSearch] = useState(false);
  const [isMemberMode, setIsMemberMode] = useState(true); // true = Members (M prefix), false = Debtors (D prefix)
  const [showViewMore, setShowViewMore] = useState(false);
  const farmerInputRef = useRef<HTMLInputElement>(null);
  
  // Credit types lookup
  const [creditTypes, setCreditTypes] = useState<CreditType[]>([]);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showItemSearch, setShowItemSearch] = useState(false);
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [filteredItems, setFilteredItems] = useState<Item[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Cow details modal state - triggered ONLY after item is added
  const [showCowDetailsModal, setShowCowDetailsModal] = useState(false);
  const [pendingItem, setPendingItem] = useState<Item | null>(null);

  // Receipt modal state
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  // Clerk info - user_id for tracking, clerkName for display
  const userId = currentUser?.user_id || 'unknown';
  const clerkName = currentUser?.username || currentUser?.user_id || 'Unknown';

  const { getFarmers, getItems, isReady } = useIndexedDB();
  const { saveOfflineSale, syncPendingSales } = useSalesSync();
  const { addAIReceipt } = useReprint();
  
  // Online status tracking
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Check authentication
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Track online status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync pending AI transactions when back online
      syncPendingSales();
    };
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncPendingSales]);

  useEffect(() => {
    if (!isReady) return;
    const timer = setTimeout(() => {
      checkRoutesAndLoadItems();
      loadFarmers();
      loadCreditTypes();
      // Sync any pending AI transactions on load
      if (navigator.onLine) {
        syncPendingSales();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [isReady]);

  // Load credit types from API for description lookup
  const loadCreditTypes = async () => {
    try {
      if (navigator.onLine) {
        const apiUrl = API_CONFIG.MYSQL_API_URL;
        const response = await fetch(`${apiUrl}/api/credits`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          const data = await response.json();
          if (data.success && Array.isArray(data.data)) {
            setCreditTypes(data.data);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load credit types:', error);
    }
  };

  // Parse crbal string into structured entries with descriptions
  const parsedCredits = useMemo<ParsedCredit[]>(() => {
    if (!selectedFarmer?.crbal || typeof selectedFarmer.crbal !== 'string' || !selectedFarmer.crbal.trim()) {
      return [];
    }
    
    const entries = selectedFarmer.crbal.split(',').filter(Boolean);
    const memberCcode = selectedFarmer.ccode || '';
    
    return entries
      .map(entry => {
        const [code, amountStr] = entry.trim().split('#');
        const amount = parseFloat(amountStr) || 0;
        const creditType = creditTypes.find(ct => ct.crcode?.trim() === code?.trim());
        return {
          code: code?.trim() || '',
          amount,
          description: creditType?.descript || ''
        };
      })
      .filter(credit => {
        if (!memberCcode) return true;
        return credit.code === memberCcode || creditTypes.some(ct => ct.crcode === credit.code);
      });
  }, [selectedFarmer?.crbal, selectedFarmer?.ccode, creditTypes]);

  // Calculate total credit balance from parsed entries
  const totalCreditBalance = useMemo(() => {
    return parsedCredits.reduce((sum, credit) => sum + credit.amount, 0);
  }, [parsedCredits]);

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
          } else {
            setHasRoutes(true);
          }
        } catch (err) {
          setHasRoutes(true);
        }
      } else {
        setHasRoutes(true);
      }
      
      await loadItems();
    } catch (error) {
      setHasRoutes(true);
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
      // First try to load from cache
      const cachedItems = await getItems();
      // Filter cached items to only show AI items (invtype = '06')
      const cachedAIItems = cachedItems.filter((item: Item & { invtype?: string }) => 
        item.invtype === '06'
      );
      if (cachedAIItems.length > 0) {
        setItems(cachedAIItems);
      }
      
      // If online, fetch fresh AI items from backend with invtype filter
      if (navigator.onLine) {
        const deviceFingerprint = await generateDeviceFingerprint();
        const response = await mysqlApi.items.getAll(deviceFingerprint, '06');
        if (response.success && response.data && response.data.length > 0) {
          setItems(response.data);
        }
      }
      setLoading(false);
    } catch (error) {
      console.error('Failed to load items:', error);
      setLoading(false);
    }
  };

  // Use shared farmer resolution hook
  const { resolveFarmerId, resolveAndSelect } = useFarmerResolution({
    farmers,
    isMemberMode,
  });

  // Handle Enter key on member input
  const handleMemberEnter = () => {
    if (!farmerId.trim()) return;
    resolveAndSelect(farmerId, (farmer) => {
      setSelectedFarmer(farmer);
      setFarmerId(farmer.farmer_id);
    });
  };

  // Clear member selection
  const handleMemberClear = () => {
    setFarmerId('');
    setSelectedFarmer(null);
    setCart([]);
    try { Haptics.impact({ style: ImpactStyle.Light }); } catch { }
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

  // Handle item selection from search - this triggers cow details popup
  const handleSelectItem = (item: Item) => {
    // Close item search dialog
    setShowItemSearch(false);
    setItemSearchQuery('');
    
    // Store pending item and show cow details modal
    setPendingItem(item);
    setShowCowDetailsModal(true);
    
    try { Haptics.impact({ style: ImpactStyle.Medium }); } catch { }
  };

  // Handle saving cow details - adds item to cart with details
  const handleSaveCowDetails = (details: CowDetails) => {
    if (!pendingItem) return;
    
    const existingIndex = cart.findIndex(c => c.item.icode === pendingItem.icode);
    if (existingIndex >= 0) {
      // Update existing item with new cow details (each entry is separate)
      const updated = [...cart];
      updated[existingIndex].quantity += 1;
      updated[existingIndex].lineTotal = updated[existingIndex].quantity * pendingItem.sprice;
      // Keep only the latest cow details (or could create separate entries)
      updated[existingIndex].cowDetails = details;
      setCart(updated);
    } else {
      // Add new item with cow details
      setCart([...cart, { 
        item: pendingItem, 
        quantity: 1, 
        lineTotal: pendingItem.sprice,
        cowDetails: details 
      }]);
    }
    
    // Clear pending item and close modal
    setPendingItem(null);
    setShowCowDetailsModal(false);
    
    toast.success(`Added ${pendingItem.descript} with cow details`);
    try { Haptics.impact({ style: ImpactStyle.Medium }); } catch { }
  };

  // Handle closing cow details modal without saving
  const handleCloseCowDetails = () => {
    setPendingItem(null);
    setShowCowDetailsModal(false);
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

  // Submit AI transaction
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
    const deviceFingerprint = await generateDeviceFingerprint();

    try {
      // Generate AI transaction reference (transtype = 3 for AI)
      const refs = await generateReferenceWithUploadRef('ai');
      if (!refs) {
        toast.error('Failed to generate reference number');
        setSubmitting(false);
        return;
      }

      // Build AI transaction data
      for (const cartItem of cart) {
        const aiTransaction = {
          transrefno: refs.transrefno,
          uploadrefno: refs.uploadrefno,
          transtype: 3, // AI transaction type
          farmer_id: selectedFarmer.farmer_id,
          farmer_name: selectedFarmer.name,
          item_code: cartItem.item.icode,
          item_name: cartItem.item.descript,
          quantity: cartItem.quantity,
          price: cartItem.item.sprice,
          user_id: userId, // Login user_id for DB userId column
          sold_by: clerkName, // Display name for DB clerk column
          device_fingerprint: deviceFingerprint,
          // Cow details for AI
          cow_name: cartItem.cowDetails?.cowName || '',
          cow_breed: cartItem.cowDetails?.cowBreed || '',
          number_of_calves: cartItem.cowDetails?.numberOfCalves || '',
          other_details: cartItem.cowDetails?.otherDetails || '',
        };

        if (navigator.onLine) {
          // Submit to sales endpoint with transtype=3 for AI
          await mysqlApi.sales.create(aiTransaction);
        } else {
          // Save offline for later sync
          await saveOfflineSale(aiTransaction);
          console.log(`💾 AI transaction saved offline: ${refs.transrefno}`);
        }
      }

      // Create receipt data using unified helper
      const companyName = localStorage.getItem('device_company_name') || 'DAIRY COLLECTION';
      const receipt = createAIReceiptData(
        cart,
        { id: selectedFarmer.farmer_id, name: selectedFarmer.name, route: selectedFarmer.route },
        { transrefno: refs.transrefno, uploadrefno: refs.uploadrefno, clerkName: clerkName },
        companyName
      );
      setReceiptData(receipt);
      setShowReceipt(true);

      // Save receipt for reprinting with full item details including cow details
      const reprintItems: ReprintItem[] = cart.map(c => ({
        item_code: c.item.icode,
        item_name: c.item.descript,
        quantity: c.quantity,
        price: c.item.sprice,
        lineTotal: c.lineTotal,
        cowDetails: c.cowDetails,
      }));

      await addAIReceipt({
        farmerId: selectedFarmer.farmer_id,
        farmerName: selectedFarmer.name,
        memberRoute: selectedFarmer.route,
        clerkName: clerkName,
        uploadrefno: refs.uploadrefno,
        items: reprintItems,
        totalAmount: cartTotal,
        transactionDate: new Date(),
      });

      const statusMsg = navigator.onLine ? '' : ' (saved offline)';
      toast.success(`AI Service completed${statusMsg}: KES${cartTotal.toFixed(0)} [${refs.transrefno}]`);
      setCart([]);
      try { Haptics.impact({ style: ImpactStyle.Heavy }); } catch { }
    } catch (error) {
      console.error('AI transaction error:', error);
      toast.error('Failed to complete AI transaction');
    } finally {
      setSubmitting(false);
    }
  };

  // Farmer search modal filtering
  const [farmerSearchQuery, setFarmerSearchQuery] = useState('');
  const prefix = isMemberMode ? 'M' : 'D';
  const prefixFilteredFarmers = farmers.filter(f => {
    const matchesPrefix = f.farmer_id.toUpperCase().startsWith(prefix);
    if (!isMemberMode) {
      const hasCrbal = f.crbal && typeof f.crbal === 'string' && f.crbal.trim() !== '' && f.crbal !== '0';
      return matchesPrefix && hasCrbal;
    }
    return matchesPrefix;
  });
  const filteredFarmers = farmerSearchQuery.trim()
    ? prefixFilteredFarmers.filter(f =>
        f.farmer_id.toLowerCase().includes(farmerSearchQuery.toLowerCase()) ||
        f.name.toLowerCase().includes(farmerSearchQuery.toLowerCase())
      ).slice(0, 50)
    : prefixFilteredFarmers.slice(0, 50);

  return (
    <div className="min-h-screen flex flex-col bg-[#26A69A]">
      {/* Purple Header with online status */}
      <div className="bg-[#5E35B1] text-white px-4 py-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="p-1">
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="text-xl font-bold flex-1">AI Services</h1>
          {/* Online/Offline indicator */}
          <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${isOnline ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
            {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            <span>{isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 space-y-4 overflow-auto" style={{ paddingBottom: 'max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))' }}>
        {/* Member/Debtor Toggle */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-white font-medium text-lg">{isMemberMode ? 'Members' : 'Debtors'}</span>
          <button
            onClick={() => {
              setIsMemberMode(!isMemberMode);
              setSelectedFarmer(null);
              setFarmerId('');
            }}
            className={`w-12 h-6 rounded-full transition-colors relative ${isMemberMode ? 'bg-gray-700' : 'bg-orange-500'}`}
          >
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${isMemberMode ? 'right-0.5' : 'left-0.5'}`} />
          </button>
        </div>

        {/* Member Input Row */}
        <div className="flex gap-2">
          <input
            ref={farmerInputRef}
            type="text"
            value={farmerId}
            onChange={(e) => setFarmerId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleMemberEnter()}
            placeholder="Enter member no."
            className="flex-1 px-4 py-3 border-2 border-gray-800 rounded-lg bg-white font-semibold"
          />
          <button
            onClick={handleMemberEnter}
            className="w-12 bg-[#4DD0E1] text-white rounded-lg flex items-center justify-center"
          >
            <CornerDownLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => setShowFarmerSearch(true)}
            className="w-12 bg-[#4DD0E1] text-white rounded-lg flex items-center justify-center"
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
        <div className="bg-white rounded-lg p-4 shadow">
          <div className="flex justify-between items-start border-b pb-2 mb-2">
            <div>
              <span className="text-gray-500 text-sm font-semibold">MEMBER</span>
              <p className="font-bold">{selectedFarmer?.name || '-'}</p>
              {selectedFarmer && (
                <p className="text-sm text-gray-600">
                  [{selectedFarmer.route || 'No Route'}] - MULTI OPT = [{selectedFarmer.multOpt ?? 1}]
                </p>
              )}
              {selectedFarmer && (
                <button 
                  onClick={() => setShowViewMore(true)}
                  className="text-cyan-500 text-sm hover:underline"
                >
                  VIEW MORE
                </button>
              )}
            </div>
            <span className="font-bold text-lg">{selectedFarmer?.farmer_id || '-'}</span>
          </div>
          
          <div className="border-b pb-2 mb-2">
            <span className="font-bold">CLERK</span>
            <p className="text-gray-600">{clerkName}</p>
          </div>

          {/* Credit Balance if in Debtor mode */}
          {!isMemberMode && totalCreditBalance > 0 && (
            <div className="border-b pb-2 mb-2">
              <span className="font-bold text-red-600">CREDIT BALANCE</span>
              <p className="text-red-600 font-bold">KES {totalCreditBalance.toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => {/* Reprint logic */}}
            className="flex-1 py-3 bg-[#5E35B1] text-white rounded-full font-semibold"
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
            className="flex-1 py-3 bg-[#5E35B1] text-white rounded-full font-semibold"
          >
            ADD ITEM
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || cart.length === 0}
            className={`flex-1 py-3 bg-[#5E35B1] text-white rounded-full font-semibold ${
              (submitting || cart.length === 0) ? 'opacity-50' : ''
            }`}
          >
            {submitting ? 'SUBMITTING...' : 'SUBMIT'}
          </button>
        </div>

        {/* Transactions/Cart List */}
        <div className="bg-white rounded-lg overflow-hidden shadow">
          {cart.length === 0 ? (
            <div className="p-4 text-center text-gray-500">NO TRANSACTIONS ...</div>
          ) : (
            <div className="divide-y">
              {cart.map((cartItem, idx) => (
                <div key={idx} className="p-3 flex justify-between items-center">
                  <div>
                    <p className="font-semibold">{cartItem.item.descript}</p>
                    <p className="text-sm text-gray-500">
                      Qty: {cartItem.quantity} × KES{cartItem.item.sprice}
                    </p>
                    {cartItem.cowDetails?.cowName && (
                      <p className="text-xs text-purple-600 flex items-center gap-1">
                        <Beef className="h-3 w-3" />
                        {cartItem.cowDetails.cowName} ({cartItem.cowDetails.cowBreed || 'Unknown breed'})
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-bold">KES{cartItem.lineTotal.toFixed(0)}</p>
                    <button
                      onClick={() => handleQuantityChange(idx, 0)}
                      className="text-red-500 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Total */}
        <div className="bg-white rounded-lg p-4 shadow">
          <div className="flex justify-between items-center">
            <span className="font-bold text-lg">TOTAL</span>
            <span className="font-bold text-lg">KES {cartTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Farmer Search Dialog */}
      <Dialog open={showFarmerSearch} onOpenChange={setShowFarmerSearch}>
        <DialogContent className="sm:max-w-md mx-4 max-h-[80vh] flex flex-col" hideCloseButton>
          <DialogHeader className="flex flex-row items-center gap-2 pb-2">
            <DialogTitle>Search {isMemberMode ? 'Member' : 'Debtor'}</DialogTitle>
            <DialogDescription className="sr-only">
              Search and select a {isMemberMode ? 'member' : 'debtor'} for this AI service transaction
            </DialogDescription>
            <button onClick={() => setShowFarmerSearch(false)} className="ml-auto p-2 bg-[#E53935] text-white rounded">
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search by ID or name..."
              value={farmerSearchQuery}
              onChange={(e) => setFarmerSearchQuery(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="flex-1 overflow-y-auto divide-y max-h-[50vh]">
            {filteredFarmers.map((f) => (
              <button
                key={f.farmer_id}
                onClick={() => {
                  setSelectedFarmer(f);
                  setFarmerId(f.farmer_id);
                  setShowFarmerSearch(false);
                  setFarmerSearchQuery('');
                }}
                className="w-full text-left p-3 hover:bg-gray-50"
              >
                <p className="font-semibold">{f.farmer_id}</p>
                <p className="text-sm text-gray-600">{f.name}</p>
              </button>
            ))}
            {filteredFarmers.length === 0 && (
              <p className="p-4 text-center text-gray-500">No {isMemberMode ? 'members' : 'debtors'} found</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Item Search Dialog */}
      <Dialog open={showItemSearch} onOpenChange={setShowItemSearch}>
        <DialogContent className="sm:max-w-md mx-4 max-h-[80vh] flex flex-col" hideCloseButton>
          <DialogHeader className="flex flex-row items-center gap-2 pb-2">
            <DialogTitle>Select AI Service</DialogTitle>
            <DialogDescription className="sr-only">
              Choose an AI service to add to this transaction
            </DialogDescription>
            <button onClick={() => setShowItemSearch(false)} className="ml-auto p-2 bg-[#E53935] text-white rounded">
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>
          <div className="p-4">
            <input
              type="text"
              placeholder="Search AI services..."
              value={itemSearchQuery}
              onChange={(e) => setItemSearchQuery(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg mb-4"
            />
            <div className="max-h-[40vh] overflow-y-auto divide-y">
              {loading ? (
                <p className="p-4 text-center text-gray-500">Loading...</p>
              ) : filteredItems.length === 0 ? (
                <p className="p-4 text-center text-gray-500">No AI services found</p>
              ) : (
                filteredItems.map((item) => (
                  <button
                    key={item.icode}
                    onClick={() => handleSelectItem(item)}
                    className="w-full text-left p-3 hover:bg-purple-50 transition-colors"
                  >
                    <p className="font-semibold text-[#5E35B1]">{item.descript}</p>
                    <p className="text-sm text-gray-500">
                      {item.icode} - KES {item.sprice}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cow Details Modal - Only appears AFTER item is selected */}
      <CowDetailsModal
        isOpen={showCowDetailsModal}
        onClose={handleCloseCowDetails}
        onSave={handleSaveCowDetails}
        itemName={pendingItem?.descript}
      />

      {/* View More Dialog */}
      <Dialog open={showViewMore} onOpenChange={setShowViewMore}>
        <DialogContent className="sm:max-w-md mx-4">
          <DialogHeader>
            <DialogTitle>Member Details</DialogTitle>
            <DialogDescription className="sr-only">
              View detailed information about the selected member
            </DialogDescription>
          </DialogHeader>
          {selectedFarmer && (
            <div className="space-y-2">
              <p><strong>ID:</strong> {selectedFarmer.farmer_id}</p>
              <p><strong>Name:</strong> {selectedFarmer.name}</p>
              <p><strong>Route:</strong> {selectedFarmer.route || 'N/A'}</p>
              <p><strong>Multi Opt:</strong> {selectedFarmer.multOpt ?? 1}</p>
              {parsedCredits.length > 0 && (
                <div>
                  <strong>Credits:</strong>
                  <ul className="list-disc ml-5">
                    {parsedCredits.map((credit, idx) => (
                      <li key={idx}>
                        {credit.code}: KES {credit.amount.toLocaleString()} {credit.description && `(${credit.description})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Unified Transaction Receipt Modal */}
      <TransactionReceipt
        data={receiptData}
        open={showReceipt}
        onClose={() => setShowReceipt(false)}
        onPrint={() => setShowReceipt(false)}
      />
    </div>
  );
};

export default AIPage;
