import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MilkCollection } from '@/lib/supabase';

interface ReceiptModalProps {
  receipt: MilkCollection | null;
  open: boolean;
  onClose: () => void;
}

export const ReceiptModal = ({ receipt, open, onClose }: ReceiptModalProps) => {
  const handlePrint = () => {
    window.print();
  };

  if (!receipt) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl text-[#667eea]">🧾 Receipt</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <table className="w-full">
            <tbody>
              <tr className="border-b">
                <th className="text-left py-2 font-semibold">Farmer</th>
                <td className="py-2">{receipt.farmer_id}</td>
              </tr>
              <tr className="border-b">
                <th className="text-left py-2 font-semibold">Route</th>
                <td className="py-2">{receipt.route}</td>
              </tr>
              <tr className="border-b">
                <th className="text-left py-2 font-semibold">Section</th>
                <td className="py-2">{receipt.section}</td>
              </tr>
              <tr className="border-b">
                <th className="text-left py-2 font-semibold">Weight</th>
                <td className="py-2">{receipt.weight} Kg</td>
              </tr>
              <tr className="border-b">
                <th className="text-left py-2 font-semibold">Rate</th>
                <td className="py-2">Ksh {receipt.price_per_liter}</td>
              </tr>
              <tr className="border-b">
                <th className="text-left py-2 font-semibold">Total</th>
                <td className="py-2 font-bold">Ksh {receipt.total_amount}</td>
              </tr>
              <tr className="border-b">
                <th className="text-left py-2 font-semibold">Collector</th>
                <td className="py-2">{receipt.collected_by}</td>
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
            className="flex-1 py-2 bg-[#667eea] text-white rounded-lg font-semibold hover:bg-[#5568d3] transition-colors"
          >
            Print
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
