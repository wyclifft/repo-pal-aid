import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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

const Store = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
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
  
  const { getFarmers } = useIndexedDB();

  useEffect(() => {
    loadItems();
    loadFarmers();
    loadLoggedInUser();
  }, []);

  const loadLoggedInUser = () => {
    // Get logged-in user from localStorage
    const userStr = localStorage.getItem('currentUser');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        setSoldBy(user.user_id || '');
      } catch (e) {
        console.error('Failed to parse user:', e);
      }
    }
  };

  const loadFarmers = async () => {
    try {
      // Try to load from API first
      if (navigator.onLine) {
        const data = await mysqlApi.farmers.getAll();
        setFarmers(data);
      } else {
        // Load from IndexedDB if offline
        const localFarmers = await getFarmers();
        setFarmers(localFarmers);
      }
    } catch (error) {
      console.error('Failed to load farmers:', error);
      // Try local fallback
      try {
        const localFarmers = await getFarmers();
        setFarmers(localFarmers);
      } catch (e) {
        console.error('Failed to load local farmers:', e);
      }
    }
  };

  const loadItems = async () => {
    try {
      setLoading(true);
      const data = await mysqlApi.items.getAll();
      setItems(data);
    } catch (error) {
      toast.error('Failed to load items');
      console.error(error);
    } finally {
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
      setFilteredFarmers([]);
      setShowFarmerDropdown(false);
      setFarmerName('');
      return;
    }

    // Filter farmers based on input
    const filtered = farmers.filter(f => 
      f.farmer_id.toLowerCase().includes(value.toLowerCase()) ||
      f.name.toLowerCase().includes(value.toLowerCase())
    ).slice(0, 10); // Limit to 10 results

    setFilteredFarmers(filtered);
    setShowFarmerDropdown(filtered.length > 0);
  };

  const handleFarmerSelect = (farmer: Farmer) => {
    setFarmerId(farmer.farmer_id);
    setFarmerName(farmer.name);
    setShowFarmerDropdown(false);
    setFilteredFarmers([]);
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

    const sale: Sale = {
      farmer_id: farmerId,
      farmer_name: farmerName,
      item_code: selectedItem.icode,
      item_name: selectedItem.descript,
      quantity: qty,
      price: selectedItem.sprice,
      sold_by: soldBy,
    };

    try {
      setSubmitting(true);
      setSyncing(true);
      
      const success = await mysqlApi.sales.create(sale);
      
      if (success) {
        toast.success(`Sale recorded: ${qty} x ${selectedItem.descript}`);
        
        // Print receipt
        printReceipt(sale, qty);
        
        setSellDialogOpen(false);
        
        // Refresh to update stock
        await loadItems();
      } else {
        toast.error('Failed to record sale');
      }
    } catch (error) {
      toast.error('Error recording sale');
      console.error(error);
    } finally {
      setSubmitting(false);
      setSyncing(false);
    }
  };

  const printReceipt = (sale: Sale, qty: number) => {
    const printWindow = window.open('', '', 'width=300,height=600');
    if (!printWindow) return;

    const total = qty * sale.price;
    const content = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Sale Receipt</title>
        <style>
          @media print {
            @page {
              size: 58mm auto;
              margin: 0;
            }
          }
          body {
            width: 58mm;
            margin: 0;
            padding: 4mm;
            font-family: 'Courier New', monospace;
            font-size: 10pt;
            line-height: 1.3;
          }
          .center { text-align: center; }
          .line { border-top: 1px dashed #000; margin: 2mm 0; }
          .bold { font-weight: bold; }
          .title { font-size: 11pt; font-weight: bold; }
          .section { margin: 2mm 0; }
          .row { display: flex; justify-content: space-between; }
        </style>
      </head>
      <body>
        <div class="center title">SALE RECEIPT</div>
        <div class="line"></div>
        <div class="section">
          <div>Date: ${new Date().toLocaleDateString()}</div>
          <div>Time: ${new Date().toLocaleTimeString()}</div>
          <div>Ref: ${sale.sale_ref || 'N/A'}</div>
        </div>
        <div class="line"></div>
        <div class="section">
          <div class="bold">Customer Details</div>
          <div>ID: ${sale.farmer_id}</div>
          <div>Name: ${sale.farmer_name}</div>
        </div>
        <div class="line"></div>
        <div class="section">
          <div class="bold">Item Details</div>
          <div>Code: ${sale.item_code}</div>
          <div>Name: ${sale.item_name}</div>
          <div class="row">
            <span>Quantity:</span>
            <span>${qty}</span>
          </div>
          <div class="row">
            <span>Price:</span>
            <span>Ksh ${sale.price.toFixed(2)}</span>
          </div>
        </div>
        <div class="line"></div>
        <div class="section center">
          <div class="bold" style="font-size: 12pt;">TOTAL: Ksh ${total.toFixed(2)}</div>
        </div>
        <div class="line"></div>
        <div class="section">
          <div>Sold By: ${sale.sold_by}</div>
        </div>
        <div class="line"></div>
        <div class="center" style="font-size: 8pt; margin-top: 4mm;">
          Thank you for your business!
        </div>
      </body>
      </html>
    `;

    printWindow.document.write(content);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary/5 p-4 relative">
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
      
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => navigate('/')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
                <Package className="h-8 w-8" />
                Store
              </h1>
              <p className="text-muted-foreground">Manage product sales</p>
            </div>
          </div>
        </div>

        {/* Items Grid */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading items...</p>
          </div>
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
                    if (filteredFarmers.length > 0) {
                      setShowFarmerDropdown(true);
                    }
                  }}
                  placeholder="Type farmer ID or name"
                  autoComplete="off"
                />
                {showFarmerDropdown && filteredFarmers.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto z-50">
                    {filteredFarmers.map((farmer) => (
                      <button
                        key={farmer.farmer_id}
                        type="button"
                        onClick={() => handleFarmerSelect(farmer)}
                        className="w-full text-left px-3 py-2 hover:bg-primary/10 border-b last:border-b-0"
                      >
                        <div className="font-semibold text-sm">{farmer.farmer_id}</div>
                        <div className="text-xs text-muted-foreground">{farmer.name}</div>
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
