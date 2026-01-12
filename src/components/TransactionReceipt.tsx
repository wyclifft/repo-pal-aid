import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Printer, X } from 'lucide-react';
import { printReceipt } from '@/services/bluetooth';
import { toast } from 'sonner';
import type { CowDetails } from '@/components/CowDetailsModal';

// Transaction types
export type TransactionType = 1 | 2 | 3; // 1 = Milk/Coffee, 2 = Store, 3 = AI

// Base transaction item interface
export interface TransactionItem {
  reference_no?: string;
  uploadrefno?: string;
  quantity?: number;
  weight?: number;
  price?: number;
  lineTotal?: number;
  item_code?: string;
  item_name?: string;
  cowDetails?: CowDetails;
}

// Unified receipt data interface
export interface ReceiptData {
  transtype: TransactionType;
  transrefno: string;
  uploadrefno?: string;
  companyName: string;
  // Member info
  memberId: string;
  memberName: string;
  memberRoute?: string;
  // Clerk/Collector info
  clerkName: string;
  // Date/Time
  transactionDate: Date;
  // Items/Collections
  items: TransactionItem[];
  // Totals
  totalWeight?: number;
  totalAmount?: number;
  // Optional fields
  session?: string;
  productName?: string;
  cumulativeFrequency?: number;
  showCumulativeFrequency?: boolean;
  locationCode?: string;
  locationName?: string;
  routeLabel?: string;
  periodLabel?: string;
  printCopies?: number;
}

interface TransactionReceiptProps {
  data: ReceiptData | null;
  open: boolean;
  onClose: () => void;
  onPrint?: () => void;
}

// Get receipt title based on transaction type
const getReceiptTitle = (transtype: TransactionType): string => {
  switch (transtype) {
    case 1: return 'CUSTOMER DELIVERY RECEIPT';
    case 2: return 'STORE PURCHASE RECEIPT';
    case 3: return 'AI SERVICE RECEIPT';
    default: return 'TRANSACTION RECEIPT';
  }
};

// Get total label based on transaction type
const getTotalLabel = (transtype: TransactionType): string => {
  switch (transtype) {
    case 1: return 'Total Weight [Kgs]';
    case 2: return 'Total Amount [KES]';
    case 3: return 'Total Amount [KES]';
    default: return 'Total';
  }
};

