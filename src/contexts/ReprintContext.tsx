import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { MilkCollection } from '@/lib/supabase';
import type { ReprintItem, PrintedReceipt } from '@/components/ReprintModal';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { getAllFromLocalDB, isNativeStorageAvailable, type NativeStoredRecord } from '@/services/offlineStorage';
import { toast } from 'sonner';

interface StoreAIReceiptInput {
  farmerId: string;
  farmerName: string;
  memberRoute?: string;
  clerkName: string;
  uploadrefno: string;
  items: ReprintItem[];
  totalAmount: number;
  transactionDate?: Date;
  /**
   * v2.10.66: per-item transrefno values for the batch. Stored on the receipt
   * as a stable identity so we never suppress a real new Store/AI receipt
   * just because its uploadrefno happens to match an older one.
   */
  itemRefs?: string[];
}

interface ReprintContextValue {
  printedReceipts: PrintedReceipt[];
  addMilkReceipt: (collections: MilkCollection[], cumulativeWeight?: number, cumulativeByProduct?: Array<{ icode: string; product_name: string; weight: number }>) => Promise<boolean>;
  addStoreReceipt: (data: StoreAIReceiptInput) => Promise<boolean>;
  addAIReceipt: (data: StoreAIReceiptInput) => Promise<boolean>;
  deleteReceipts: (indices: number[]) => Promise<void>;
  isReady: boolean;
}

const ReprintContext = createContext<ReprintContextValue | null>(null);

export const useReprint = () => {
  const context = useContext(ReprintContext);
  if (!context) {
    throw new Error('useReprint must be used within a ReprintProvider');
  }
  return context;
};

interface ReprintProviderProps {
  children: ReactNode;
}

/**
 * v2.10.66: Build a stable identity key for Store/AI receipts.
 * Prefers the per-item transrefno list (most precise), falls back to
 * uploadrefno + item code/qty signature for legacy callers.
 */
