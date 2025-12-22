import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MilkCollection } from '@/lib/supabase';
import { Printer, X, Clock } from 'lucide-react';
import { printReceipt } from '@/services/bluetooth';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface PrintedReceipt {
  farmerId: string;
  farmerName: string;
  collections: MilkCollection[];
  printedAt: Date;
}

interface ReprintModalProps {
  open: boolean;
  onClose: () => void;
  receipts: PrintedReceipt[];
  companyName: string;
  printCopies?: number;
}

export const ReprintModal = ({ open, onClose, receipts, companyName, printCopies = 1 }: ReprintModalProps) => {
  const handleReprint = async (receipt: PrintedReceipt) => {
    if (receipt.collections.length === 0) return;

    const firstReceipt = receipt.collections[0];
    
    // Format collections for printing
    const collections = receipt.collections.map(r => ({
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
      session: firstReceipt.session,
      referenceNo: firstReceipt.reference_no,
      collectorName: firstReceipt.clerk_name,
      collections
    });

    if (result.success) {
      toast.success('Receipt reprinted successfully');
    } else {
      if (result.error?.includes('No printer connected')) {
        toast.info('No Bluetooth printer connected. Opening browser print...');
        window.print();
      } else {
        toast.error(result.error || 'Failed to reprint receipt');
      }
    }
  };

  const getTotalWeight = (collections: MilkCollection[]) => {
    return collections.reduce((sum, r) => sum + r.weight, 0);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg font-semibold">Recent Receipts</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {receipts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No recent receipts to display
            </div>
          ) : (
            receipts.map((receipt, index) => (
              <div
                key={index}
                className="border rounded-lg p-3 space-y-2 hover:bg-accent/50 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold">{receipt.farmerName}</div>
                    <div className="text-sm text-muted-foreground">{receipt.farmerId}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg">{getTotalWeight(receipt.collections).toFixed(1)} Kg</div>
                    <div className="text-xs text-muted-foreground">{receipt.collections.length} collections</div>
                  </div>
                </div>
                
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Printed: {format(new Date(receipt.printedAt), 'MMM dd, yyyy HH:mm')}</span>
                </div>

                <button
                  onClick={() => handleReprint(receipt)}
                  className="w-full py-2 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                >
                  <Printer className="h-4 w-4" />
                  Reprint
                </button>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md font-medium hover:bg-secondary/80 transition-colors flex items-center gap-2"
          >
            <X className="h-4 w-4" />
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