export const TransactionReceipt = ({ 
  data, 
  open, 
  onClose, 
  onPrint 
}: TransactionReceiptProps) => {
  if (!data) return null;

  const {
    transtype,
    transrefno,
    uploadrefno,
    companyName,
    memberId,
    memberName,
    memberRoute,
    clerkName,
    transactionDate,
    items,
    totalWeight,
    totalAmount,
    session,
    productName,
    cumulativeFrequency,
    showCumulativeFrequency = false,
    locationCode,
    locationName,
    routeLabel = 'Route',
    periodLabel = 'Session',
    printCopies = 1
  } = data;

  const formattedDate = transactionDate.toLocaleDateString('en-CA');
  const formattedTime = transactionDate.toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });

  const handlePrint = async () => {
    if (printCopies === 0) {
      toast.info('Printing disabled (0 copies configured)');
      onPrint?.();
      return;
    }

    // Format collections for printing (works for all types)
    const collections = items.map((item, index) => ({
      index: index + 1,
      weight: item.weight || item.quantity || 0,
      transrefno: item.reference_no || transrefno
    }));

    for (let copy = 0; copy < printCopies; copy++) {
      const result = await printReceipt({
        companyName,
        farmerName: memberName,
        farmerId: memberId,
        route: memberRoute || '',
        routeLabel,
        session: session || '',
        periodLabel,
        productName,
        uploadRefNo: uploadrefno || transrefno,
        collectorName: clerkName,
        collections,
        cumulativeFrequency: showCumulativeFrequency ? cumulativeFrequency : undefined,
        locationCode,
        locationName,
        collectionDate: transactionDate
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

  // Calculate display total
  const displayTotal = transtype === 1 
    ? totalWeight?.toFixed(2) 
    : totalAmount?.toFixed(2);

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
            <p className="text-xs text-muted-foreground">{getReceiptTitle(transtype)}</p>
          </div>

          {/* Member Info - Shared across all types */}
          <div className="space-y-0.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Member NO</span>
              <span className="font-semibold">#{memberId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Member Name</span>
              <span className="font-medium">{memberName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reference NO</span>
              <span className="font-medium">{uploadrefno || transrefno}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span className="font-medium">{formattedDate} {formattedTime}</span>
            </div>
          </div>

          {/* Items/Collections List */}
          <div className="border-t border-b border-dashed py-2 space-y-1">
            {/* Product name for milk/coffee (transtype 1) */}
            {transtype === 1 && productName && (
              <div className="flex justify-between text-xs mb-1 pb-1 border-b border-dashed">
                <span className="text-muted-foreground">Product</span>
                <span className="font-medium">{productName}</span>
              </div>
            )}
            
            {/* Items display varies by type */}
            {items.map((item, index) => (
              <div key={item.reference_no || index} className="space-y-0.5">
                {/* For Milk (transtype 1) - show weight */}
                {transtype === 1 && (
                  <div className="flex justify-between text-xs">
                    <span>{index + 1}: {item.reference_no}</span>
                    <span className="font-medium">{item.weight?.toFixed(1)}</span>
                  </div>
                )}
                
                {/* For Store (transtype 2) - show item name, qty, amount */}
                {transtype === 2 && (
                  <div className="flex justify-between text-xs">
                    <span>{item.item_name} x{item.quantity}</span>
                    <span className="font-medium">KES {item.lineTotal?.toFixed(0)}</span>
                  </div>
                )}
                
                {/* For AI (transtype 3) - show item name, qty, amount + cow details */}
                {transtype === 3 && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span>{item.item_name} x{item.quantity}</span>
                      <span className="font-medium">KES {item.lineTotal?.toFixed(0)}</span>
                    </div>
                    {item.cowDetails && (
                      <div className="text-xs text-muted-foreground pl-2 border-l-2 border-dashed ml-1 space-y-0.5">
                        {item.cowDetails.cowName && (
                          <div>Cow: {item.cowDetails.cowName}</div>
                        )}
                        {item.cowDetails.cowBreed && (
                          <div>Breed: {item.cowDetails.cowBreed}</div>
                        )}
                        {item.cowDetails.numberOfCalves && (
                          <div>Calves: {item.cowDetails.numberOfCalves}</div>
                        )}
                        {item.cowDetails.otherDetails && (
                          <div>Notes: {item.cowDetails.otherDetails}</div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          
          {/* Total - adapts based on transaction type */}
          <div className="border-b border-dashed pb-2">
            <div className="flex justify-between text-sm font-bold">
              <span>{getTotalLabel(transtype)}</span>
              <span>{displayTotal}</span>
            </div>
          </div>

          {/* Footer Info - Shared with optional fields */}
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
            {memberRoute && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Member Region</span>
                <span className="font-medium">{memberRoute}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Clerk Name</span>
              <span className="font-medium">{clerkName}</span>
            </div>
            {session && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{periodLabel}</span>
                <span className="font-medium">{session}</span>
              </div>
            )}
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

// Helper function to convert MilkCollection[] to ReceiptData
export const createMilkReceiptData = (
  receipts: Array<{
    reference_no?: string;
    uploadrefno?: string;
    farmer_id: string;
    farmer_name: string;
    route: string;
    session: string;
    weight: number;
    clerk_name: string;
    collection_date: Date;
    product_name?: string;
  }>,
  companyName: string,
  options?: {
    cumulativeFrequency?: number;
    showCumulativeFrequency?: boolean;
    printCopies?: number;
    routeLabel?: string;
    periodLabel?: string;
    locationCode?: string;
    locationName?: string;
  }
): ReceiptData | null => {
  if (receipts.length === 0) return null;
  
  const first = receipts[0];
  const totalWeight = receipts.reduce((sum, r) => sum + r.weight, 0);
  
  return {
    transtype: 1,
    transrefno: first.reference_no || '',
    uploadrefno: first.uploadrefno,
    companyName,
    memberId: first.farmer_id,
    memberName: first.farmer_name,
    memberRoute: first.route,
    clerkName: first.clerk_name,
    transactionDate: new Date(first.collection_date),
    session: first.session,
    productName: first.product_name,
    items: receipts.map(r => ({
      reference_no: r.reference_no,
      weight: r.weight
    })),
    totalWeight,
    ...options
  };
};

// Helper function to create Store receipt data
export const createStoreReceiptData = (
  cartItems: Array<{
    item: { icode: string; descript: string; sprice: number };
    quantity: number;
    lineTotal: number;
  }>,
  memberInfo: { id: string; name: string; route?: string },
  transactionInfo: { transrefno: string; uploadrefno?: string; clerkName: string },
  companyName: string
): ReceiptData => {
  return {
    transtype: 2,
    transrefno: transactionInfo.transrefno,
    uploadrefno: transactionInfo.uploadrefno,
    companyName,
    memberId: memberInfo.id,
    memberName: memberInfo.name,
    memberRoute: memberInfo.route,
    clerkName: transactionInfo.clerkName,
    transactionDate: new Date(),
    items: cartItems.map(c => ({
      item_code: c.item.icode,
      item_name: c.item.descript,
      quantity: c.quantity,
      price: c.item.sprice,
      lineTotal: c.lineTotal
    })),
    totalAmount: cartItems.reduce((sum, c) => sum + c.lineTotal, 0)
  };
};

// Helper function to create AI receipt data
export const createAIReceiptData = (
  cartItems: Array<{
    item: { icode: string; descript: string; sprice: number };
    quantity: number;
    lineTotal: number;
    cowDetails?: CowDetails;
  }>,
  memberInfo: { id: string; name: string; route?: string },
  transactionInfo: { transrefno: string; uploadrefno?: string; clerkName: string },
  companyName: string
): ReceiptData => {
  return {
    transtype: 3,
    transrefno: transactionInfo.transrefno,
    uploadrefno: transactionInfo.uploadrefno,
    companyName,
    memberId: memberInfo.id,
    memberName: memberInfo.name,
    memberRoute: memberInfo.route,
    clerkName: transactionInfo.clerkName,
    transactionDate: new Date(),
    items: cartItems.map(c => ({
      item_code: c.item.icode,
      item_name: c.item.descript,
      quantity: c.quantity,
      price: c.item.sprice,
      lineTotal: c.lineTotal,
      cowDetails: c.cowDetails
    })),
    totalAmount: cartItems.reduce((sum, c) => sum + c.lineTotal, 0)
  };
};
