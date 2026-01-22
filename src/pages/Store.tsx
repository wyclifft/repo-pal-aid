import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { mysqlApi, type Item, type Sale, type Farmer, type CreditType, type BatchSaleRequest } from '@/services/mysqlApi';
import { toast } from 'sonner';
import { ArrowLeft, Search, X, CornerDownLeft, Camera, Scale, Wifi, WifiOff, Image } from 'lucide-react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useSalesSync } from '@/hooks/useSalesSync';
import { useFarmerResolution } from '@/hooks/useFarmerResolution';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { API_CONFIG } from '@/config/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import PhotoCapture from '@/components/PhotoCapture';
import { useScaleConnection } from '@/hooks/useScaleConnection';
import { generateReferenceWithUploadRef, generateTransRefOnly } from '@/utils/referenceGenerator';
import { TransactionReceipt, createStoreReceiptData, type ReceiptData } from '@/components/TransactionReceipt';
import PhotoAuditViewer from '@/components/PhotoAuditViewer';
import { useReprint } from '@/contexts/ReprintContext';
import type { ReprintItem } from '@/components/ReprintModal';

interface CartItem {
  item: Item;
  quantity: number;
  lineTotal: number;
}

interface ParsedCredit {
  code: string;
  amount: number;
  description: string;
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

  // Photo capture state for theft prevention
  const [showPhotoCapture, setShowPhotoCapture] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<{ blob: Blob; preview: string } | null>(null);

  // Receipt modal state
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

  // Photo audit viewer state
  const [showPhotoAudit, setShowPhotoAudit] = useState(false);

  // Scale weight state
  const [weight, setWeight] = useState(0);
  const [entryType, setEntryType] = useState<'scale' | 'manual'>('manual');
  
  // Scale connection hook
  const {
    scaleConnected,
    liveWeight,
    autoReconnect,
  } = useScaleConnection({ 
    onWeightChange: setWeight, 
    onEntryTypeChange: setEntryType 
  });

  // Auto-reconnect scale on mount
  useEffect(() => {
    autoReconnect();
  }, []);

  // Clerk info
  const clerkName = currentUser?.username || currentUser?.user_id || 'Unknown';

  const { getFarmers, saveSale, getUnsyncedSales, deleteSale, getItems, isReady } = useIndexedDB();
  const { addStoreReceipt } = useReprint();

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
      loadCreditTypes();
      syncPendingSales();
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

