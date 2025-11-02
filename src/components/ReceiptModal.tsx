import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MilkCollection } from '@/lib/supabase';
import { FileText, Printer, X } from 'lucide-react';
import { toast } from 'sonner';

interface ReceiptModalProps {
  receipt: MilkCollection | null;
  open: boolean;
  onClose: () => void;
}

export const ReceiptModal = ({ receipt, open, onClose }: ReceiptModalProps) => {
  const handlePrint = () => {
    window.print();
  };

  const handleTestPrint = () => {
    toast.success('Test print initiated');
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Test Receipt</title>
            <style>
              body { font-family: monospace; padding: 20px; }
              table { width: 100%; border-collapse: collapse; }
              th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
              th { font-weight: bold; }
            </style>
          </head>
          <body>
            <h2>📄 Receipt (Test Print)</h2>
            <table>
              <tr><th>Farmer Name</th><td>${receipt.farmer_name}</td></tr>
              <tr><th>Route</th><td>${receipt.route}</td></tr>
              <tr><th>Farmer ID</th><td>${receipt.farmer_id}</td></tr>
              <tr><th>Session</th><td>${receipt.session}</td></tr>
              <tr><th>Weight</th><td>${receipt.weight} Kg</td></tr>
              <tr><th>Collector</th><td>${receipt.clerk_name}</td></tr>
              <tr><th>Date</th><td>${new Date(receipt.collection_date).toLocaleString()}</td></tr>
            </table>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
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
            onClick={handleTestPrint}
            className="flex-1 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-colors flex items-center justify-center gap-2"
          >
            <Printer className="h-4 w-4" />
            Test Print
          </button>
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
