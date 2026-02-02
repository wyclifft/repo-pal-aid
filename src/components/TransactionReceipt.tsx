import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Printer, X, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { printReceipt } from '@/services/bluetooth';
import { mysqlApi } from '@/services/mysqlApi';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
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
  // Sync support - for re-syncing failed transactions
  userId?: string;
  productCode?: string;
  seasonCode?: string;
  entryType?: string;
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
  // Track sync state per item by a stable per-row key (NOT reference_no)
  // NOTE: Multiple rows can legitimately share the same reference_no in the UI data.
  // Using a per-row key prevents one successful sync from disabling all rows.
  const [syncingItems, setSyncingItems] = useState<Set<string>>(new Set());
  const [syncedItems, setSyncedItems] = useState<Set<string>>(new Set());
  const [failedItems, setFailedItems] = useState<Set<string>>(new Set());

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
    printCopies = 1,
    userId,
    productCode,
    seasonCode,
    entryType
  } = data;

  // Stable sync key per row - uses index since we track by position
  const getItemSyncKey = (index: number) => `${uploadrefno || transrefno}::${index}`;

  /**
   * Get the ACTUAL reference number for an item.
   * CRITICAL: Each item should already have a unique reference_no assigned during capture.
   * We MUST use this exact reference - never derive or generate new ones.
   * If an item somehow lacks a reference_no, that's a data integrity issue that should be flagged.
   */
  const getItemActualReference = (item: TransactionItem, index: number): string | null => {
    const ref = (item.reference_no || '').trim();
    if (ref) return ref;
    
    // Item is missing reference_no - this should not happen in normal flow
    console.error(`[SYNC ERROR] Item at index ${index} is missing reference_no. Cannot sync.`);
    return null;
  };

  const isDuplicateLike = (msg?: string) => {
    const errorMsg = (msg || '').toLowerCase();
    return errorMsg.includes('duplicate') || errorMsg.includes('already exists') || errorMsg.includes('unique');
  };

  /**
   * Confirm a record exists on the backend by its EXACT reference number.
   * IMPORTANT: we only treat it as confirmed if it matches the expected transaction date AND farmer.
   * This prevents the “reference mismatch” false-positive (where an older record is returned).
   */
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
        console.warn(`[SYNC] Reference mismatch: ${referenceNo} found on DB date=${foundDateISO}, expected=${expected.dateISO}`);
        return { confirmed: false, mismatchReason: 'date_mismatch' };
      }

      if (foundFarmerId && expectedFarmerId && foundFarmerId !== expectedFarmerId) {
        console.warn(`[SYNC] Reference mismatch: ${referenceNo} found for DB farmer=${foundFarmerId}, expected=${expectedFarmerId}`);
        return { confirmed: false, mismatchReason: 'farmer_mismatch' };
      }

      return { confirmed: true };
    } catch (err) {
      console.error(`[SYNC] Error checking backend for ${referenceNo}:`, err);
      return { confirmed: false, mismatchReason: 'not_found' };
    }
  };

  const formattedDate = transactionDate.toLocaleDateString('en-CA');
  // Use 24-hour format for time (no AM/PM)
  const formattedTime = transactionDate.toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // Manual sync handler for a SINGLE item
  const handleSyncItem = async (item: TransactionItem, index: number) => {
    const syncKey = getItemSyncKey(index);
    const refNo = getItemActualReference(item, index);
    
    // CRITICAL: If item has no reference_no, we cannot sync it
    if (!refNo) {
      toast.error(`Record ${index + 1} has no reference number - cannot sync`);
      setFailedItems(prev => new Set(prev).add(syncKey));
      return;
    }
    
    if (!navigator.onLine) {
      toast.error('You are offline. Please connect to sync.');
      return;
    }

    // Prevent duplicate sync attempts
    if (syncingItems.has(syncKey)) {
      console.log(`[SYNC] Already syncing: ${syncKey}`);
      return;
    }

    // Mark as syncing
    setSyncingItems(prev => new Set(prev).add(syncKey));
    setFailedItems(prev => {
      const next = new Set(prev);
      next.delete(syncKey);
      return next;
    });

    try {
      const deviceFingerprint = await generateDeviceFingerprint();
      const expected = {
        dateISO: transactionDate.toISOString().split('T')[0],
        farmerId: memberId.replace(/^#/, '').trim(),
      };

      // Normalize session to AM/PM
      let normalizedSession: 'AM' | 'PM' = 'AM';
      const sessionVal = (session || '').trim().toUpperCase();
      if (sessionVal === 'PM' || sessionVal.includes('PM') || sessionVal.includes('EVENING') || sessionVal.includes('AFTERNOON') || sessionVal.includes('EV') || sessionVal.includes('AF')) {
        normalizedSession = 'PM';
      }

      const submitOnce = async (referenceNoToUse: string) => {
        console.log(`[SYNC] Submitting: ref=${referenceNoToUse} (row=${syncKey})`);
        return mysqlApi.milkCollection.create({
          reference_no: referenceNoToUse,
          uploadrefno: uploadrefno || referenceNoToUse,
          farmer_id: expected.farmerId,
          farmer_name: memberName.trim(),
          route: (memberRoute || '').trim(),
          session: normalizedSession,
          weight: item.weight || 0,
          user_id: userId,
          clerk_name: clerkName,
          collection_date: transactionDate,
          device_fingerprint: deviceFingerprint,
          entry_type: (entryType as 'scale' | 'manual') || 'manual',
          product_code: productCode,
          season_code: seasonCode,
          transtype,
        });
      };

      // Attempt #1 with the existing (captured) reference
      const result1 = await submitOnce(refNo);
      const duplicateLike1 = isDuplicateLike(result1.error || result1.message);
      const apiOk1 = result1.success || duplicateLike1;

      // Prefer confirming the final reference that backend returns (if any)
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

      // If we found a reference collision (older record returned), auto-generate a fresh reference and retry once.
      if (!confirmed && mismatch === 'date_mismatch') {
        console.warn(`[SYNC] Reference collision detected for ${refNo}. Generating new reference and retrying once...`);
        const nextRefResp = await mysqlApi.milkCollection.getNextReference(deviceFingerprint);
        const newRef = (nextRefResp.data?.reference_no || '').trim();
        if (newRef) {
          const result2 = await submitOnce(newRef);
          const duplicateLike2 = isDuplicateLike(result2.error || result2.message);
          const apiOk2 = result2.success || duplicateLike2;
          if (apiOk2) {
            const check2 = await confirmExactOnBackend(newRef, expected);
            confirmed = check2.confirmed;
            if (confirmed) {
              toast.success(`Record ${index + 1} synced (new ref ${newRef})`);
            }
          }
        }
      }

      if (confirmed) {
        setSyncedItems(prev => new Set(prev).add(syncKey));
        toast.success(`Record ${index + 1} synced (${refNo})`);
      } else {
        setFailedItems(prev => new Set(prev).add(syncKey));
        toast.error('Sync not confirmed on server');
      }
    } catch (err: any) {
      const errorMsg = (err?.message || '').toLowerCase();
      const ok = errorMsg.includes('duplicate') || errorMsg.includes('already exists');
      const expected = {
        dateISO: transactionDate.toISOString().split('T')[0],
        farmerId: memberId.replace(/^#/, '').trim(),
      };
      const confirmed = ok ? (await confirmExactOnBackend(refNo, expected)).confirmed : false;
      if (confirmed) {
        setSyncedItems(prev => new Set(prev).add(syncKey));
        toast.success(`Record ${index + 1} synced (${refNo})`);
      } else {
        setFailedItems(prev => new Set(prev).add(syncKey));
        toast.error(`Record ${index + 1} sync failed`);
        console.error(`[SYNC] Error syncing ${refNo}:`, err);
      }
    } finally {
      setSyncingItems(prev => {
        const next = new Set(prev);
        next.delete(syncKey);
        return next;
      });
    }
  };

  // Sync all items at once
  const handleSyncAll = async () => {
    if (!navigator.onLine) {
      toast.error('You are offline. Please connect to sync.');
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const syncKey = getItemSyncKey(i);
      // Skip already synced items
      if (!syncedItems.has(syncKey)) {
        await handleSyncItem(item, i);
        // Small delay between syncs to avoid overwhelming the server
        if (i < items.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
  };

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
            {items.map((item, index) => {
              const syncKey = getItemSyncKey(index);
              const refNo = getItemActualReference(item, index) || `(no ref #${index + 1})`;
              const isSyncing = syncingItems.has(syncKey);
              const isSynced = syncedItems.has(syncKey);
              const isFailed = failedItems.has(syncKey);
              const hasMissingRef = !item.reference_no;
              
              return (
                <div key={syncKey} className="space-y-0.5">
                  {/* For Milk (transtype 1) - show weight + sync button */}
                  {transtype === 1 && (
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className={`flex-1 ${hasMissingRef ? 'text-red-500' : ''}`}>{index + 1}: {refNo}</span>
                      <span className="font-medium">{item.weight?.toFixed(1)}</span>
                      {/* Per-item sync button */}
                      <button
                        onClick={() => handleSyncItem(item, index)}
                        disabled={isSyncing || isSynced}
                        className={`p-1 rounded transition-colors ${
                          isSynced 
                            ? 'text-green-600 bg-green-50' 
                            : isFailed
                            ? 'text-red-600 bg-red-50 hover:bg-red-100'
                            : 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                        } disabled:opacity-50`}
                        title={isSynced ? 'Synced' : isFailed ? 'Retry sync' : 'Sync to database'}
                      >
                        {isSyncing ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : isSynced ? (
                          <Check className="h-3 w-3" />
                        ) : isFailed ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                      </button>
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
              );
            })}
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

        {/* Manual Sync All Button - Temporary for debugging sync issues */}
        {transtype === 1 && (
          <div className="pt-2 border-t border-dashed">
            {/* Show sync status summary */}
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-muted-foreground">Sync Status:</span>
              <span className="font-medium">
                {syncedItems.size}/{items.length} synced
                {failedItems.size > 0 && <span className="text-red-500 ml-1">({failedItems.size} failed)</span>}
              </span>
            </div>
            
            {/* Sync All button - only show if not all synced */}
            {syncedItems.size < items.length && (
              <button
                onClick={handleSyncAll}
                disabled={syncingItems.size > 0}
                className={`w-full py-2 rounded-md font-medium transition-colors flex items-center justify-center gap-2 ${
                  failedItems.size > 0
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-amber-500 text-white hover:bg-amber-600'
                } disabled:opacity-50`}
              >
                {syncingItems.size > 0 ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Syncing ({syncingItems.size})...
                  </>
                ) : failedItems.size > 0 ? (
                  <>
                    <AlertTriangle className="h-4 w-4" />
                    Retry All Failed
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Sync All to Database
                  </>
                )}
              </button>
            )}
            
            {/* All synced message */}
            {syncedItems.size === items.length && items.length > 0 && (
              <div className="flex items-center justify-center gap-2 py-2 text-green-600 bg-green-50 rounded-md">
                <Check className="h-4 w-4" />
                <span className="font-medium">All records synced</span>
              </div>
            )}
            
            <p className="text-xs text-center text-muted-foreground mt-1">
              Click sync icon on each row or use button above
            </p>
          </div>
        )}

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
    session_descript?: string; // Full session description for display
    weight: number;
    clerk_name: string;
    collection_date: Date;
    product_name?: string;
    // Additional fields for sync support
    user_id?: string;
    product_code?: string;
    season_code?: string;
    entry_type?: string;
    transtype?: number;
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
    transtype: (first.transtype as TransactionType) || 1,
    transrefno: first.reference_no || '',
    uploadrefno: first.uploadrefno,
    companyName,
    memberId: first.farmer_id,
    memberName: first.farmer_name,
    memberRoute: first.route,
    clerkName: first.clerk_name,
    transactionDate: new Date(first.collection_date),
    // Use session_descript for display if available, otherwise fall back to session code
    session: first.session_descript || first.session,
    productName: first.product_name,
    items: receipts.map(r => ({
      reference_no: r.reference_no,
      weight: r.weight
    })),
    totalWeight,
    // Sync support fields
    userId: first.user_id,
    productCode: first.product_code,
    seasonCode: first.season_code,
    entryType: first.entry_type,
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
