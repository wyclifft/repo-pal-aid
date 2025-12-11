import { useState, useEffect, useCallback } from 'react';
import { type MilkCollection } from '@/lib/supabase';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useDataSync } from '@/hooks/useDataSync';
import { generateTextReport, generateCSVReport } from '@/utils/fileExport';
import { toast } from 'sonner';
import { ClipboardList } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export const ReceiptList = ({ refreshTrigger }: { refreshTrigger?: number }) => {
  const [unsyncedReceipts, setUnsyncedReceipts] = useState<MilkCollection[]>([]);
  
  let indexedDB;
  let dataSync;
  try {
    indexedDB = useIndexedDB();
    dataSync = useDataSync();
  } catch (err) {
    console.error('Hook initialization error:', err);
    return <div className="text-center py-4">Loading...</div>;
  }

  const { getUnsyncedReceipts, isReady } = indexedDB;
  const { syncAllData, isSyncing, pendingCount } = dataSync;

  const loadPendingReceipts = useCallback(async () => {
    if (!isReady) return;
    try {
      const receipts = await getUnsyncedReceipts();
      // Filter out sales
      const milkReceipts = receipts.filter((r: any) => r.type !== 'sale');
      setUnsyncedReceipts(milkReceipts);
    } catch (err) {
      console.error('Error loading pending receipts:', err);
    }
  }, [isReady, getUnsyncedReceipts]);

  useEffect(() => {
    loadPendingReceipts();
  }, [loadPendingReceipts, refreshTrigger, pendingCount]);

  // Use centralized sync - no duplicate online handlers
  const handleSync = async () => {
    if (!navigator.onLine) {
      toast.error('You are offline');
      return;
    }
    await syncAllData(false);
    await loadPendingReceipts();
  };

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
        <ClipboardList className="h-6 w-6" />
        Pending Receipts ({pendingCount})
      </h3>

      {unsyncedReceipts.length === 0 ? (
        <p className="text-gray-600 text-center py-4">No pending receipts</p>
      ) : (
        <>
          <ul className="space-y-2 mb-4 max-h-48 overflow-y-auto">
            {unsyncedReceipts.map((receipt) => (
              <li
                key={receipt.orderId}
                className="p-3 bg-yellow-50 border-l-4 border-yellow-500 rounded text-sm"
              >
                {receipt.farmer_id} - {Number(receipt.weight || 0).toFixed(2)} Kg ⚠️
              </li>
            ))}
          </ul>
          
          {isSyncing && (
            <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2">
                <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                <span className="text-sm font-medium text-blue-700">Syncing...</span>
              </div>
            </div>
          )}
        </>
      )}

      <div className="space-y-2">
        <button
          onClick={handleSync}
          disabled={isSyncing || unsyncedReceipts.length === 0}
          className="w-full py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors disabled:opacity-50"
        >
          {isSyncing ? 'Syncing...' : 'Sync Now'}
        </button>
        <button
          onClick={handleExportText}
          disabled={unsyncedReceipts.length === 0}
          className="w-full py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors disabled:opacity-50"
        >
          Export TXT
        </button>
        <button
          onClick={handleExportCSV}
          disabled={unsyncedReceipts.length === 0}
          className="w-full py-3 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>
    </div>
  );
};
