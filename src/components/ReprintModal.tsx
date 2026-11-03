import { useState, useMemo, useEffect } from 'react';
import { formatWeight, roundWeight } from '@/utils/weightUtils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import type { Farmer, MilkCollection } from '@/lib/supabase';
import { Printer, X, Clock, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ShoppingCart, Bot, Milk, Search, List, RefreshCw, Check, Coffee, Beef, Calendar } from 'lucide-react';
import { printReceipt, printStoreAIReceipt } from '@/services/bluetooth';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useAppSettings } from '@/hooks/useAppSettings';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { resolveMemberName } from '@/utils/farmerUtils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { CowDetails } from '@/components/CowDetailsModal';
import { TransactionReceipt, createMilkReceiptData, createStoreReceiptData, createAIReceiptData } from './TransactionReceipt';

// Store/AI item interface for reprinting
export interface ReprintItem {
  item_code: string;
  item_name: string;
  quantity: number;
  price: number;
  lineTotal: number;
  cowDetails?: CowDetails;
}

export interface PrintedReceipt {
  farmerId: string;
  farmerName: string;
  collections: MilkCollection[];
  printedAt: Date;
  // Extended fields for Store/AI receipts
  type?: 'milk' | 'store' | 'ai';
  totalAmount?: number;
  itemCount?: number;
  uploadrefno?: string;
  // Store/AI specific fields for reprinting
  items?: ReprintItem[];
  clerkName?: string;
  memberRoute?: string;
  transactionDate?: Date;
  // Metadata for context preservation
  routeLabel?: string;
  periodLabel?: string;
  locationName?: string;
  locationCode?: string;
  productName?: string;
  // Cumulative weight for milk/coffee receipts
  cumulativeWeight?: number;
  cumulativeByProduct?: Array<{ icode: string; product_name: string; weight: number }>;
  // v2.10.66: stable local identity for Store/AI receipts so a repeated
  // uploadrefno (e.g. after a counter rollback when downgrading then
  // re-upgrading) cannot suppress a brand-new receipt from Recent Receipts.
  // Legacy entries without these fields keep working via fallback matching.
  localReceiptId?: string;
  itemRefs?: string[];
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
  locationName
}: ReprintModalProps) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [isPrinting, setIsPrinting] = useState<string | null>(null);
  // Track sync state per collection by reference number
  const [syncingCollections, setSyncingCollections] = useState<Set<string>>(new Set());
  const [syncedCollections, setSyncedCollections] = useState<Set<string>>(new Set());
  const [failedCollections, setFailedCollections] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'recent' | 'search'>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [jumpPageInput, setJumpPageInput] = useState<string>('');
  // On-screen receipt viewing (for printCopies=0)
  const [viewingReceipt, setViewingReceipt] = useState<PrintedReceipt | null>(null);
  
  const { getFarmers, isReady } = useIndexedDB();
  const { settings, showProductName, storePrintCopies } = useAppSettings();
  const [allFarmers, setAllFarmers] = useState<Farmer[]>([]);

  // Load all farmers for name resolution
  useEffect(() => {
    if (isReady) {
      getFarmers().then(setAllFarmers).catch(() => {});
    }
  }, [isReady, getFarmers]);

  // Filter receipts based on search query and selected calendar date
  const filteredReceipts = useMemo(() => {
    let result = receipts;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(receipt =>
        receipt.farmerId.toLowerCase().includes(query) ||
        receipt.farmerName.toLowerCase().includes(query) ||
        (receipt.uploadrefno && receipt.uploadrefno.toLowerCase().includes(query))
      );
    }

    if (selectedDate) {
      result = result.filter(receipt => {
        const receiptDate = new Date(
          receipt.transactionDate ||
          (receipt.collections?.[0]?.collection_date ? receipt.collections[0].collection_date : receipt.printedAt)
        );
        const receiptDateStr = format(receiptDate, 'yyyy-MM-dd');
        return receiptDateStr === selectedDate;
      });
    }

    return result;
  }, [receipts, searchQuery, selectedDate]);

  // Use filtered receipts for search tab, all receipts for recent tab (but respecting date filter if set)
  const displayReceipts = useMemo(() => {
    if (activeTab === 'search') {
      return filteredReceipts;
    }
    if (selectedDate) {
      return receipts.filter(receipt => {
        const receiptDate = new Date(
          receipt.transactionDate ||
          (receipt.collections?.[0]?.collection_date ? receipt.collections[0].collection_date : receipt.printedAt)
        );
        return format(receiptDate, 'yyyy-MM-dd') === selectedDate;
      });
    }
    return receipts;
  }, [activeTab, filteredReceipts, receipts, selectedDate]);
  
  const totalPages = Math.ceil(displayReceipts.length / ITEMS_PER_PAGE) || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedReceipts = displayReceipts.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  // v2.12.12: Handle hardware back button to close modal
  useEffect(() => {
    if (!open) return;

    const handleBackButton = (e: Event) => {
      if (!viewingReceipt) {
        e.preventDefault();
        onClose();
        console.log('[BACK] Intercepted in ReprintModal: closing modal');
      }
    };

    window.addEventListener('ionBackButton', handleBackButton);
    return () => window.removeEventListener('ionBackButton', handleBackButton);
  }, [open, onClose, viewingReceipt]);

  const handleReprint = async (receipt: PrintedReceipt) => {
    const hasData = (receipt.type === 'store' || receipt.type === 'ai')
      ? (receipt.items && receipt.items.length > 0)
      : (receipt.collections && receipt.collections.length > 0);
    
    if (!hasData) {
      toast.error('No data available to reprint');
      return;
    }
    
    if (printCopies === 0) {
      setViewingReceipt(receipt);
      return;
    }
    
    setIsPrinting(receipt.farmerId);

    try {
      if ((receipt.type === 'store' || receipt.type === 'ai') && receipt.items) {
        const transactionDate = receipt.transactionDate 
          ? new Date(receipt.transactionDate) 
          : new Date(receipt.printedAt);
        
        // Recent receipt reprinting for Store/AI prints 1 copy regardless of store_print_copies > 1
        const effectiveCopies = 1;

        for (let copy = 0; copy < effectiveCopies; copy++) {
          const result = await printStoreAIReceipt({
            companyName: companyName,
            memberName: receipt.farmerName,
            memberId: receipt.farmerId,
            memberRoute: receipt.memberRoute,
            routeLabel: receipt.routeLabel || routeLabel,
            uploadRefNo: receipt.uploadrefno || '',
            clerkName: receipt.clerkName || 'Unknown',
            items: receipt.items,
            totalAmount: receipt.totalAmount || 0,
            transactionDate,
            receiptType: receipt.type as 'store' | 'ai',
            reprintedAt: new Date(),
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
          } else if (copy === effectiveCopies - 1) {
            toast.success(`Receipt reprinted (${effectiveCopies} ${effectiveCopies === 1 ? 'copy' : 'copies'})`);
          }
          
          if (copy < effectiveCopies - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
      } else {
        const firstReceipt = receipt.collections[0];
        const collectionDateTime = new Date(firstReceipt.collection_date);
        
        const collections = receipt.collections.map((r, index) => ({
          index: index + 1,
          weight: r.weight,
          transrefno: r.reference_no
        }));

        const isSellProduce = firstReceipt.transtype === 2;

        for (let copy = 0; copy < printCopies; copy++) {
          const result = await printReceipt({
            companyName: companyName,
            farmerName: firstReceipt.farmer_name,
            farmerId: firstReceipt.farmer_id,
            route: firstReceipt.route || receipt.locationCode || '',
            memberRoute: receipt.memberRoute || '',
            routeLabel: receipt.routeLabel || routeLabel,
            session: firstReceipt.session_descript || firstReceipt.session,
            periodLabel: receipt.periodLabel || periodLabel,
            productName: receipt.productName || firstReceipt.product_name,
            uploadRefNo: receipt.uploadrefno || firstReceipt.uploadrefno || firstReceipt.reference_no,
            collectorName: firstReceipt.clerk_name,
            deliveredBy: resolveMemberName(firstReceipt.delivered_by, allFarmers),
            collections,
            cumulativeFrequency: isSellProduce ? undefined : receipt.cumulativeWeight,
            cumulativeByProduct: isSellProduce ? undefined : receipt.cumulativeByProduct,
            locationCode: receipt.locationCode,
            locationName: receipt.locationName || locationName || firstReceipt.route,
            collectionDate: collectionDateTime,
            reprintedAt: new Date(),
            receiptTitle: isSellProduce ? 'PURCHASE RECEIPT' : undefined,
            totalLabel: isSellProduce ? 'Total Weight [Kgs]' : undefined,
            orgtype: settings.orgtype,
            showProductName,
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
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
      }
    } catch (error) {
      console.error('Reprint error:', error);
      toast.error('Failed to reprint receipt');
    } finally {
      setIsPrinting(null);
    }
  };

  const confirmExactOnBackend = async (
    referenceNo: string,
    expected: { dateISO: string; farmerId: string }
  ): Promise<{ confirmed: boolean; mismatchReason?: 'not_found' | 'date_mismatch' | 'farmer_mismatch' }> => {
    try {
      const found = await mysqlApi.milkCollection.getByReference(referenceNo);
      if (!found) return { confirmed: false, mismatchReason: 'not_found' };

      const foundDateISO = found.collection_date
        ? new Date(found.collection_date).toISOString().split('T')[0]
        : null;
      const foundFarmerId = (found.farmer_id || '').replace(/^#/, '').trim();
      const expectedFarmerId = expected.farmerId.replace(/^#/, '').trim();

      if (foundDateISO && foundDateISO !== expected.dateISO) {
        return { confirmed: false, mismatchReason: 'date_mismatch' };
      }

      if (foundFarmerId && expectedFarmerId && foundFarmerId !== expectedFarmerId) {
        return { confirmed: false, mismatchReason: 'farmer_mismatch' };
      }

      return { confirmed: true };
    } catch (err) {
      return { confirmed: false, mismatchReason: 'not_found' };
    }
  };

  const isDuplicateLike = (msg?: string): boolean => {
    const errorMsg = (msg || '').toLowerCase();
    return errorMsg.includes('duplicate') || errorMsg.includes('already exists') || errorMsg.includes('unique');
  };

  const handleSyncCollection = async (collection: MilkCollection) => {
    const refNo = collection.reference_no;
    
    if (!refNo) {
      toast.error('Record has no reference number - cannot sync');
      return;
    }

    if (!navigator.onLine) {
      toast.error('You are offline. Please connect to sync.');
      return;
    }

    if (syncingCollections.has(refNo)) {
      return;
    }

    setSyncingCollections(prev => new Set(prev).add(refNo));
    setFailedCollections(prev => {
      const next = new Set(prev);
      next.delete(refNo);
      return next;
    });

    try {
      const deviceFingerprint = await generateDeviceFingerprint();
      const expected = {
        dateISO: new Date(collection.collection_date).toISOString().split('T')[0],
        farmerId: collection.farmer_id.replace(/^#/, '').trim(),
      };

      const normalizedSession = String(collection.session || '').trim() || 'AM';

      const submitOnce = async (referenceNoToUse: string) => {
        return mysqlApi.milkCollection.create({
          reference_no: referenceNoToUse,
          uploadrefno: collection.uploadrefno || referenceNoToUse,
          farmer_id: expected.farmerId,
          farmer_name: collection.farmer_name.trim(),
          route: (collection.route || '').trim(),
          session: normalizedSession,
          weight: collection.weight,
          user_id: collection.user_id,
          clerk_name: collection.clerk_name,
          collection_date: new Date(collection.collection_date),
          transdate: collection.transdate,
          device_fingerprint: deviceFingerprint,
          entry_type: (collection.entry_type as 'scale' | 'manual') || 'manual',
          product_code: collection.product_code,
          season_code: collection.season_code,
          milk_session_id: collection.milk_session_id,
          transtype: collection.transtype || 1,
        });
      };

      const result1 = await submitOnce(refNo);
      const duplicateLike1 = isDuplicateLike(result1.error || result1.message);
      const apiOk1 = result1.success || duplicateLike1;

      const refCandidates1 = Array.from(
        new Set(
          [result1.reference_no, result1.existing_reference, refNo]
            .map(v => (v || '').trim())
            .filter(Boolean)
        )
      );

      let confirmed = false;
      let mismatch: 'not_found' | 'date_mismatch' | 'farmer_mismatch' | undefined;
      if (apiOk1) {
        for (const candidate of refCandidates1) {
          const check = await confirmExactOnBackend(candidate, expected);
          if (check.confirmed) {
            confirmed = true;
            break;
          }
          mismatch = check.mismatchReason;
        }
      }

      if (!confirmed && mismatch === 'date_mismatch') {
        const nextRefResp = await mysqlApi.milkCollection.getNextReference(deviceFingerprint);
        const newRef = (nextRefResp.data?.reference_no || '').trim();
        if (newRef) {
          const result2 = await submitOnce(newRef);
          const duplicateLike2 = isDuplicateLike(result2.error || result2.message);
          const apiOk2 = result2.success || duplicateLike2;
          if (apiOk2) {
            confirmed = (await confirmExactOnBackend(newRef, expected)).confirmed;
            if (confirmed) {
              toast.success(`Record synced (new ref ${newRef})`);
            }
          }
        }
      }

      if (confirmed) {
        setSyncedCollections(prev => new Set(prev).add(refNo));
        toast.success(`Record synced (${refNo})`);
      } else {
        setFailedCollections(prev => new Set(prev).add(refNo));
        toast.error('Sync not confirmed on server');
      }
    } catch (err: any) {
      const errorMsg = (err?.message || '').toLowerCase();
      const duplicateLike = errorMsg.includes('duplicate') || errorMsg.includes('already exists');
      const expected = {
        dateISO: new Date(collection.collection_date).toISOString().split('T')[0],
        farmerId: collection.farmer_id.replace(/^#/, '').trim(),
      };
      const confirmed = duplicateLike ? (await confirmExactOnBackend(refNo, expected)).confirmed : false;
      
      if (confirmed) {
        setSyncedCollections(prev => new Set(prev).add(refNo));
        toast.success(`Record synced (${refNo})`);
      } else {
        setFailedCollections(prev => new Set(prev).add(refNo));
        toast.error(`Sync failed`);
      }
    } finally {
      setSyncingCollections(prev => {
        const next = new Set(prev);
        next.delete(refNo);
        return next;
      });
    }
  };

  const handleSyncAllCollections = async (receipt: PrintedReceipt) => {
    if (!navigator.onLine) {
      toast.error('You are offline. Please connect to sync.');
      return;
    }

    if (!receipt.collections || receipt.collections.length === 0) {
      toast.error('No records to sync');
      return;
    }

    for (let i = 0; i < receipt.collections.length; i++) {
      const collection = receipt.collections[i];
      const refNo = collection.reference_no;
      if (refNo && !syncedCollections.has(refNo)) {
        await handleSyncCollection(collection);
        if (i < receipt.collections.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  };

  const getTotalWeight = (collections: MilkCollection[]) => {
    return roundWeight(collections.reduce((sum, r) => sum + (Number(r.weight) || 0), 0), 3);
  };

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const handleJumpToPage = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(jumpPageInput, 10);
    if (!isNaN(pageNum)) {
      goToPage(pageNum);
      setJumpPageInput('');
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setCurrentPage(1);
      setActiveTab('recent');
      setSearchQuery('');
      setSelectedDate('');
      setJumpPageInput('');
      onClose();
    }
  };

  const isCoffeeReceipt = (receipt: PrintedReceipt) => {
    return receipt.collections?.some(c => c.gross_weight !== undefined && c.gross_weight !== null);
  };

  const getReceiptTypeIcon = (type?: string, receipt?: PrintedReceipt) => {
    switch (type) {
      case 'store': return <ShoppingCart className="h-3 w-3" />;
      case 'ai': return <Beef className="h-3 w-3" />;
      default: return receipt && isCoffeeReceipt(receipt) ? <Coffee className="h-3 w-3" /> : <Milk className="h-3 w-3" />;
    }
  };

  const getReceiptTypeLabel = (type?: string, receipt?: PrintedReceipt) => {
    switch (type) {
      case 'store': return 'Store';
      case 'ai': return 'AI';
      default: return receipt && isCoffeeReceipt(receipt) ? 'Coffee' : 'Milk';
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
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[95vw] max-w-md mx-auto p-4 sm:p-6 max-h-[90vh] flex flex-col" hideCloseButton>
        <DialogHeader className="pb-2 flex-shrink-0">
          <DialogTitle className="text-base sm:text-lg font-semibold flex items-center justify-between">
            <span>Recent Receipts</span>
            <div className="flex items-center gap-3">
              {receipts.length > 0 && (
                <span className="text-xs sm:text-sm font-normal text-muted-foreground">
                  {displayReceipts.length} total {selectedDate && `(filtered)`}
                </span>
              )}
              <button
                onClick={onClose}
                className="p-2 rounded-md hover:bg-accent transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Tabs for Recent / Search */}
        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as 'recent' | 'search'); setCurrentPage(1); }} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2 mb-2 flex-shrink-0">
            <TabsTrigger value="recent" className="flex items-center gap-1.5">
              <List className="h-4 w-4" />
              Recent
            </TabsTrigger>
            <TabsTrigger value="search" className="flex items-center gap-1.5">
              <Search className="h-4 w-4" />
              Search
            </TabsTrigger>
          </TabsList>

          {/* Calendar Date Filter Bar */}
          <div className="flex items-center gap-2 mb-2 p-2 bg-slate-50 rounded-lg border flex-shrink-0 text-xs">
            <Calendar className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="font-medium text-slate-700">Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2 py-1 bg-white border rounded text-xs flex-1 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {selectedDate && (
              <button
                onClick={() => {
                  setSelectedDate('');
                  setCurrentPage(1);
                }}
                className="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {/* Search input - only visible on search tab */}
          {activeTab === 'search' && (
            <div className="mb-2 flex-shrink-0">
              <Input
                placeholder="Search by ID, name, or reference..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="w-full"
              />
            </div>
          )}

          {/* Scrollable receipt list */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-2 sm:space-y-3 -mx-1 px-1 pb-32 sm:pb-8">
            {displayReceipts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {selectedDate ? `No receipts found for date ${selectedDate}` : activeTab === 'search' && searchQuery ? 'No receipts match your search' : 'No recent receipts to display'}
              </div>
            ) : (
            paginatedReceipts.map((receipt, index) => {
              const globalIndex = startIndex + index;

              return (
                <div
                  key={globalIndex}
                  className={`border rounded-lg p-3 space-y-2 transition-colors ${getReceiptTypeBg(receipt.type)}`}
                >
                  {/* Header: Farmer info + Weight/Amount */}
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm sm:text-base truncate">{receipt.farmerName}</div>
                      <div className="text-xs sm:text-sm text-muted-foreground flex items-center gap-2">
                        <span>{receipt.farmerId}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted flex items-center gap-1">
                          {getReceiptTypeIcon(receipt.type, receipt)}
                          {getReceiptTypeLabel(receipt.type, receipt)}
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
                          <div className="font-bold text-base sm:text-lg">{formatWeight(getTotalWeight(receipt.collections))} Kg</div>
                          <div className="text-[10px] sm:text-xs text-muted-foreground">{receipt.collections.length} collections</div>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Transaction Date + Printed On + Reference */}
                  <div className="flex flex-col gap-0.5 text-[10px] sm:text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>
                        Date: {format(
                          new Date(
                            receipt.transactionDate ||
                            (receipt.collections?.[0]?.collection_date ? receipt.collections[0].collection_date : receipt.printedAt)
                          ),
                          'MMM dd, yyyy'
                        )}
                      </span>
                      {receipt.uploadrefno && (
                        <span className="font-mono text-[10px] truncate max-w-[100px]">
                          {receipt.uploadrefno}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 flex-shrink-0" />
                      <span>Printed: {format(new Date(receipt.printedAt), 'MMM dd, HH:mm:ss')}</span>
                    </div>
                  </div>

                  {/* Cumulative + Delivered By - only for milk/coffee receipts */}
                  {(!receipt.type || receipt.type === 'milk') && receipt.collections?.length > 0 && (
                    <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground">
                      {receipt.collections[0]?.delivered_by && (
                        <span>Delivered By: <span className="font-medium text-foreground">{resolveMemberName(receipt.collections[0].delivered_by, allFarmers)}</span></span>
                      )}
                      {receipt.cumulativeWeight !== undefined && receipt.cumulativeWeight !== null && receipt.cumulativeWeight > 0 && (
                        <span>Cumulative: <span className="font-medium text-foreground">{receipt.cumulativeWeight} Kg</span></span>
                      )}
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleReprint(receipt)}
                      disabled={isPrinting !== null || syncingCollections.size > 0}
                      className="flex-1 py-3 sm:py-2 bg-primary text-primary-foreground rounded-md font-medium
                               hover:bg-primary/90 active:bg-primary/80 transition-colors
                               flex items-center justify-center gap-2 min-h-[44px]
                               disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Printer className="h-4 w-4" />
                      {isPrinting === receipt.farmerId ? 'Printing...' : 'Reprint'}
                    </button>
                    {/* Sync All button - only for milk receipts */}
                    {(!receipt.type || receipt.type === 'milk') && receipt.collections && (
                      <button
                        onClick={() => handleSyncAllCollections(receipt)}
                        disabled={isPrinting !== null || syncingCollections.size > 0}
                        className={`py-3 sm:py-2 px-3 rounded-md font-medium
                                 transition-colors flex items-center justify-center gap-2 min-h-[44px]
                                 disabled:opacity-50 disabled:cursor-not-allowed ${
                                   receipt.collections.every(c => syncedCollections.has(c.reference_no || ''))
                                     ? 'bg-green-500 text-white'
                                     : receipt.collections.some(c => failedCollections.has(c.reference_no || ''))
                                     ? 'bg-red-500 text-white hover:bg-red-600'
                                     : 'bg-amber-500 text-white hover:bg-amber-600'
                                 }`}
                        title={
                          receipt.collections.every(c => syncedCollections.has(c.reference_no || ''))
                            ? 'All synced'
                            : 'Sync all to database'
                        }
                      >
                        {receipt.collections.every(c => syncedCollections.has(c.reference_no || '')) ? (
                          <Check className="h-4 w-4" />
                        ) : syncingCollections.size > 0 && receipt.collections.some(c => syncingCollections.has(c.reference_no || '')) ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          </div>
        </Tabs>

        {/* Enhanced Fast Pagination Controls */}
        {totalPages > 1 && (
          <div className="pt-3 border-t flex flex-col gap-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              {/* First Page Button */}
              <button
                onClick={() => goToPage(1)}
                disabled={currentPage === 1}
                title="First Page"
                className="p-2 rounded-md hover:bg-accent active:bg-accent/80
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                         min-w-[36px] min-h-[36px] flex items-center justify-center text-xs font-semibold"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>

              {/* Prev Page Button */}
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                title="Previous Page"
                className="p-2 rounded-md hover:bg-accent active:bg-accent/80
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                         min-w-[36px] min-h-[36px] flex items-center justify-center"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-1">
                {totalPages <= 5 ? (
                  Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => goToPage(page)}
                      className={`min-w-[32px] min-h-[32px] rounded-md text-xs font-medium transition-colors
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
                  <span className="text-xs font-semibold px-2">
                    Page {currentPage} of {totalPages}
                  </span>
                )}
              </div>

              {/* Next Page Button */}
              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                title="Next Page"
                className="p-2 rounded-md hover:bg-accent active:bg-accent/80
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                         min-w-[36px] min-h-[36px] flex items-center justify-center"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              {/* Last Page Button */}
              <button
                onClick={() => goToPage(totalPages)}
                disabled={currentPage === totalPages}
                title="Last Page"
                className="p-2 rounded-md hover:bg-accent active:bg-accent/80
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                         min-w-[36px] min-h-[36px] flex items-center justify-center text-xs font-semibold"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>

            {/* Direct Jump-to-Page Input */}
            {totalPages > 5 && (
              <form onSubmit={handleJumpToPage} className="flex items-center justify-center gap-2 text-xs">
                <span className="text-muted-foreground">Jump to page:</span>
                <input
                  type="number"
                  min="1"
                  max={totalPages}
                  value={jumpPageInput}
                  onChange={(e) => setJumpPageInput(e.target.value)}
                  placeholder={`1-${totalPages}`}
                  className="w-16 px-2 py-1 text-center border rounded focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                />
                <button
                  type="submit"
                  className="px-2 py-1 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90"
                >
                  Go
                </button>
              </form>
            )}
          </div>
        )}

      </DialogContent>
    </Dialog>

    {/* On-screen receipt viewer for printCopies=0 */}
    {viewingReceipt && (() => {
      if ((viewingReceipt.type === 'store' || viewingReceipt.type === 'ai') && viewingReceipt.items) {
        const createFn = viewingReceipt.type === 'store' ? createStoreReceiptData : createAIReceiptData;
        const storedDate = viewingReceipt.transactionDate
          ? new Date(viewingReceipt.transactionDate) 
          : new Date(viewingReceipt.printedAt);

        const receiptData = createFn(
          viewingReceipt.items.map(item => ({
            item: { icode: item.item_code, descript: item.item_name, sprice: item.price },
            quantity: item.quantity,
            lineTotal: item.lineTotal,
          })),
          { id: viewingReceipt.farmerId, name: viewingReceipt.farmerName, route: viewingReceipt.memberRoute },
          { transrefno: viewingReceipt.uploadrefno || '', uploadrefno: viewingReceipt.uploadrefno, clerkName: viewingReceipt.clerkName || 'Unknown' },
          companyName,
          storedDate
        );

        receiptData.routeLabel = viewingReceipt.routeLabel || routeLabel;
        receiptData.periodLabel = viewingReceipt.periodLabel || periodLabel;
        receiptData.locationCode = viewingReceipt.locationCode;
        receiptData.locationName = viewingReceipt.locationName || locationName;
        receiptData.reprintedAt = new Date();

        return (
          <TransactionReceipt
            data={receiptData}
            open={true}
            onClose={() => setViewingReceipt(null)}
          />
        );
      } else {
        const isSellProduce = viewingReceipt.collections[0]?.transtype === 2;
        const receiptData = createMilkReceiptData(
          viewingReceipt.collections,
          companyName,
          {
            cumulativeFrequency: isSellProduce ? undefined : viewingReceipt.cumulativeWeight,
            cumulativeByProduct: isSellProduce ? undefined : viewingReceipt.cumulativeByProduct,
            showCumulativeFrequency: !isSellProduce && viewingReceipt.cumulativeWeight !== undefined && viewingReceipt.cumulativeWeight > 0,
            routeLabel: viewingReceipt.routeLabel || routeLabel,
            periodLabel: viewingReceipt.periodLabel || periodLabel,
            locationCode: viewingReceipt.locationCode || viewingReceipt.collections[0]?.route,
            locationName: viewingReceipt.locationName || locationName,
            memberRoute: viewingReceipt.memberRoute || '',
            productName: viewingReceipt.productName || viewingReceipt.collections[0]?.product_name,
            deliveredBy: resolveMemberName(viewingReceipt.collections[0]?.delivered_by, allFarmers),
            reprintedAt: new Date(),
            orgtype: settings.orgtype,
            showProductName,
          }
        );

        if (receiptData) {
          return (
            <TransactionReceipt
              data={receiptData}
              open={true}
              onClose={() => setViewingReceipt(null)}
            />
          );
        }
        return null;
      }
    })()}
    </>
  );
};