  // Parse crbal string (e.g. "CR02#11200,CR22#340") into structured entries with descriptions
  // Only show credits matching the member's ccode
  const parsedCredits = useMemo<ParsedCredit[]>(() => {
    if (!selectedFarmer?.crbal || typeof selectedFarmer.crbal !== 'string' || !selectedFarmer.crbal.trim()) {
      return [];
    }
    
    // Split by comma for multiple entries
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
      // Filter to only show credits matching member's ccode (if ccode exists)
      .filter(credit => {
        if (!memberCcode) return true; // Show all if no ccode
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
      // First try to load from cache
      const cachedItems = await getItems();
      // Filter cached items to only show store items (invtype = '05')
      const cachedStoreItems = cachedItems.filter((item: Item & { invtype?: string }) => 
        item.invtype === '05'
      );
      if (cachedStoreItems.length > 0) {
        setItems(cachedStoreItems);
      }
      
      // If online, fetch fresh store items from backend with invtype filter
      if (navigator.onLine) {
        const deviceFingerprint = await generateDeviceFingerprint();
        const response = await mysqlApi.items.getAll(deviceFingerprint, '05');
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

  // Resolve member ID to farmer based on mode (M or D prefix)
  const resolveFarmerId = useCallback((input: string): Farmer | null => {
    if (!input.trim()) return null;
    const numericInput = input.replace(/\D/g, '');
    const prefix = isMemberMode ? 'M' : 'D';
    
    const exactMatch = farmers.find(f => f.farmer_id.toLowerCase() === input.toLowerCase());
    if (exactMatch) return exactMatch;
    
    if (numericInput && numericInput === input.trim()) {
      const paddedId = `${prefix}${numericInput.padStart(5, '0')}`;
      const paddedMatch = farmers.find(f => f.farmer_id.toUpperCase() === paddedId.toUpperCase());
      if (paddedMatch) return paddedMatch;
      
      const numericMatch = farmers.find(f => {
        const farmerNumeric = f.farmer_id.replace(/\D/g, '');
        return parseInt(farmerNumeric, 10) === parseInt(numericInput, 10);
      });
      if (numericMatch) return numericMatch;
    }
    return null;
  }, [farmers, isMemberMode]);

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

  // Handle photo capture
  const handlePhotoCaptured = (blob: Blob, preview: string) => {
    setCapturedPhoto({ blob, preview });
    toast.success('Photo captured');
  };

  // Convert blob to base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Initiate sale - requires photo first
  const handleInitiateSale = () => {
    if (!selectedFarmer) {
      toast.error('Please select a member first');
      return;
    }
    if (cart.length === 0) {
      toast.error('Please add items to cart');
      return;
    }
    // Open photo capture dialog
    setShowPhotoCapture(true);
  };

  // Submit sale after photo is captured
  // Uses batch endpoint: ONE photo, UNIQUE transrefno per item, SAME uploadrefno
  const handleSubmit = async () => {
    if (!selectedFarmer) {
      toast.error('Please select a member first');
      return;
    }
    if (cart.length === 0) {
      toast.error('Please add items to cart');
      return;
    }
    if (!capturedPhoto) {
      toast.error('Please capture buyer photo first');
      setShowPhotoCapture(true);
      return;
    }

    setSubmitting(true);
    setSyncing(true);
    const deviceFingerprint = await generateDeviceFingerprint();

    try {
      // Generate ONE uploadrefno for the entire batch (like Buy milk)
      const refs = await generateReferenceWithUploadRef('store');
      if (!refs) {
        toast.error('Failed to generate reference number');
        setSubmitting(false);
        setSyncing(false);
        return;
      }

      // Generate unique transrefno for EACH cart item
      const batchItems: Array<{
        transrefno: string;
        item_code: string;
        item_name: string;
        quantity: number;
        price: number;
      }> = [];

      // First item uses the transrefno from refs
      batchItems.push({
        transrefno: refs.transrefno,
        item_code: cart[0].item.icode,
        item_name: cart[0].item.descript,
        quantity: cart[0].quantity,
        price: cart[0].item.sprice,
      });

      // Additional items get new unique transrefnos (same pattern as Buy multi-capture)
      for (let i = 1; i < cart.length; i++) {
        const newTransRef = await generateTransRefOnly();
        if (!newTransRef) {
          toast.error('Failed to generate reference for item');
          setSubmitting(false);
          setSyncing(false);
          return;
        }
        batchItems.push({
          transrefno: newTransRef,
          item_code: cart[i].item.icode,
          item_name: cart[i].item.descript,
          quantity: cart[i].quantity,
          price: cart[i].item.sprice,
        });
      }

      // Convert photo to base64 ONCE
      const photoBase64 = await blobToBase64(capturedPhoto.blob);

      // Build batch request
      const batchRequest: BatchSaleRequest = {
        uploadrefno: refs.uploadrefno,
        transtype: 2, // Store transaction
        farmer_id: selectedFarmer.farmer_id,
        farmer_name: selectedFarmer.name,
        sold_by: clerkName,
        device_fingerprint: deviceFingerprint,
        photo: photoBase64, // ONE photo for all items
        items: batchItems,
      };

      if (navigator.onLine) {
        // Online: use batch endpoint
        const result = await mysqlApi.sales.createBatch(batchRequest);
        if (!result.success) {
          throw new Error(result.error || 'Batch sale failed');
        }
        console.log(`✅ Batch sale complete: ${batchItems.length} items, uploadrefno=${refs.uploadrefno}`);
      } else {
        // Offline: save each item individually for later sync
        for (const item of batchItems) {
          const sale: Sale = {
            transrefno: item.transrefno,
            uploadrefno: refs.uploadrefno,
            transtype: 2,
            farmer_id: selectedFarmer.farmer_id,
            farmer_name: selectedFarmer.name,
            item_code: item.item_code,
            item_name: item.item_name,
            quantity: item.quantity,
            price: item.price,
            sold_by: clerkName,
            device_fingerprint: deviceFingerprint,
            photo: photoBase64, // Include photo for offline sync
          };
          await saveSale(sale);
        }
        console.log(`💾 Saved ${batchItems.length} items offline for sync`);
      }

      // Create receipt data using unified helper
      const companyName = localStorage.getItem('device_company_name') || 'DAIRY COLLECTION';
      const receipt = createStoreReceiptData(
        cart,
        { id: selectedFarmer.farmer_id, name: selectedFarmer.name, route: selectedFarmer.route },
        { transrefno: refs.transrefno, uploadrefno: refs.uploadrefno, clerkName },
        companyName
      );
      setReceiptData(receipt);
      setShowReceipt(true);

      // Save receipt for reprinting with full item details
      const reprintItems: ReprintItem[] = cart.map(c => ({
        item_code: c.item.icode,
        item_name: c.item.descript,
        quantity: c.quantity,
        price: c.item.sprice,
        lineTotal: c.lineTotal,
      }));

      await addStoreReceipt({
        farmerId: selectedFarmer.farmer_id,
        farmerName: selectedFarmer.name,
        memberRoute: selectedFarmer.route,
        clerkName: clerkName,
        uploadrefno: refs.uploadrefno,
        items: reprintItems,
        totalAmount: cartTotal,
        transactionDate: new Date(),
      });

      toast.success(`Sale completed: KES${cartTotal.toFixed(0)} [${refs.uploadrefno}]`);
      setCart([]);
      // Clean up photo
      if (capturedPhoto.preview) {
        URL.revokeObjectURL(capturedPhoto.preview);
      }
      setCapturedPhoto(null);
      try { Haptics.impact({ style: ImpactStyle.Heavy }); } catch {}
    } catch (error) {
      console.error('Sale error:', error);
      toast.error('Failed to complete sale');
    } finally {
      setSubmitting(false);
      setSyncing(false);
    }
  };

  // Farmer search modal filtering - filter by prefix based on mode
  // Debtors view: mcode starting with D AND crbal ≠ 0
  const [farmerSearchQuery, setFarmerSearchQuery] = useState('');
  const prefix = isMemberMode ? 'M' : 'D';
  const prefixFilteredFarmers = farmers.filter(f => {
    const matchesPrefix = f.farmer_id.toUpperCase().startsWith(prefix);
    if (!isMemberMode) {
      // Debtors: must have non-empty crbal
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
      {/* Purple Header */}
      <div className="bg-[#5E35B1] text-white px-4 py-3" style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="p-1">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-semibold">Store</h1>
          </div>
          <button
            onClick={() => setShowPhotoAudit(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/20 rounded-lg text-sm font-medium"
          >
            <Image className="h-4 w-4" />
            Audit Photos
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 bg-[#26A69A] px-4 py-3">
        {/* Members/Debtors Toggle */}
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
              <div className="text-sm font-bold text-gray-700">{isMemberMode ? 'MEMBER' : 'DEBTOR'}</div>
              <div className="text-sm text-gray-600">
                {selectedFarmer ? (
                  <>
                    {selectedFarmer.name} [{selectedFarmer.route || 'T000'}] - MULTI OPT =
                    <br />
                    <button 
                      onClick={() => setShowViewMore(true)}
                      className="text-[#1565C0] underline font-medium"
                    >
                      [1] -&gt;&gt;VIEW MORE&lt;&lt;
                    </button>
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
            onClick={handleInitiateSale}
            disabled={submitting || cart.length === 0}
            className="flex-1 py-3 bg-[#7E57C2] text-white font-bold rounded-full disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Camera className="h-4 w-4" />
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
        <DialogContent className="sm:max-w-md p-0" hideCloseButton>
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
        <DialogContent className="sm:max-w-md p-0" hideCloseButton>
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

      {/* View More Modal - Credit Balance */}
      <Dialog open={showViewMore} onOpenChange={setShowViewMore}>
        <DialogContent className="sm:max-w-md p-0" hideCloseButton>
          <DialogHeader className="px-4 py-3 border-b flex flex-row items-center justify-between bg-[#5E35B1] text-white">
            <DialogTitle className="text-white">{isMemberMode ? 'MEMBER' : 'DEBTOR'} DETAILS</DialogTitle>
            <button onClick={() => setShowViewMore(false)} className="p-2 bg-[#E53935] text-white rounded">
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>
          <div className="p-4">
            {selectedFarmer && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-500 font-medium">ID</div>
                    <div className="text-lg font-bold">{selectedFarmer.farmer_id}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 font-medium">ROUTE</div>
                    <div className="text-lg font-bold">{selectedFarmer.route || 'N/A'}</div>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 font-medium">NAME</div>
                  <div className="text-lg font-bold">{selectedFarmer.name}</div>
                </div>
                
                {/* Original crbal value */}
                <div className="bg-gray-50 rounded-lg p-3 border">
                  <div className="text-xs text-gray-500 font-medium mb-1">CREDIT BALANCE (RAW)</div>
                  <div className="text-sm font-mono text-gray-700">{selectedFarmer.crbal || 'N/A'}</div>
                </div>
                
                {/* Credit Entries List - Parsed */}
                <div className="bg-gray-100 rounded-lg p-4">
                  <div className="text-xs text-gray-500 font-medium mb-2">CREDIT ENTRIES (PARSED)</div>
                  {parsedCredits.length > 0 ? (
                    <div className="space-y-2">
                      {parsedCredits.map((credit, index) => (
                        <div key={index} className="bg-white rounded p-2 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="font-mono text-gray-600">{credit.code}</span>
                            <span className={`font-bold ${credit.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {credit.amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          {credit.description && (
                            <div className="text-xs text-gray-500 mt-1">
                              {credit.code} - {credit.description}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-gray-400 text-center text-sm py-2">No credit entries</div>
                  )}
                </div>
                
                {/* Total Credit Balance */}
                <div className="bg-[#5E35B1]/10 rounded-lg p-4 border-2 border-[#5E35B1]">
                  <div className="text-xs text-gray-500 font-medium mb-1">TOTAL CREDIT BALANCE</div>
                  <div className={`text-2xl font-bold ${totalCreditBalance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    KES {totalCreditBalance.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Photo Capture Modal */}
      <PhotoCapture
        open={showPhotoCapture}
        onClose={() => setShowPhotoCapture(false)}
        onCapture={(blob, preview) => {
          handlePhotoCaptured(blob, preview);
          // Auto-submit after photo is captured
          setShowPhotoCapture(false);
          // Small delay to let state update
          setTimeout(() => handleSubmit(), 100);
        }}
        title="Capture Buyer Photo"
      />

      {/* Captured Photo Preview */}
      {capturedPhoto && !showPhotoCapture && (
        <div className="fixed bottom-24 right-4 z-40">
          <div className="bg-white rounded-lg shadow-lg p-2 border-2 border-green-500">
            <img 
              src={capturedPhoto.preview} 
              alt="Captured buyer" 
              className="w-16 h-16 object-cover rounded"
            />
            <div className="text-xs text-center text-green-600 font-medium mt-1">✓ Photo</div>
          </div>
        </div>
      )}

      {/* Syncing Overlay */}
      {syncing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 text-center">
            <div className="animate-spin w-10 h-10 border-4 border-[#7E57C2] border-t-transparent rounded-full mx-auto mb-3" />
            <p className="font-semibold">Processing...</p>
          </div>
        </div>
      )}

      {/* Unified Transaction Receipt Modal */}
      <TransactionReceipt
        data={receiptData}
        open={showReceipt}
        onClose={() => setShowReceipt(false)}
        onPrint={() => setShowReceipt(false)}
      />

      {/* Photo Audit Viewer */}
      <PhotoAuditViewer
        open={showPhotoAudit}
        onClose={() => setShowPhotoAudit(false)}
      />
    </div>
  );
};

export default Store;