const buildStoreAIIdentity = (
  uploadrefno: string,
  items: ReprintItem[],
  itemRefs?: string[]
): string => {
  if (itemRefs && itemRefs.length > 0) {
    return [...itemRefs].sort().join('|');
  }
  // Legacy fallback: derive identity from item code+qty so two distinct
  // batches that share an uploadrefno still produce different identities.
  return `${uploadrefno}::${items
    .map(i => `${i.item_code}#${i.quantity}#${i.price}`)
    .sort()
    .join(',')}`;
};

const matchesStoreAIIdentity = (
  receipt: PrintedReceipt,
  identity: string,
  type: 'store' | 'ai',
  uploadrefno: string,
  items: ReprintItem[]
): boolean => {
  if (receipt.type !== type) return false;
  // New entries (have itemRefs/localReceiptId) — use stable identity.
  if (receipt.itemRefs && receipt.itemRefs.length > 0) {
    const existingId = [...receipt.itemRefs].sort().join('|');
    return existingId === identity;
  }
  if (receipt.localReceiptId) {
    return receipt.localReceiptId === identity;
  }
  // Legacy entry (saved before v2.10.66) — fall back to the old uploadrefno
  // rule, but ALSO require item count + total to match so a counter rollback
  // cannot wrongly mask a brand-new receipt as a duplicate.
  if (!receipt.uploadrefno || receipt.uploadrefno !== uploadrefno) return false;
  if ((receipt.items?.length || 0) !== items.length) return false;
  const newTotal = items.reduce((s, i) => s + (i.lineTotal || 0), 0);
  const oldTotal = receipt.totalAmount || 0;
  return Math.abs(newTotal - oldTotal) < 0.01;
};

/**
 * v2.10.75: Rebuild PrintedReceipt entries from raw native SyncRecord rows.
 * Each capture stores its full payload via saveToLocalDB(); we reverse it.
 *   - milk_collection → one PrintedReceipt of type 'milk' per record
 *   - store_sale      → grouped by uploadrefno into one 'store' receipt
 *   - ai_sale         → grouped by uploadrefno into one 'ai' receipt
 * Best-effort — malformed rows are skipped silently.
 */
const rebuildPrintedReceiptsFromNative = (records: NativeStoredRecord[]): PrintedReceipt[] => {
  const out: PrintedReceipt[] = [];
  const storeGroups = new Map<string, { rows: any[]; createdAt: number }>();
  const aiGroups = new Map<string, { rows: any[]; createdAt: number }>();

  for (const r of records) {
    try {
      const p = r.payload;
      if (!p || typeof p !== 'object') continue;

      if (r.recordType === 'milk_collection') {
        const collection: MilkCollection = {
          ...(p as any),
          reference_no: p.reference_no || r.referenceNo,
        };
        out.push({
          farmerId: p.farmer_id || '',
          farmerName: p.farmer_name || p.farmer_id || '',
          collections: [collection],
          printedAt: new Date(r.createdAt),
          type: 'milk',
          uploadrefno: p.uploadrefno || p.reference_no || r.referenceNo,
          cumulativeWeight: p.cumulativeWeight,
          cumulativeByProduct: p.cumulativeByProduct,
          transactionDate: p.collection_date ? new Date(p.collection_date) : new Date(r.createdAt),
        });
      } else if (r.recordType === 'store_sale' || r.recordType === 'ai_sale') {
        const key = String(p.uploadrefno || r.referenceNo);
        const map = r.recordType === 'store_sale' ? storeGroups : aiGroups;
        const existing = map.get(key);
        if (existing) existing.rows.push({ ...p, _ref: r.referenceNo });
        else map.set(key, { rows: [{ ...p, _ref: r.referenceNo }], createdAt: r.createdAt });
      }
    } catch { /* skip malformed */ }
  }

  const buildBatch = (
    type: 'store' | 'ai',
    groups: Map<string, { rows: any[]; createdAt: number }>
  ) => {
    for (const [uploadrefno, { rows, createdAt }] of groups) {
      const first = rows[0] || {};
      const items: ReprintItem[] = rows.map(row => {
        const qty = Number(row.quantity || 0);
        const price = Number(row.price || 0);
        return {
          item_code: row.item_code || '',
          item_name: row.item_name || row.item_code || '',
          quantity: qty,
          price,
          lineTotal: qty * price,
        };
      });
      const totalAmount = items.reduce((s, i) => s + (i.lineTotal || 0), 0);
      const itemRefs = rows.map(r => String(r.transrefno || r._ref)).filter(Boolean);
      const identity = itemRefs.length > 0
        ? [...itemRefs].sort().join('|')
        : `${uploadrefno}::${items.map(i => `${i.item_code}#${i.quantity}#${i.price}`).sort().join(',')}`;

      out.push({
        farmerId: first.farmer_id || '',
        farmerName: first.farmer_name || first.farmer_id || '',
        collections: [],
        printedAt: new Date(createdAt),
        type,
        totalAmount,
        itemCount: items.length,
        uploadrefno,
        items,
        clerkName: first.sold_by || first.clerk || '',
        memberRoute: first.route || first.route_tcode || '',
        transactionDate: new Date(createdAt),
        localReceiptId: identity,
        itemRefs: itemRefs.length > 0 ? itemRefs : undefined,
      });
    }
  };

  buildBatch('store', storeGroups);
  buildBatch('ai', aiGroups);
  out.sort((a, b) => (b.printedAt?.getTime() || 0) - (a.printedAt?.getTime() || 0));
  return out;
};

  const [printedReceipts, setPrintedReceipts] = useState<PrintedReceipt[]>([]);
  const { savePrintedReceipts, getPrintedReceipts, isReady: dbReady } = useIndexedDB();
  const [isReady, setIsReady] = useState(false);

  // Load receipts from IndexedDB on mount; if empty AND running on native,
  // attempt to rebuild from the encrypted SQLite SyncRecord backup so a
  // "Clear App Data" wipe of IndexedDB does not lose Recent Receipts.
  useEffect(() => {
    if (!dbReady) return;

    const loadReceipts = async () => {
      try {
        const cached = await getPrintedReceipts();
        if (cached && cached.length > 0) {
          setPrintedReceipts(cached);
          console.log(`[REPRINT] Loaded ${cached.length} receipts from cache`);
          setIsReady(true);
          return;
        }

        // Empty cache → try native restore (Android only).
        if (isNativeStorageAvailable()) {
          try {
            const native = await getAllFromLocalDB({ limit: 200 });
            const restored = rebuildPrintedReceiptsFromNative(native);
            if (restored.length > 0) {
              setPrintedReceipts(restored);
              await savePrintedReceipts(restored);
              console.log(`[REPRINT] Restored ${restored.length} receipts from native SQLite`);
              toast.success(`Restored ${restored.length} recent receipt${restored.length === 1 ? '' : 's'} from device storage`);
            }
          } catch (restoreErr) {
            console.warn('[REPRINT] Native restore failed (non-fatal):', restoreErr);
          }
        }

        setIsReady(true);
      } catch (error) {
        console.error('[REPRINT] Failed to load receipts:', error);
        setIsReady(true);
      }
    };

    loadReceipts();
  }, [dbReady, getPrintedReceipts, savePrintedReceipts]);

  // Save milk collection receipt
  const addMilkReceipt = useCallback(async (collections: MilkCollection[], cumulativeWeight?: number, cumulativeByProduct?: Array<{ icode: string; product_name: string; weight: number }>): Promise<boolean> => {
    if (collections.length === 0) return false;

    // Check for duplicate
    const existingReceipt = printedReceipts.find(r =>
      r.farmerId === collections[0].farmer_id &&
      r.type === 'milk' &&
      r.collections.length === collections.length &&
      r.collections.every((c, i) => c.reference_no === collections[i].reference_no)
    );

    if (existingReceipt) {
      console.log('[REPRINT] Milk receipt already saved, skipping duplicate');
      return false;
    }

    const newReceipt: PrintedReceipt = {
      farmerId: collections[0].farmer_id,
      farmerName: collections[0].farmer_name,
      collections: [...collections],
      printedAt: new Date(),
      type: 'milk',
      uploadrefno: collections[0].uploadrefno || collections[0].reference_no,
      cumulativeWeight,
      cumulativeByProduct,
      transactionDate: collections[0].collection_date ? new Date(collections[0].collection_date) : new Date(),
    };

    const updatedReceipts = [newReceipt, ...printedReceipts];
    setPrintedReceipts(updatedReceipts);

    try {
      await savePrintedReceipts(updatedReceipts);
      console.log('[SUCCESS] Milk receipt saved for reprinting (total:', updatedReceipts.length, ')');
      return true;
    } catch (error) {
      console.error('[ERROR] Failed to save milk receipt for reprinting:', error);
      return false;
    }
  }, [printedReceipts, savePrintedReceipts]);

  // Save Store receipt
  const addStoreReceipt = useCallback(async (data: StoreAIReceiptInput): Promise<boolean> => {
    // v2.10.66: identity is per-batch (transrefno list) — uploadrefno alone is
    // not enough to call something a duplicate. Operators were losing real
    // receipts from Recent Receipts after a counter rollback that produced a
    // repeat uploadrefno; this guard now only blocks the EXACT same batch.
    const identity = buildStoreAIIdentity(data.uploadrefno, data.items, data.itemRefs);
    const existingReceipt = printedReceipts.find(r =>
      matchesStoreAIIdentity(r, identity, 'store', data.uploadrefno, data.items)
    );

    if (existingReceipt) {
      console.log('[REPRINT] Store receipt already saved (same batch identity), skipping duplicate');
      return false;
    }

    const newReceipt: PrintedReceipt = {
      farmerId: data.farmerId,
      farmerName: data.farmerName,
      collections: [], // Empty for Store receipts
      printedAt: new Date(),
      type: 'store',
      totalAmount: data.totalAmount,
      itemCount: data.items.length,
      uploadrefno: data.uploadrefno,
      items: data.items,
      clerkName: data.clerkName,
      memberRoute: data.memberRoute,
      transactionDate: data.transactionDate || new Date(),
      localReceiptId: identity,
      itemRefs: data.itemRefs && data.itemRefs.length > 0 ? [...data.itemRefs] : undefined,
    };

    const updatedReceipts = [newReceipt, ...printedReceipts];
    setPrintedReceipts(updatedReceipts);

    try {
      await savePrintedReceipts(updatedReceipts);
      console.log('[SUCCESS] Store receipt saved for reprinting (total:', updatedReceipts.length, ')');
      return true;
    } catch (error) {
      console.error('[ERROR] Failed to save store receipt for reprinting:', error);
      return false;
    }
  }, [printedReceipts, savePrintedReceipts]);

  // Save AI receipt
  const addAIReceipt = useCallback(async (data: StoreAIReceiptInput): Promise<boolean> => {
    // v2.10.66: see addStoreReceipt — same identity rule for AI batches.
    const identity = buildStoreAIIdentity(data.uploadrefno, data.items, data.itemRefs);
    const existingReceipt = printedReceipts.find(r =>
      matchesStoreAIIdentity(r, identity, 'ai', data.uploadrefno, data.items)
    );

    if (existingReceipt) {
      console.log('[REPRINT] AI receipt already saved (same batch identity), skipping duplicate');
      return false;
    }

    const newReceipt: PrintedReceipt = {
      farmerId: data.farmerId,
      farmerName: data.farmerName,
      collections: [], // Empty for AI receipts
      printedAt: new Date(),
      type: 'ai',
      totalAmount: data.totalAmount,
      itemCount: data.items.length,
      uploadrefno: data.uploadrefno,
      items: data.items,
      clerkName: data.clerkName,
      memberRoute: data.memberRoute,
      transactionDate: data.transactionDate || new Date(),
      localReceiptId: identity,
      itemRefs: data.itemRefs && data.itemRefs.length > 0 ? [...data.itemRefs] : undefined,
    };

    const updatedReceipts = [newReceipt, ...printedReceipts];
    setPrintedReceipts(updatedReceipts);

    try {
      await savePrintedReceipts(updatedReceipts);
      console.log('[SUCCESS] AI receipt saved for reprinting (total:', updatedReceipts.length, ')');
      return true;
    } catch (error) {
      console.error('[ERROR] Failed to save AI receipt for reprinting:', error);
      return false;
    }
  }, [printedReceipts, savePrintedReceipts]);

  // Delete receipts by indices
  const deleteReceipts = useCallback(async (indices: number[]): Promise<void> => {
    const updatedReceipts = printedReceipts.filter((_, index) => !indices.includes(index));
    setPrintedReceipts(updatedReceipts);

    try {
      await savePrintedReceipts(updatedReceipts);
      console.log('[SUCCESS] Deleted receipts, remaining:', updatedReceipts.length);
    } catch (error) {
      console.error('[ERROR] Failed to delete receipts:', error);
    }
  }, [printedReceipts, savePrintedReceipts]);

  return (
    <ReprintContext.Provider
      value={{
        printedReceipts,
        addMilkReceipt,
        addStoreReceipt,
        addAIReceipt,
        deleteReceipts,
        isReady,
      }}
    >
      {children}
    </ReprintContext.Provider>
  );
};
