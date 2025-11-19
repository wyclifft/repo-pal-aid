import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MilkCollection } from '@/lib/supabase';
import { FileText, Printer, X } from 'lucide-react';
import { printReceipt } from '@/services/bluetooth';
import { toast } from 'sonner';

interface ReceiptModalProps {
  receipt: MilkCollection | null;
  open: boolean;
  onClose: () => void;
}

export const ReceiptModal = ({ receipt, open, onClose }: ReceiptModalProps) => {
  const handlePrint = async () => {
    if (!receipt) return;

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

    if (result.success) {
      toast.success('Receipt printed successfully');
    } else {
      // If Bluetooth printing fails, fall back to browser print
      if (result.error?.includes('No printer connected')) {
        toast.info('No Bluetooth printer connected. Opening browser print...');
        window.print();
      } else {
        toast.error(result.error || 'Failed to print receipt');
      }
    }
  };

  if (!receipt) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl text-[#667eea]">
            <FileText className="h-6 w-6" />
            Receipt
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
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
