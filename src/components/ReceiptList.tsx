import { useState, useEffect } from 'react';
import { type MilkCollection } from '@/lib/supabase';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useDataSync } from '@/hooks/useDataSync';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { generateTextReport, generateCSVReport } from '@/utils/fileExport';
import { toast } from 'sonner';
import { ClipboardList } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export const ReceiptList = ({ refreshTrigger }: { refreshTrigger?: number }) => {
  const [unsyncedReceipts, setUnsyncedReceipts] = useState<MilkCollection[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ synced: 0, total: 0 });
  const { 
    getUnsyncedReceipts, 
    deleteReceipt, 
    isReady
  } = useIndexedDB();
  const { syncAllData } = useDataSync();

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
  }, [isReady, refreshTrigger]);

  // This function is now removed - using global useDataSync hook instead

  const syncPendingReceipts = async () => {
    if (!navigator.onLine || unsyncedReceipts.length === 0) {
      if (!navigator.onLine) toast.error('You are offline');
      return;
    }

    setIsSyncing(true);
    const totalReceipts = unsyncedReceipts.length;
    let syncedCount = 0;
    setSyncProgress({ synced: 0, total: totalReceipts });

    // Get device fingerprint
    const deviceFingerprint = await generateDeviceFingerprint();

    // Process each receipt individually - create separate transactions
    for (const receipt of unsyncedReceipts) {
      const milkData: any = {
        reference_no: receipt.reference_no,
        farmer_id: receipt.farmer_id,
        farmer_name: receipt.farmer_name || receipt.farmer_id || 'Unknown',
        route: receipt.route || 'Unknown',
        session: receipt.session as 'AM' | 'PM',
        weight: parseFloat(Number(receipt.weight || 0).toFixed(2)),
        clerk_name: receipt.clerk_name,
        collection_date: receipt.collection_date,
        device_fingerprint: deviceFingerprint,
      };

      try {
        console.log(`🔄 Syncing offline receipt: ${receipt.reference_no} - ${receipt.farmer_id} - ${milkData.weight}Kg`);
        
        // Always create new record - no grouping or accumulation
        const createSuccess = await mysqlApi.milkCollection.create(milkData);
        
        if (createSuccess) {
          await deleteReceipt(receipt.orderId!);
          syncedCount++;
          setSyncProgress({ synced: syncedCount, total: totalReceipts });
          console.log(`✅ Synced offline receipt: ${receipt.reference_no}`);
        } else {
          console.error(`❌ Failed to sync receipt: ${receipt.reference_no}`);
        }
      } catch (err) {
        console.error('Sync error for receipt:', receipt.reference_no, err);
      }
    }

      // After syncing receipts, refresh data from server
      await loadPendingReceipts();
      await syncAllData(false); // false = show toast
      setSyncProgress({ synced: 0, total: 0 });
  };

  // Auto-sync receipts when coming back online
  useEffect(() => {
    const handleOnline = async () => {
      console.log('Back online. Syncing pending receipts...');
      if (unsyncedReceipts.length > 0) {
        await syncPendingReceipts();
      }
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
        <ClipboardList className="h-6 w-6" />
        Pending Receipts
      </h3>

      {unsyncedReceipts.length === 0 ? (
        <p className="text-gray-600 text-center py-4">No pending receipts</p>
      ) : (
        <>
          <ul className="space-y-2 mb-4">
            {unsyncedReceipts.map((receipt) => (
              <li
                key={receipt.orderId}
                className="p-3 bg-yellow-50 border-l-4 border-yellow-500 rounded text-sm"
              >
                Farmer: {receipt.farmer_id} ({Number(receipt.weight || 0).toFixed(2)} Kg) ⚠️ Pending Sync
              </li>
            ))}
          </ul>
          
          {isSyncing && syncProgress.total > 0 && (
            <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-blue-900">
                  Syncing Progress
                </span>
                <span className="text-sm font-bold text-blue-700">
                  {syncProgress.synced} / {syncProgress.total}
                </span>
              </div>
              <Progress 
                value={(syncProgress.synced / syncProgress.total) * 100} 
                className="h-2"
              />
            </div>
          )}
        </>
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
