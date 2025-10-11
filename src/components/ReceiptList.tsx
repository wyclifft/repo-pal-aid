import { useState, useEffect } from 'react';
import { supabase, type MilkCollection } from '@/lib/supabase';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateTextReport, generateCSVReport } from '@/utils/fileExport';
import { toast } from 'sonner';

export const ReceiptList = () => {
  const [unsyncedReceipts, setUnsyncedReceipts] = useState<MilkCollection[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const { getUnsyncedReceipts, saveReceipt, isReady } = useIndexedDB();

  const loadPendingReceipts = async () => {
    if (!isReady) return;
    try {
      const receipts = await getUnsyncedReceipts();
      setUnsyncedReceipts(receipts);
    } catch (err) {
      console.error('Error loading pending receipts:', err);
    }
  };

  useEffect(() => {
    loadPendingReceipts();
  }, [isReady]);

  const syncPendingReceipts = async () => {
    if (!navigator.onLine || unsyncedReceipts.length === 0) {
      if (!navigator.onLine) toast.error('You are offline');
      return;
    }

    setIsSyncing(true);

    for (const receipt of unsyncedReceipts) {
      const milkData = {
        farmer_id: receipt.farmer_id,
        route: receipt.route,
        section: receipt.section,
        weight: receipt.weight,
        collected_by: receipt.collected_by,
        price_per_liter: receipt.price_per_liter,
        total_amount: receipt.total_amount,
        collection_date: receipt.collection_date,
      };

      try {
        const { error } = await supabase.from('milk_collection').insert([milkData]);
        if (!error) {
          saveReceipt({ ...receipt, synced: true });
          console.log(`Receipt for ${receipt.farmer_id} synced ✅`);
        }
      } catch (err) {
        console.error('Sync error:', err);
      }
    }

    toast.success('Receipts synced successfully');
    await loadPendingReceipts();
    setIsSyncing(false);
  };

  // Auto-sync when coming back online
  useEffect(() => {
    const handleOnline = () => {
      console.log('Back online. Syncing pending milk collections...');
      syncPendingReceipts();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [unsyncedReceipts]);

  const handleExportText = () => {
    if (unsyncedReceipts.length === 0) {
      toast.error('No receipts to export');
      return;
    }
    generateTextReport(unsyncedReceipts);
    toast.success('Text file exported');
  };

  const handleExportCSV = () => {
    if (unsyncedReceipts.length === 0) {
      toast.error('No receipts to export');
      return;
    }
    generateCSVReport(unsyncedReceipts);
    toast.success('CSV file exported');
  };

  return (
    <div className="bg-white rounded-xl p-6 shadow-lg">
      <h3 className="text-xl font-bold mb-4 text-[#667eea] flex items-center gap-2">
        📋 Pending Receipts
      </h3>

      {unsyncedReceipts.length === 0 ? (
        <p className="text-gray-600 text-center py-4">No pending receipts</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {unsyncedReceipts.map((receipt) => (
            <li
              key={receipt.orderId}
              className="p-3 bg-yellow-50 border-l-4 border-yellow-500 rounded text-sm"
            >
              Farmer: {receipt.farmer_id} ({receipt.total_amount.toFixed(2)} Ksh) ⚠️ Pending Sync
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <button
          onClick={syncPendingReceipts}
          disabled={isSyncing || unsyncedReceipts.length === 0}
          className="w-full py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors disabled:opacity-50"
        >
          {isSyncing ? 'Syncing...' : 'Sync Now'}
        </button>
        <button
          onClick={handleExportText}
          className="w-full py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
        >
          Export TXT
        </button>
        <button
          onClick={handleExportCSV}
          className="w-full py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
        >
          Export CSV
        </button>
      </div>
    </div>
  );
};
