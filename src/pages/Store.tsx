import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { mysqlApi, type Item, type Sale, type Farmer } from '@/services/mysqlApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { ArrowLeft, ShoppingCart, Package, Loader2, Receipt as ReceiptIcon } from 'lucide-react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { DeviceAuthStatus } from '@/components/DeviceAuthStatus';

const Store = () => {
  const navigate = useNavigate();
  const { isAuthenticated, currentUser } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [hasRoutes, setHasRoutes] = useState<boolean | null>(null);

  // Check authentication
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);
  const [loading, setLoading] = useState(true);
  const [sellDialogOpen, setSellDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [syncing, setSyncing] = useState(false);
  
  // Sale form
  const [quantity, setQuantity] = useState('');
  const [farmerId, setFarmerId] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [soldBy, setSoldBy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // Farmer autocomplete
  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [filteredFarmers, setFilteredFarmers] = useState<Farmer[]>([]);
  const [showFarmerDropdown, setShowFarmerDropdown] = useState(false);
  const farmerInputRef = useRef<HTMLInputElement>(null);
  
  // Receipt data
  const [lastReceipt, setLastReceipt] = useState<{
    sale: Sale;
    qty: number;
    total: number;
    timestamp: Date;
  } | null>(null);
  
  const { getFarmers, saveSale, getUnsyncedSales, deleteSale, saveItems, getItems, saveFarmers, isReady } = useIndexedDB();

  useEffect(() => {
    if (!isReady) return;
    
    const timer = setTimeout(() => {
      checkRoutesAndLoadItems();
      loadFarmers();
      loadLoggedInUser();
      syncPendingSales();
    }, 100); // Small delay to prevent race condition

    return () => clearTimeout(timer);
  }, [isReady]);

  // Check if ccode has routes in fm_tanks before loading items
  const checkRoutesAndLoadItems = async () => {
    try {
      setLoading(true);
      
      // Get device fingerprint to check routes
      const deviceFingerprint = await generateDeviceFingerprint();
      
      // Try to fetch routes first to check if ccode has any
      if (navigator.onLine) {
        try {
          const apiUrl = 'https://backend.maddasystems.co.ke';
          const response = await fetch(
            `${apiUrl}/api/routes?uniquedevcode=${encodeURIComponent(deviceFingerprint)}`,
            { signal: AbortSignal.timeout(5000) } // 5 second timeout
          );
          
          // Handle 404 gracefully - endpoint doesn't exist, allow items to load
          if (response.status === 404) {
            console.log('📭 Routes endpoint not found - proceeding with items load');
            setHasRoutes(true);
          } else if (response.ok) {
            const data = await response.json();
            const routesExist = data.success && data.data && data.data.length > 0;
            setHasRoutes(routesExist);
            
            if (!routesExist) {
              console.log('📭 No routes found for this ccode - store items will not be displayed');
              setItems([]);
              setLoading(false);
              return;
            }
          } else {
            // Other error - allow items to load as fallback
            console.warn('Routes check returned status:', response.status);
            setHasRoutes(true);
          }
        } catch (err) {
          console.warn('Failed to check routes:', err);
          // On error, allow items to load (fallback behavior)
          setHasRoutes(true);
        }
      } else {
        // Offline - assume routes exist and load cached items
        setHasRoutes(true);
      }
      
      // Routes exist, load items
      await loadItems();
    } catch (error) {
      console.error('Failed to check routes:', error);
      setHasRoutes(true); // Fallback to allow items
      setLoading(false);
    }
  };

  const loadLoggedInUser = () => {
    if (currentUser) {
      setSoldBy(currentUser.user_id || '');
      console.log('Loaded user for sold_by:', currentUser.user_id);
    } else {
      console.warn('No currentUser in auth context');
    }
  };

  const loadFarmers = async () => {
    try {
      // Always load from cache - global sync handles updates
      const localFarmers = await getFarmers();
      if (localFarmers.length > 0) {
        setFarmers(localFarmers);
        console.log('📦 Loaded cached farmers');
      } else if (!navigator.onLine) {
        toast.warning('No cached farmers. Please connect online first.');
      }
    } catch (error) {
      console.error('Failed to load farmers:', error);
    }
  };

  const loadItems = async () => {
    try {
      setLoading(true);
      
      // Load cached items - global sync handles updates
      const cachedItems = await getItems();
      if (cachedItems.length > 0) {
        setItems(cachedItems);
        console.log('📦 Loaded cached items');
      } else if (!navigator.onLine) {
        toast.warning('No cached items. Please connect online first.');
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Failed to load items:', error);
      setLoading(false);
    }
  };

  const handleSellClick = (item: Item) => {
    setSelectedItem(item);
    setQuantity('');
    setFarmerId('');
    setFarmerName('');
    setFilteredFarmers([]);
    setShowFarmerDropdown(false);
    loadLoggedInUser(); // Refresh sold by
    setSellDialogOpen(true);
  };

  const handleFarmerIdChange = (value: string) => {
    setFarmerId(value);
    
    if (value.trim() === '') {
      // Show all farmers when input is empty
      setFilteredFarmers(farmers.slice(0, 10));
      setShowFarmerDropdown(farmers.length > 0);
      setFarmerName('');
      return;
    }

    // Filter farmers based on input - smart search with null safety
    const filtered = farmers.filter(f => {
      const farmerId = String(f.farmer_id || '').toLowerCase();
      const farmerName = String(f.name || '').toLowerCase();
      const searchValue = value.toLowerCase();
      
      return farmerId.startsWith(searchValue) ||
             farmerName.includes(searchValue) ||
             farmerId.includes(searchValue);
    }).slice(0, 10); // Limit to 10 results

    setFilteredFarmers(filtered);
    setShowFarmerDropdown(filtered.length > 0);
  };

  const handleFarmerSelect = (farmer: Farmer) => {
    setFarmerId(farmer.farmer_id);
    setFarmerName(farmer.name);
    setShowFarmerDropdown(false);
    setFilteredFarmers([]);
  };

  const syncPendingSales = async () => {
    if (!navigator.onLine || !isReady) return;
    
    try {
      const pendingSales = await getUnsyncedSales();
      if (pendingSales.length === 0) return;
      
      console.log(`Syncing ${pendingSales.length} pending sales...`);
      
      for (const saleRecord of pendingSales) {
        try {
          // Generate device fingerprint for sync
          const deviceFingerprint = await generateDeviceFingerprint();
          
          // Clean the sale object - ONLY include API fields, NO IndexedDB fields
          const cleanSale: Sale = {
            farmer_id: String(saleRecord.farmer_id || ''),
            farmer_name: String(saleRecord.farmer_name || ''),
            item_code: String(saleRecord.item_code || ''),
            item_name: String(saleRecord.item_name || ''),
            quantity: Number(saleRecord.quantity) || 0,
            price: Number(saleRecord.price) || 0,
            sold_by: String(saleRecord.sold_by || ''),
            device_fingerprint: deviceFingerprint,
          };
          
          console.log('Syncing sale:', cleanSale);
          const success = await mysqlApi.sales.create(cleanSale);
          if (success && saleRecord.orderId) {
            await deleteSale(saleRecord.orderId);
            console.log(`✅ Synced and deleted sale ${saleRecord.orderId}`);
          }
        } catch (error) {
          console.error('❌ Sync error for sale:', saleRecord.orderId, error);
        }
      }
      
      toast.success('Offline sales synced successfully');
    } catch (error) {
      console.error('Failed to sync sales:', error);
    }
  };

  const handleSellSubmit = async () => {
    if (!selectedItem || !quantity || !farmerId || !farmerName || !soldBy) {
      toast.error('Please fill all required fields');
      return;
    }

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      toast.error('Invalid quantity');
      return;
    }

    if (qty > selectedItem.stockbal) {
      toast.error(`Only ${selectedItem.stockbal} units available`);
      return;
    }

    // Generate device fingerprint
    const deviceFingerprint = await generateDeviceFingerprint();
    
    const sale: Sale = {
      farmer_id: farmerId,
      farmer_name: farmerName,
      item_code: selectedItem.icode,
      item_name: selectedItem.descript,
      quantity: qty,
      price: selectedItem.sprice,
      sold_by: soldBy,
      device_fingerprint: deviceFingerprint,
    };

    try {
      setSubmitting(true);
      setSyncing(true);
      
      if (navigator.onLine) {
        // Online: save to server
        const success = await mysqlApi.sales.create(sale);
        
        if (success) {
          toast.success(`Sale recorded: ${qty} x ${selectedItem.descript}`);
          setLastReceipt({
            sale,
            qty,
            total: qty * sale.price,
            timestamp: new Date()
          });
          setSellDialogOpen(false);
          await loadItems();
          setTimeout(() => window.print(), 300);
        } else {
          toast.error('Failed to record sale');
        }
      } else {
        // Offline: save to IndexedDB
        await saveSale(sale);
        toast.success(`Sale saved offline: ${qty} x ${selectedItem.descript}. Will sync when online.`);
        setLastReceipt({
          sale,
          qty,
          total: qty * sale.price,
          timestamp: new Date()
        });
        setSellDialogOpen(false);
        setTimeout(() => window.print(), 300);
      }
    } catch (error) {
      // If online request fails, save offline
      if (navigator.onLine) {
        console.error('Online save failed, saving offline:', error);
        try {
          await saveSale(sale);
          toast.warning('Saved offline. Will sync when connection is restored.');
          setLastReceipt({
            sale,
            qty,
            total: qty * sale.price,
            timestamp: new Date()
          });
          setSellDialogOpen(false);
          setTimeout(() => window.print(), 300);
        } catch (offlineError) {
          toast.error('Error saving sale');
          console.error(offlineError);
        }
      } else {
        toast.error('Error recording sale');
        console.error(error);
      }
    } finally {
      setSubmitting(false);
      setSyncing(false);
    }
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary/5 p-4 relative print:bg-white">
      {/* Thermal Print Layout - Only visible on print */}
      {lastReceipt && (
        <div className="thermal-print">
          <div className="thermal-header">SALE RECEIPT</div>
          <div className="thermal-divider">--------------------------------</div>
          <div className="thermal-line">DATE: {lastReceipt.timestamp.toLocaleDateString()}</div>
          <div className="thermal-line">TIME: {lastReceipt.timestamp.toLocaleTimeString()}</div>
          <div className="thermal-line">REF: {lastReceipt.sale.sale_ref || 'N/A'}</div>
          <div className="thermal-divider">--------------------------------</div>
          <div className="thermal-section">
            <div className="thermal-line thermal-bold">CUSTOMER DETAILS</div>
            <div className="thermal-line">ID: {lastReceipt.sale.farmer_id}</div>
            <div className="thermal-line">Name: {lastReceipt.sale.farmer_name}</div>
          </div>
          <div className="thermal-divider">--------------------------------</div>
          <div className="thermal-section">
            <div className="thermal-line thermal-bold">ITEM DETAILS</div>
            <div className="thermal-line">Code: {lastReceipt.sale.item_code}</div>
            <div className="thermal-line">Name: {lastReceipt.sale.item_name}</div>
            <div className="thermal-line">Quantity: {lastReceipt.qty}</div>
            <div className="thermal-line">Price: Ksh {lastReceipt.sale.price.toFixed(2)}</div>
          </div>
          <div className="thermal-divider">--------------------------------</div>
          <div className="thermal-section">
            <div className="thermal-line thermal-bold" style={{ fontSize: '12pt', textAlign: 'center' }}>
              TOTAL: Ksh {lastReceipt.total.toFixed(2)}
            </div>
          </div>
          <div className="thermal-divider">--------------------------------</div>
          <div className="thermal-line">Sold By: {lastReceipt.sale.sold_by}</div>
          <div className="thermal-divider">--------------------------------</div>
          <div className="thermal-line" style={{ textAlign: 'center', fontSize: '8pt', marginTop: '4mm' }}>
            Thank you for your business!
          </div>
        </div>
      )}
      
      {/* Syncing Overlay */}
      {syncing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-80">
            <CardContent className="py-8">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <div className="text-center">
                  <p className="font-semibold text-lg">Syncing...</p>
                  <p className="text-sm text-muted-foreground mt-1">Please wait, do not navigate away</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      
      <div className="max-w-7xl mx-auto screen-only">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
                  <Package className="h-8 w-8" />
                  Store
                </h1>
                <DeviceAuthStatus />
              </div>
              <p className="text-muted-foreground">Manage product sales</p>
            </div>
          </div>
        </div>

        {/* Items Grid */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading items...</p>
          </div>
        ) : hasRoutes === false ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No routes assigned to this company code</p>
              <p className="text-sm text-muted-foreground mt-2">Store items require routes to be configured in fm_tanks</p>
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No sellable items available</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((item) => (
              <Card key={item.ID} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    {item.descript}
                  </CardTitle>
                  <CardDescription>Code: {item.icode}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Price:</span>
                      <span className="font-semibold">
                        Ksh {item.sprice.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Stock:</span>
                      <span className={`font-semibold ${item.stockbal < 10 ? 'text-destructive' : 'text-green-600'}`}>
                        {item.stockbal} units
                      </span>
                    </div>
                    <Button 
                      className="w-full" 
                      onClick={() => handleSellClick(item)}
                      disabled={item.stockbal <= 0}
                    >
                      <ShoppingCart className="h-4 w-4 mr-2" />
                      Sell
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Sell Dialog */}
        <Dialog open={sellDialogOpen} onOpenChange={setSellDialogOpen}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Sell Item</DialogTitle>
              <DialogDescription>
                {selectedItem && `${selectedItem.descript} - ${selectedItem.icode}`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="quantity">Quantity *</Label>
                <Input
                  id="quantity"
                  type="number"
                  step="0.01"
                  min="0"
                  max={selectedItem?.stockbal || 0}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Enter quantity"
                />
                {selectedItem && (
                  <p className="text-sm text-muted-foreground">
                    Available: {selectedItem.stockbal} units @ Ksh {selectedItem.sprice.toFixed(2)}
                  </p>
                )}
              </div>
              <div className="grid gap-2 relative">
                <Label htmlFor="farmerId">Farmer ID *</Label>
                <Input
                  ref={farmerInputRef}
                  id="farmerId"
                  value={farmerId}
                  onChange={(e) => handleFarmerIdChange(e.target.value)}
                  onFocus={() => {
                    // Show suggestions immediately on focus
                    if (farmerId.trim() === '') {
                      setFilteredFarmers(farmers.slice(0, 10));
                    }
                    setShowFarmerDropdown(true);
                  }}
                  onBlur={() => {
                    // Delay to allow click on dropdown
                    setTimeout(() => setShowFarmerDropdown(false), 200);
                  }}
                  placeholder="Type farmer ID or name"
                  autoComplete="off"
                />
                {showFarmerDropdown && filteredFarmers.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto z-50">
                    {filteredFarmers.map((farmer) => (
                      <button
                        key={farmer.farmer_id}
                        type="button"
                        onClick={() => handleFarmerSelect(farmer)}
                        className="w-full text-left px-3 py-2 hover:bg-primary/10 border-b last:border-b-0 transition-colors"
                      >
                        <div className="font-semibold text-sm">{farmer.name}</div>
                        <div className="text-xs text-muted-foreground">ID: {farmer.farmer_id}</div>
                        <div className="text-xs text-muted-foreground">Route: {farmer.route || 'N/A'}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="farmerName">Farmer Name *</Label>
                <Input
                  id="farmerName"
                  value={farmerName}
                  onChange={(e) => setFarmerName(e.target.value)}
                  placeholder="Enter farmer name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="soldBy">Sold By *</Label>
                <Input
                  id="soldBy"
                  value={soldBy}
                  onChange={(e) => setSoldBy(e.target.value)}
                  placeholder="Clerk name"
                  readOnly
                  className="bg-muted"
                />
              </div>
              {quantity && selectedItem && (
                <div className="p-3 bg-primary/10 rounded-lg">
                  <p className="font-semibold text-primary">
                    Total: Ksh {(parseFloat(quantity) * selectedItem.sprice).toFixed(2)}
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSellDialogOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleSellSubmit} disabled={submitting}>
                {submitting ? 'Processing...' : 'Complete Sale'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default Store;
