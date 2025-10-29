import { useState, useEffect } from 'react';
import { type MilkCollection } from '@/lib/supabase';
import { mysqlApi } from '@/services/mysqlApi';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { generateTextReport, generateCSVReport } from '@/utils/fileExport';
import { toast } from 'sonner';

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

    // Group receipts by farmer_id, session, and date
    const groupedReceipts = new Map<string, MilkCollection[]>();
    
    for (const receipt of unsyncedReceipts) {
      const dateStr = new Date(receipt.collection_date).toISOString().split('T')[0];
      const key = `${receipt.farmer_id}-${receipt.session}-${dateStr}`;
      
      if (!groupedReceipts.has(key)) {
        groupedReceipts.set(key, []);
      }
      groupedReceipts.get(key)!.push(receipt);
    }

    // Process each group
    for (const [key, receipts] of groupedReceipts.entries()) {
      const firstReceipt = receipts[0];
      const totalWeight = receipts.reduce((sum, r) => sum + Number(r.weight || 0), 0);
      const dateStr = new Date(firstReceipt.collection_date).toISOString().split('T')[0];
      
      const milkData = {
        reference_no: firstReceipt.reference_no || `MC-${dateStr}-${firstReceipt.farmer_id}-${firstReceipt.session}`,
        farmer_id: firstReceipt.farmer_id,
        farmer_name: firstReceipt.farmer_name || firstReceipt.farmer_id || 'Unknown',
        route: firstReceipt.route,
        route_name: firstReceipt.route_name,
        member_route: firstReceipt.member_route,
        session: firstReceipt.session as 'AM' | 'PM',
        weight: parseFloat(totalWeight.toFixed(2)),
        collected_by: firstReceipt.collected_by,
        clerk_name: firstReceipt.clerk_name,
        price_per_liter: Number(firstReceipt.price_per_liter || 0),
        total_amount: Number(firstReceipt.total_amount || 0),
        collection_date: firstReceipt.collection_date,
      };

      try {
        // Check if record already exists in MySQL
        const existing = await mysqlApi.milkCollection.getByFarmerSessionDate(
          firstReceipt.farmer_id,
          firstReceipt.session,
          `${dateStr}T00:00:00`,
          `${dateStr}T23:59:59`
        );

        if (existing && existing.reference_no) {
          // Accumulate weight to existing record
          const newWeight = parseFloat((Number(existing.weight || 0) + totalWeight).toFixed(2));
          const updated = await mysqlApi.milkCollection.update(existing.reference_no, {
            weight: newWeight,
            collection_date: new Date()
          });

          if (updated) {
            // Delete all local receipts in this group after successful sync
            receipts.forEach(receipt => {
              deleteReceipt(receipt.orderId!);
            });
            console.log(`✅ Accumulated ${receipts.length} collections for ${firstReceipt.farmer_id}: ${newWeight} Kg total`);
          } else {
            console.error('Update error: Failed to update MySQL record');
          }
        } else {
          // Insert new record with accumulated weight
          const created = await mysqlApi.milkCollection.create(milkData);
          if (created) {
            // Delete all local receipts in this group after successful sync
            receipts.forEach(receipt => {
              deleteReceipt(receipt.orderId!);
            });
            console.log(`✅ Synced ${receipts.length} collections for ${firstReceipt.farmer_id}: ${totalWeight} Kg total`);
          } else {
            console.error('Insert error: Failed to create MySQL record');
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
