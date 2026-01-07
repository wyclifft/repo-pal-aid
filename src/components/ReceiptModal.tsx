import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MilkCollection } from '@/lib/supabase';
import { Printer, X } from 'lucide-react';
import { printReceipt } from '@/services/bluetooth';
import { toast } from 'sonner';

interface ReceiptModalProps {
  receipts: MilkCollection[];
  companyName: string;
  open: boolean;
  onClose: () => void;
  onPrint?: () => void;
  cumulativeFrequency?: number;
  showCumulativeFrequency?: boolean;
  printCopies?: number;
  routeLabel?: string;
  locationCode?: string;
  locationName?: string;
}

export const ReceiptModal = ({ 
  receipts, 
  companyName, 
  open, 
  onClose, 
  onPrint,
  cumulativeFrequency,
  showCumulativeFrequency = false,
  printCopies = 1,
  routeLabel = 'Route',
  locationCode,
  locationName
}: ReceiptModalProps) => {
  const handlePrint = async () => {
    if (receipts.length === 0) return;

    // If printCopies is 0, skip printing entirely
    if (printCopies === 0) {
      toast.info('Printing disabled (0 copies configured)');
      onPrint?.();
      return;
    }

    const firstReceipt = receipts[0];
    const collectionDateTime = new Date(firstReceipt.collection_date);
    
    // Format collections for printing
    const collections = receipts.map((r, index) => ({
      index: index + 1,
      weight: r.weight,
      transrefno: r.reference_no
    }));

    // Print multiple copies based on printoptions setting
    for (let copy = 0; copy < printCopies; copy++) {
      const result = await printReceipt({
        companyName: companyName,
        farmerName: firstReceipt.farmer_name,
        farmerId: firstReceipt.farmer_id,
        route: firstReceipt.route,
        routeLabel: routeLabel,
        session: firstReceipt.session,
        uploadRefNo: firstReceipt.uploadrefno || firstReceipt.reference_no,
        collectorName: firstReceipt.clerk_name,
        collections,
        cumulativeFrequency: showCumulativeFrequency ? cumulativeFrequency : undefined,
        locationCode: locationCode,
        locationName: locationName,
        collectionDate: collectionDateTime
      });

      if (!result.success) {
        if (result.error?.includes('No printer connected')) {
          toast.info('No Bluetooth printer connected. Opening browser print...');
          window.print();
          break;
        } else {
          toast.error(result.error || 'Failed to print receipt');
          break;
        }
      } else if (copy === printCopies - 1) {
        toast.success(`Receipt printed (${printCopies} ${printCopies === 1 ? 'copy' : 'copies'})`);
      }
      
      if (copy < printCopies - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    onPrint?.();
  };

  if (receipts.length === 0) return null;
  
  const firstReceipt = receipts[0];
  const totalWeight = receipts.reduce((sum, r) => sum + r.weight, 0);
  const collectionDateTime = new Date(firstReceipt.collection_date);
  const formattedDate = collectionDateTime.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const formattedTime = collectionDateTime.toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm font-mono text-sm">
        <DialogHeader className="pb-0">
          <DialogTitle className="sr-only">Receipt</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {/* Header */}
          <div className="text-center border-b border-dashed pb-2">
            <h3 className="font-bold text-base">{companyName}</h3>
            <p className="text-xs text-muted-foreground">CUSTOMER DELIVERY RECEIPT</p>
          </div>

          {/* Member Info */}
          <div className="space-y-0.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Member NO</span>
              <span className="font-semibold">#{firstReceipt.farmer_id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Member Name</span>
              <span className="font-medium">{firstReceipt.farmer_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reference NO</span>
              <span className="font-medium">{firstReceipt.uploadrefno || firstReceipt.reference_no}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span className="font-medium">{formattedDate} {formattedTime}</span>
            </div>
          </div>

          {/* Collections List */}
          <div className="border-t border-b border-dashed py-2 space-y-1">
            {receipts.map((receipt, index) => (
              <div key={receipt.reference_no} className="flex justify-between text-xs">
                <span>{index + 1}: {receipt.reference_no}</span>
                <span className="font-medium">{receipt.weight.toFixed(1)}</span>
              </div>
            ))}
          </div>
          
          {/* Total Weight */}
          <div className="border-b border-dashed pb-2">
            <div className="flex justify-between text-sm font-bold">
              <span>Total Weight [Kgs]</span>
              <span>{totalWeight.toFixed(2)}</span>
            </div>
          </div>

          {/* Footer Info */}
          <div className="space-y-0.5 text-xs">
            {showCumulativeFrequency && cumulativeFrequency !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cumulative</span>
                <span className="font-medium">{cumulativeFrequency.toFixed(1)}</span>
              </div>
            )}
            {locationCode && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Location</span>
                <span className="font-medium">{locationCode}</span>
              </div>
            )}
            {locationName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Location Name</span>
                <span className="font-medium">{locationName}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Member Region</span>
              <span className="font-medium">{firstReceipt.route}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Clerk Name</span>
              <span className="font-medium">{firstReceipt.clerk_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Session</span>
              <span className="font-medium">{firstReceipt.session}</span>
            </div>
            <div className="text-center text-muted-foreground pt-1 border-t border-dashed mt-2">
              {formattedDate} at {formattedTime}
            </div>
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