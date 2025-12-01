import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MilkCollection } from '@/lib/supabase';
import { FileText, Printer, X } from 'lucide-react';
import { printReceipt } from '@/services/bluetooth';
import { toast } from 'sonner';

interface ReceiptModalProps {
  receipts: MilkCollection[];
  companyName: string;
  open: boolean;
  onClose: () => void;
  onPrint?: () => void; // Callback when receipt is successfully printed
}

export const ReceiptModal = ({ receipts, companyName, open, onClose, onPrint }: ReceiptModalProps) => {
  const handlePrint = async () => {
    if (receipts.length === 0) return;

    const firstReceipt = receipts[0];
    
    // Format collections for printing
    const collections = receipts.map(r => ({
      time: new Date(r.collection_date).toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      weight: r.weight
    }));

    const result = await printReceipt({
      companyName: companyName,
      farmerName: firstReceipt.farmer_name,
      farmerId: firstReceipt.farmer_id,
      route: firstReceipt.route,
      collectorName: firstReceipt.clerk_name,
      collections
    });

    if (result.success) {
      toast.success('Receipt printed successfully');
    } else {
      if (result.error?.includes('No printer connected')) {
        toast.info('No Bluetooth printer connected. Opening browser print...');
        window.print();
      } else {
        toast.error(result.error || 'Failed to print receipt');
      }
    }
    
    // Always save receipt for reprinting, regardless of print method
    onPrint?.();
  };

  if (receipts.length === 0) return null;
  
  const firstReceipt = receipts[0];
  const totalWeight = receipts.reduce((sum, r) => sum + r.weight, 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg font-semibold">Receipt</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Company Name Header */}
          <div className="text-center border-b pb-2">
            <h3 className="font-bold text-base">{companyName}</h3>
          </div>

          {/* Compact Farmer Info */}
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Farmer:</span>
              <span className="font-semibold">{firstReceipt.farmer_id}</span>
            </div>
            <div className="font-medium">{firstReceipt.farmer_name}</div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{firstReceipt.route}</span>
              <span>{firstReceipt.session}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Collector:</span>
              <span className="font-medium">{firstReceipt.clerk_name}</span>
            </div>
          </div>

          {/* Compact Collections Table */}
          <div className="border rounded-md overflow-hidden">
            <div className="bg-muted px-2 py-1 grid grid-cols-3 text-xs font-medium">
              <span>#</span>
              <span>Time</span>
              <span className="text-right">Liters</span>
            </div>
            <div className="max-h-[30vh] overflow-y-auto divide-y">
              {receipts.map((receipt, index) => (
                <div key={receipt.reference_no} className="px-2 py-1.5 grid grid-cols-3 text-sm">
                  <span className="text-muted-foreground">{index + 1}</span>
                  <span className="text-xs">
                    {new Date(receipt.collection_date).toLocaleTimeString('en-GB', { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </span>
                  <span className="text-right font-medium">{receipt.weight}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* Compact Total */}
          <div className="bg-primary/10 rounded-md px-3 py-2 flex justify-between items-center">
            <span className="font-semibold">Total:</span>
            <span className="text-xl font-bold">{totalWeight.toFixed(1)} Kg</span>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handlePrint}
            className="flex-1 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md font-medium hover:bg-secondary/80 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
