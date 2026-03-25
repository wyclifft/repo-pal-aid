import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { MilkCollection } from '@/lib/supabase';
import type { ReprintItem, PrintedReceipt } from '@/components/ReprintModal';
import { useIndexedDB } from '@/hooks/useIndexedDB';

interface ReprintContextValue {
  printedReceipts: PrintedReceipt[];
  addMilkReceipt: (collections: MilkCollection[]) => Promise<boolean>;
  addStoreReceipt: (data: {
    farmerId: string;
    farmerName: string;
    memberRoute?: string;
    clerkName: string;
    uploadrefno: string;
    items: ReprintItem[];
    totalAmount: number;
    transactionDate?: Date;
  }) => Promise<boolean>;
  addAIReceipt: (data: {
    farmerId: string;
    farmerName: string;
    memberRoute?: string;
    clerkName: string;
    uploadrefno: string;
    items: ReprintItem[];
    totalAmount: number;
    transactionDate?: Date;
  }) => Promise<boolean>;
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

export const ReprintProvider = ({ children }: ReprintProviderProps) => {
  const [printedReceipts, setPrintedReceipts] = useState<PrintedReceipt[]>([]);
  const { savePrintedReceipts, getPrintedReceipts, isReady: dbReady } = useIndexedDB();
  const [isReady, setIsReady] = useState(false);

  // Load receipts from IndexedDB on mount
  useEffect(() => {
    if (!dbReady) return;

    const loadReceipts = async () => {
      try {
        const cached = await getPrintedReceipts();
        if (cached && cached.length > 0) {
          setPrintedReceipts(cached);
          console.log(`[REPRINT] Loaded ${cached.length} receipts from cache`);
        }
        setIsReady(true);
      } catch (error) {
        console.error('[REPRINT] Failed to load receipts:', error);
        setIsReady(true);
      }
    };

    loadReceipts();
  }, [dbReady, getPrintedReceipts]);

  // Save milk collection receipt
  const addMilkReceipt = useCallback(async (collections: MilkCollection[]): Promise<boolean> => {
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
  const addStoreReceipt = useCallback(async (data: {
    farmerId: string;
    farmerName: string;
    memberRoute?: string;
    clerkName: string;
    uploadrefno: string;
    items: ReprintItem[];
    totalAmount: number;
    transactionDate?: Date;
  }): Promise<boolean> => {
    // Check for duplicate by uploadrefno
    const existingReceipt = printedReceipts.find(r =>
      r.uploadrefno === data.uploadrefno && r.type === 'store'
    );

    if (existingReceipt) {
      console.log('[REPRINT] Store receipt already saved, skipping duplicate');
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
  const addAIReceipt = useCallback(async (data: {
    farmerId: string;
    farmerName: string;
    memberRoute?: string;
    clerkName: string;
    uploadrefno: string;
    items: ReprintItem[];
    totalAmount: number;
    transactionDate?: Date;
  }): Promise<boolean> => {
    // Check for duplicate by uploadrefno
    const existingReceipt = printedReceipts.find(r =>
      r.uploadrefno === data.uploadrefno && r.type === 'ai'
    );

    if (existingReceipt) {
      console.log('[REPRINT] AI receipt already saved, skipping duplicate');
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
