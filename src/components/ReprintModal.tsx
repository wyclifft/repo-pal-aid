import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { MilkCollection } from '@/lib/supabase';
import { Printer, X, Clock, ChevronLeft, ChevronRight, Trash2, Check, Square, CheckSquare, ShoppingCart, Bot, Milk } from 'lucide-react';
import { printReceipt } from '@/services/bluetooth';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface PrintedReceipt {
  farmerId: string;
  farmerName: string;
  collections: MilkCollection[];
  printedAt: Date;
  // Extended fields for Store/AI receipts
  type?: 'milk' | 'store' | 'ai';
  totalAmount?: number;
  itemCount?: number;
  uploadrefno?: string;
}

interface ReprintModalProps {
  open: boolean;
  onClose: () => void;
  receipts: PrintedReceipt[];
  companyName: string;
  printCopies?: number;
  routeLabel?: string;
  periodLabel?: string;
  locationName?: string;
  onDeleteReceipts?: (indices: number[]) => void;
}

const ITEMS_PER_PAGE = 4;

export const ReprintModal = ({ 
  open, 
  onClose, 
  receipts, 
  companyName, 
  printCopies = 1, 
  routeLabel = 'Route', 
  periodLabel = 'Session', 
  locationName,
  onDeleteReceipts 
}: ReprintModalProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [isPrinting, setIsPrinting] = useState<string | null>(null);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<number>>(new Set());
  
  const totalPages = Math.ceil(receipts.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedReceipts = receipts.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const handleReprint = async (receipt: PrintedReceipt) => {
    if (receipt.collections.length === 0) return;
    
    if (printCopies === 0) {
      toast.info('Printing disabled (0 copies configured)');
      return;
    }
    
    setIsPrinting(receipt.farmerId);

    const firstReceipt = receipt.collections[0];
    const collectionDateTime = new Date(firstReceipt.collection_date);
    
    const collections = receipt.collections.map((r, index) => ({
      index: index + 1,
      weight: r.weight,
      transrefno: r.reference_no
    }));

    try {
      for (let copy = 0; copy < printCopies; copy++) {
        const result = await printReceipt({
          companyName: companyName,
          farmerName: firstReceipt.farmer_name,
          farmerId: firstReceipt.farmer_id,
          route: firstReceipt.route,
          routeLabel: routeLabel,
          session: firstReceipt.session,
          uploadRefNo: receipt.uploadrefno || firstReceipt.uploadrefno || firstReceipt.reference_no,
          collectorName: firstReceipt.clerk_name,
          collections,
          locationName: locationName || firstReceipt.route,
          collectionDate: collectionDateTime
        });

        if (!result.success) {
          if (result.error?.includes('No printer connected')) {
            toast.info('No Bluetooth printer connected. Opening browser print...');
            window.print();
            break;
          } else {
            toast.error(result.error || 'Failed to reprint receipt');
            break;
          }
        } else if (copy === printCopies - 1) {
          toast.success(`Receipt reprinted (${printCopies} ${printCopies === 1 ? 'copy' : 'copies'})`);
        }
        
        if (copy < printCopies - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (error) {
      console.error('Reprint error:', error);
      toast.error('Failed to reprint receipt');
    } finally {
      setIsPrinting(null);
    }
  };

  const getTotalWeight = (collections: MilkCollection[]) => {
    return collections.reduce((sum, r) => sum + r.weight, 0);
  };

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const toggleDeleteMode = () => {
    setIsDeleteMode(!isDeleteMode);
    setSelectedForDelete(new Set());
  };

  const toggleSelectReceipt = (globalIndex: number) => {
    const newSelected = new Set(selectedForDelete);
    if (newSelected.has(globalIndex)) {
      newSelected.delete(globalIndex);
    } else {
      newSelected.add(globalIndex);
    }
    setSelectedForDelete(newSelected);
  };

  const selectAllOnPage = () => {
    const newSelected = new Set(selectedForDelete);
    paginatedReceipts.forEach((_, idx) => {
      newSelected.add(startIndex + idx);
    });
    setSelectedForDelete(newSelected);
  };

  const handleDeleteSelected = () => {
    if (selectedForDelete.size === 0) {
      toast.error('No receipts selected');
      return;
    }
    
    if (onDeleteReceipts) {
      onDeleteReceipts(Array.from(selectedForDelete));
      toast.success(`Deleted ${selectedForDelete.size} receipt${selectedForDelete.size !== 1 ? 's' : ''}`);
    }
    
    setSelectedForDelete(new Set());
    setIsDeleteMode(false);
    setCurrentPage(1);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setCurrentPage(1);
      setIsDeleteMode(false);
      setSelectedForDelete(new Set());
      onClose();
    }
  };

  const getReceiptTypeIcon = (type?: string) => {
    switch (type) {
      case 'store': return <ShoppingCart className="h-3 w-3" />;
      case 'ai': return <Bot className="h-3 w-3" />;
      default: return <Milk className="h-3 w-3" />;
    }
  };

  const getReceiptTypeLabel = (type?: string) => {
    switch (type) {
      case 'store': return 'Store';
      case 'ai': return 'AI';
      default: return 'Milk';
    }
  };

  const getReceiptTypeBg = (type?: string) => {
    switch (type) {
      case 'store': return 'bg-orange-50 border-orange-200';
      case 'ai': return 'bg-purple-50 border-purple-200';
      default: return 'bg-card';
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[95vw] max-w-md mx-auto p-4 sm:p-6 max-h-[90vh] flex flex-col">
        <DialogHeader className="pb-2 flex-shrink-0">
          <DialogTitle className="text-base sm:text-lg font-semibold flex items-center justify-between">
            <span>Recent Receipts</span>
            <div className="flex items-center gap-2">
              {receipts.length > 0 && (
                <span className="text-xs sm:text-sm font-normal text-muted-foreground">
                  {receipts.length} total
                </span>
              )}
              {onDeleteReceipts && receipts.length > 0 && (
                <button
                  onClick={toggleDeleteMode}
                  className={`p-2 rounded-md transition-colors ${
                    isDeleteMode 
                      ? 'bg-destructive text-destructive-foreground' 
                      : 'hover:bg-accent'
                  }`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Delete mode toolbar */}
        {isDeleteMode && (
          <div className="flex items-center justify-between p-2 bg-destructive/10 rounded-lg mb-2">
            <div className="flex items-center gap-2">
              <button
                onClick={selectAllOnPage}
                className="text-xs px-2 py-1 bg-secondary rounded hover:bg-secondary/80"
              >
                Select Page
              </button>
              <span className="text-sm text-muted-foreground">
                {selectedForDelete.size} selected
              </span>
            </div>
            <button
              onClick={handleDeleteSelected}
              disabled={selectedForDelete.size === 0}
              className="px-3 py-1 bg-destructive text-destructive-foreground rounded text-sm font-medium
                       hover:bg-destructive/90 disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        )}

        {/* Scrollable receipt list */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-2 sm:space-y-3 -mx-1 px-1">
          {receipts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No recent receipts to display
            </div>
          ) : (
            paginatedReceipts.map((receipt, index) => {
              const globalIndex = startIndex + index;
              const isSelected = selectedForDelete.has(globalIndex);
              
              return (
                <div
                  key={globalIndex}
                  className={`border rounded-lg p-3 space-y-2 transition-colors ${getReceiptTypeBg(receipt.type)} ${
                    isDeleteMode && isSelected ? 'ring-2 ring-destructive' : ''
                  }`}
                  onClick={isDeleteMode ? () => toggleSelectReceipt(globalIndex) : undefined}
                >
                  {/* Header: Farmer info + Weight/Amount */}
                  <div className="flex justify-between items-start gap-2">
                    {isDeleteMode && (
                      <div className="flex-shrink-0 pt-1">
                        {isSelected ? (
                          <CheckSquare className="h-5 w-5 text-destructive" />
                        ) : (
                          <Square className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm sm:text-base truncate">{receipt.farmerName}</div>
                      <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-2">
                        <span>{receipt.farmerId}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted flex items-center gap-1">
                          {getReceiptTypeIcon(receipt.type)}
                          {getReceiptTypeLabel(receipt.type)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {receipt.type === 'store' || receipt.type === 'ai' ? (
                        <>
                          <div className="font-bold text-base sm:text-lg">
                            KES{(receipt.totalAmount || 0).toLocaleString()}
                          </div>
                          <div className="text-[10px] sm:text-xs text-muted-foreground">
                            {receipt.itemCount || receipt.collections.length} item{(receipt.itemCount || receipt.collections.length) !== 1 ? 's' : ''}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="font-bold text-base sm:text-lg">{getTotalWeight(receipt.collections).toFixed(1)} Kg</div>
                          <div className="text-[10px] sm:text-xs text-muted-foreground">{receipt.collections.length} collections</div>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Timestamp + Reference */}
                  <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{format(new Date(receipt.printedAt), 'MMM dd, HH:mm')}</span>
                    </div>
                    {receipt.uploadrefno && (
                      <span className="font-mono text-[10px] truncate max-w-[100px]">
                        {receipt.uploadrefno}
                      </span>
                    )}
                  </div>

                  {/* Reprint Button - Only show when not in delete mode */}
                  {!isDeleteMode && (
                    <button
                      onClick={() => handleReprint(receipt)}
                      disabled={isPrinting !== null}
                      className="w-full py-3 sm:py-2 bg-primary text-primary-foreground rounded-md font-medium 
                               hover:bg-primary/90 active:bg-primary/80 transition-colors 
                               flex items-center justify-center gap-2 min-h-[44px]
                               disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Printer className="h-4 w-4" />
                      {isPrinting === receipt.farmerId ? 'Printing...' : 'Reprint'}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-3 border-t flex-shrink-0">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-3 rounded-md hover:bg-accent active:bg-accent/80 
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                       min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            
            <div className="flex items-center gap-1">
              {totalPages <= 5 ? (
                Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => goToPage(page)}
                    className={`min-w-[36px] min-h-[36px] rounded-md text-sm font-medium transition-colors
                              flex items-center justify-center ${
                      page === currentPage
                        ? 'bg-primary text-primary-foreground'
                        : 'hover:bg-accent active:bg-accent/80'
                    }`}
                  >
                    {page}
                  </button>
                ))
              ) : (
                <span className="text-sm font-medium px-2">
                  {currentPage} / {totalPages}
                </span>
              )}
            </div>
            
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-3 rounded-md hover:bg-accent active:bg-accent/80 
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                       min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Close button */}
        <div className="flex justify-end pt-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-3 bg-secondary text-secondary-foreground rounded-md font-medium 
                     hover:bg-secondary/80 active:bg-secondary/70 transition-colors 
                     flex items-center gap-2 min-h-[44px]"
          >
            <X className="h-4 w-4" />
            Close
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
