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

    // Print all receipts sequentially
    for (const receipt of receipts) {
      const result = await printReceipt({
        referenceNo: receipt.reference_no,
        farmerName: receipt.farmer_name,
        farmerId: receipt.farmer_id,
        route: receipt.route,
        session: receipt.session,
        weight: receipt.weight,
        collector: receipt.clerk_name || 'N/A',
        date: new Date(receipt.collection_date).toLocaleString(),
      });

      if (!result.success) {
        if (result.error?.includes('No printer connected')) {
          toast.info('No Bluetooth printer connected. Opening browser print...');
          window.print();
          return;
        } else {
          toast.error(result.error || 'Failed to print receipt');
          return;
        }
      }
    }
    
    toast.success(`${receipts.length} receipt${receipts.length !== 1 ? 's' : ''} printed successfully`);
  };

  if (receipts.length === 0) return null;
  
  const totalWeight = receipts.reduce((sum, r) => sum + r.weight, 0);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl text-[#667eea]">
            <FileText className="h-6 w-6" />
            Batch Receipt ({receipts.length} collection{receipts.length !== 1 ? 's' : ''})
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {receipts.map((receipt, index) => (
            <div key={receipt.reference_no} className="space-y-2 pb-4 border-b last:border-b-0">
              <div className="bg-primary/10 px-3 py-1 rounded-md">
                <p className="text-sm font-bold text-primary">Collection #{index + 1}</p>
              </div>
              <table className="w-full">
                <tbody>
                  <tr className="border-b bg-primary/5">
                    <th className="text-left py-2 font-semibold">Receipt No.</th>
                    <td className="py-2 font-mono font-bold text-primary">{receipt.reference_no}</td>
                  </tr>
                  <tr className="border-b">
                    <th className="text-left py-2 font-semibold">Farmer Name</th>
                    <td className="py-2">{receipt.farmer_name}</td>
                  </tr>
                  <tr className="border-b">
                    <th className="text-left py-2 font-semibold">Route</th>
                    <td className="py-2">{receipt.route}</td>
                  </tr>
                  <tr className="border-b">
                    <th className="text-left py-2 font-semibold">Farmer ID</th>
                    <td className="py-2">{receipt.farmer_id}</td>
                  </tr>
                  <tr className="border-b">
                    <th className="text-left py-2 font-semibold">Session</th>
                    <td className="py-2">{receipt.session}</td>
                  </tr>
                  <tr className="border-b">
                    <th className="text-left py-2 font-semibold">Weight</th>
                    <td className="py-2">{receipt.weight} Kg</td>
                  </tr>
                  <tr className="border-b">
                    <th className="text-left py-2 font-semibold">Collector</th>
                    <td className="py-2">{receipt.clerk_name}</td>
                  </tr>
                  <tr>
                    <th className="text-left py-2 font-semibold">Date</th>
                    <td className="py-2">{new Date(receipt.collection_date).toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          
          {/* Total Summary */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex justify-between items-center">
              <span className="font-bold text-lg">Total Weight:</span>
              <span className="font-bold text-2xl text-green-700">{totalWeight.toFixed(2)} Kg</span>
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
