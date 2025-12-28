import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MilkCollection } from '@/lib/supabase';
import { Printer, X, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
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
  routeLabel?: string;
}

const ITEMS_PER_PAGE = 5;

export const ReprintModal = ({ open, onClose, receipts, companyName, printCopies = 1, routeLabel = 'Route' }: ReprintModalProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  
  const totalPages = Math.ceil(receipts.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedReceipts = receipts.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handleReprint = async (receipt: PrintedReceipt) => {
    if (receipt.collections.length === 0) return;

    const firstReceipt = receipt.collections[0];
    
    const collections = receipt.collections.map(r => ({
      time: new Date(r.collection_date).toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      weight: r.weight,
      transrefno: r.reference_no
    }));

    const result = await printReceipt({
      companyName: companyName,
      farmerName: firstReceipt.farmer_name,
      farmerId: firstReceipt.farmer_id,
      route: firstReceipt.route,
      routeLabel: routeLabel,
      session: firstReceipt.session,
      uploadRefNo: firstReceipt.uploadrefno || firstReceipt.reference_no,
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

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg font-semibold flex items-center justify-between">
            <span>Recent Receipts</span>
            {receipts.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                {receipts.length} total
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
          {receipts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No recent receipts to display
            </div>
          ) : (
            paginatedReceipts.map((receipt, index) => (
              <div
                key={startIndex + index}
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

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2 border-t">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-2 rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  onClick={() => goToPage(page)}
                  className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${
                    page === currentPage
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-accent'
                  }`}
                >
                  {page}
                </button>
              ))}
            </div>
            
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-2 rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

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
