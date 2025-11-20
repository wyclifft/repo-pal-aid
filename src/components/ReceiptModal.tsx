import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MilkCollection } from '@/lib/supabase';
import { FileText, Printer, X } from 'lucide-react';
import { printReceipt } from '@/services/bluetooth';
import { toast } from 'sonner';

interface ReceiptModalProps {
  receipts: MilkCollection[];
  open: boolean;
  onClose: () => void;
}

export const ReceiptModal = ({ receipts, open, onClose }: ReceiptModalProps) => {
  const handlePrint = async () => {
    if (receipts.length === 0) return;

    // Print consolidated receipt for the farmer
    const firstReceipt = receipts[0];
    const totalWeight = receipts.reduce((sum, r) => sum + r.weight, 0);
    const referenceNos = receipts.map(r => r.reference_no).join(', ');
    
    const result = await printReceipt({
      referenceNo: referenceNos,
      farmerName: firstReceipt.farmer_name,
      farmerId: firstReceipt.farmer_id,
      route: firstReceipt.route,
      session: firstReceipt.session,
      weight: totalWeight,
      collector: firstReceipt.clerk_name || 'N/A',
      date: new Date(firstReceipt.collection_date).toLocaleString(),
    });

    if (result.success) {
      toast.success('Consolidated receipt printed successfully');
    } else {
      if (result.error?.includes('No printer connected')) {
        toast.info('No Bluetooth printer connected. Opening browser print...');
        window.print();
      } else {
        toast.error(result.error || 'Failed to print receipt');
      }
    }
  };

  if (receipts.length === 0) return null;
  
  const firstReceipt = receipts[0];
  const totalWeight = receipts.reduce((sum, r) => sum + r.weight, 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl text-[#667eea]">
            <FileText className="h-6 w-6" />
            Consolidated Receipt
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Farmer Details */}
          <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
            <table className="w-full">
              <tbody>
                <tr className="border-b">
                  <th className="text-left py-2 font-semibold">Farmer Name</th>
                  <td className="py-2 font-bold">{firstReceipt.farmer_name}</td>
                </tr>
                <tr className="border-b">
                  <th className="text-left py-2 font-semibold">Farmer ID</th>
                  <td className="py-2">{firstReceipt.farmer_id}</td>
                </tr>
                <tr className="border-b">
                  <th className="text-left py-2 font-semibold">Route</th>
                  <td className="py-2">{firstReceipt.route}</td>
                </tr>
                <tr className="border-b">
                  <th className="text-left py-2 font-semibold">Session</th>
                  <td className="py-2">{firstReceipt.session}</td>
                </tr>
                <tr>
                  <th className="text-left py-2 font-semibold">Collector</th>
                  <td className="py-2">{firstReceipt.clerk_name}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Collections List */}
          <div>
            <h3 className="font-semibold text-lg mb-2">Collections ({receipts.length})</h3>
            <div className="max-h-[40vh] overflow-y-auto space-y-2">
              {receipts.map((receipt, index) => (
                <div key={receipt.reference_no} className="bg-secondary/10 p-3 rounded-md border">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Receipt #{receipt.reference_no}</p>
                      <p className="font-mono font-bold text-lg">{receipt.weight} Kg</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">{new Date(receipt.collection_date).toLocaleTimeString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Total Summary */}
          <div className="bg-green-50 border-2 border-green-500 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <span className="font-bold text-lg">Total Weight:</span>
              <span className="font-bold text-3xl text-green-700">{totalWeight.toFixed(2)} Kg</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={handlePrint}
            className="flex-1 py-2 bg-[#667eea] text-white rounded-lg font-semibold hover:bg-[#5568d3] transition-colors flex items-center justify-center gap-2"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors flex items-center justify-center gap-2"
          >
            <X className="h-4 w-4" />
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
