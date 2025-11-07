import { useState, useEffect } from 'react';
import { type MilkCollection } from '@/lib/supabase';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateDeviceFingerprint } from '@/utils/deviceFingerprint';
import { generateTextReport, generateCSVReport } from '@/utils/fileExport';
import { toast } from 'sonner';
import { ClipboardList } from 'lucide-react';

export const ReceiptList = ({ refreshTrigger }: { refreshTrigger?: number }) => {
  const [unsyncedReceipts, setUnsyncedReceipts] = useState<MilkCollection[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const { getUnsyncedReceipts, deleteReceipt, isReady } = useIndexedDB();

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

  const syncPendingReceipts = async () => {
    if (!navigator.onLine || unsyncedReceipts.length === 0) {
      if (!navigator.onLine) toast.error('You are offline');
      return;
    }

    setIsSyncing(true);

    // Get device fingerprint
    const deviceFingerprint = await generateDeviceFingerprint();

    // Group receipts by farmer_id, session, and month
    const groupedReceipts = new Map<string, MilkCollection[]>();
    
    for (const receipt of unsyncedReceipts) {
      const date = new Date(receipt.collection_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const key = `${receipt.farmer_id}-${receipt.session}-${monthKey}`;
      
      if (!groupedReceipts.has(key)) {
        groupedReceipts.set(key, []);
      }
      groupedReceipts.get(key)!.push(receipt);
    }

    // Process each group
    for (const [key, receipts] of groupedReceipts.entries()) {
      const firstReceipt = receipts[0];
      const totalWeight = receipts.reduce((sum, r) => sum + Number(r.weight || 0), 0);
      const date = new Date(firstReceipt.collection_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      // Get start and end of the month
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
      
      const milkData: any = {
        reference_no: firstReceipt.reference_no || `MC-${monthKey}-${firstReceipt.farmer_id}-${firstReceipt.session}`,
        farmer_id: firstReceipt.farmer_id,
        farmer_name: firstReceipt.farmer_name || firstReceipt.farmer_id || 'Unknown',
        route: firstReceipt.route || 'Unknown',
        session: firstReceipt.session as 'AM' | 'PM',
        weight: parseFloat(totalWeight.toFixed(2)),
        clerk_name: firstReceipt.clerk_name,
        collection_date: firstReceipt.collection_date,
        device_fingerprint: deviceFingerprint,
      };

      try {
        // Check if record already exists in MySQL for this month AND device's ccode
        const existing = await mysqlApi.milkCollection.getByFarmerSessionDate(
          firstReceipt.farmer_id,
          firstReceipt.session,
          monthStart.toISOString(),
          monthEnd.toISOString(),
          deviceFingerprint // Pass device fingerprint to filter by ccode
        );

        if (existing && existing.reference_no) {
          // Accumulate weight to existing monthly record
          const newWeight = parseFloat((Number(existing.weight || 0) + totalWeight).toFixed(2));
          const updateSuccess = await mysqlApi.milkCollection.update(existing.reference_no, {
            weight: newWeight,
            collection_date: new Date()
          });

          if (updateSuccess) {
            // Delete all local receipts in this group after successful sync
            for (const receipt of receipts) {
              await deleteReceipt(receipt.orderId!);
            }
            console.log(`✅ Accumulated ${receipts.length} collections for ${firstReceipt.farmer_id}: ${newWeight} Kg monthly total`);
          } else {
            console.error('❌ Update failed for MySQL record');
          }
        } else {
          // Insert new record with accumulated weight
          const createSuccess = await mysqlApi.milkCollection.create(milkData);
          if (createSuccess) {
            // Delete all local receipts in this group after successful sync
            for (const receipt of receipts) {
              await deleteReceipt(receipt.orderId!);
            }
            console.log(`✅ Synced ${receipts.length} collections for ${firstReceipt.farmer_id}: ${totalWeight} Kg total`);
          } else {
            console.error('❌ Insert failed for MySQL record');
          }
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
        <ClipboardList className="h-6 w-6" />
        Pending Receipts
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
              Farmer: {receipt.farmer_id} ({Number(receipt.weight || 0).toFixed(2)} Kg) ⚠️ Pending Sync
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
