import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { mysqlApi, type Item, type Sale } from '@/services/mysqlApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { ArrowLeft, ShoppingCart, Package, DollarSign } from 'lucide-react';

const Store = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [sellDialogOpen, setSellDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  
  // Sale form
  const [quantity, setQuantity] = useState('');
  const [farmerId, setFarmerId] = useState('');
  const [farmerName, setFarmerName] = useState('');
  const [soldBy, setSoldBy] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadItems();
  }, []);

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
    setSoldBy('');
    setSellDialogOpen(true);
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
      const success = await mysqlApi.sales.create(sale);
      
      if (success) {
        toast.success(`Sale recorded: ${qty} x ${selectedItem.descript}`);
        setSellDialogOpen(false);
        loadItems(); // Refresh to update stock
      } else {
        toast.error('Failed to record sale');
      }
    } catch (error) {
      toast.error('Error recording sale');
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 to-secondary/5 p-4">
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
                      <span className="font-semibold flex items-center gap-1">
                        <DollarSign className="h-4 w-4" />
                        {item.sprice.toFixed(2)}
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
                    Available: {selectedItem.stockbal} units @ ${selectedItem.sprice.toFixed(2)}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="farmerId">Farmer ID *</Label>
                <Input
                  id="farmerId"
                  value={farmerId}
                  onChange={(e) => setFarmerId(e.target.value)}
                  placeholder="Enter farmer ID"
                />
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
                  placeholder="Enter clerk name"
                />
              </div>
              {quantity && selectedItem && (
                <div className="p-3 bg-primary/10 rounded-lg">
                  <p className="font-semibold text-primary">
                    Total: ${(parseFloat(quantity) * selectedItem.sprice).toFixed(2)}
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
