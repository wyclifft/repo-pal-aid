import { useState, useEffect, useCallback } from 'react';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { WifiOff, AlertTriangle, X, Cloud, CloudOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useIndexedDB } from '@/hooks/useIndexedDB';

export const OfflineIndicator = () => {
  const { isOnline, isSlowConnection } = useOfflineStatus();
  const [dismissed, setDismissed] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [serverStatus, setServerStatus] = useState<'healthy' | 'db_busy' | 'server_unavailable'>('healthy');
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const { isReady, getUnsyncedReceipts, getUnsyncedSales } = useIndexedDB();

  // Update pending count - includes milk receipts + store/AI sales
  const updatePendingCount = useCallback(async () => {
    if (!isReady) return;
    try {
      const unsyncedReceipts = await getUnsyncedReceipts();
      const unsyncedSales = await getUnsyncedSales();

      let totalCount = (unsyncedReceipts?.length || 0) + (unsyncedSales?.length || 0);

      try {
        const { isNativeStorageAvailable, getUnsyncedFromLocalDB } = await import('@/services/offlineStorage');
        if (isNativeStorageAvailable()) {
          const nativeMilk = await getUnsyncedFromLocalDB('milk_collection');
          const nativeSales = await getUnsyncedFromLocalDB('store_sale');
          const nativeAI = await getUnsyncedFromLocalDB('ai_sale');

          const idbRefs = new Set(unsyncedReceipts.map(r => r.reference_no));
          const idbSaleRefs = new Set(unsyncedSales.map(r => r.transrefno || r.reference_no));

          const nativeMilkUnique = nativeMilk.filter(r => !idbRefs.has(r.referenceNo)).length;
          const nativeSalesUnique = nativeSales.filter(r => !idbSaleRefs.has(r.referenceNo)).length +
                                     nativeAI.filter(r => !idbSaleRefs.has(r.referenceNo)).length;

          totalCount += nativeMilkUnique + nativeSalesUnique;
        }
      } catch (err) {
        console.warn('Failed to fetch native pending count:', err);
      }

      setPendingCount(totalCount);
    } catch (error) {
      console.warn('Failed to get pending count:', error);
    }
  }, [isReady, getUnsyncedReceipts, getUnsyncedSales]);

  // Check pending count on mount and periodically
  useEffect(() => {
    updatePendingCount();
    const interval = setInterval(updatePendingCount, 10000);
    return () => clearInterval(interval);
  }, [updatePendingCount]);

  // Listen for sync and server status change events
  useEffect(() => {
    const handleSyncStart = () => setIsSyncing(true);
    const handleSyncEnd = () => {
      setIsSyncing(false);
      updatePendingCount();
    };

    const handleServerStatusChange = (e: CustomEvent<{ type: 'healthy' | 'db_busy' | 'server_unavailable' }>) => {
      const newStatus = e.detail?.type;
      if (newStatus && newStatus !== serverStatus) {
        if (serverStatus !== 'healthy' && newStatus === 'healthy') {
          // Transitioned from busy/unavailable to healthy -> show recovery message for 2.5s
          setRecoveryMessage('Server is now available. Syncing pending transactions...');
          const timer = setTimeout(() => setRecoveryMessage(null), 2500);
          setServerStatus('healthy');
          return () => clearTimeout(timer);
        }
        setServerStatus(newStatus);
        if (newStatus !== 'healthy') {
          setRecoveryMessage(null);
        }
      }
    };

    window.addEventListener('syncStart', handleSyncStart);
    window.addEventListener('syncComplete', handleSyncEnd);
    window.addEventListener('backgroundSync', handleSyncEnd);
    window.addEventListener('serverStatusChange', handleServerStatusChange as EventListener);

    return () => {
      window.removeEventListener('syncStart', handleSyncStart);
      window.removeEventListener('syncComplete', handleSyncEnd);
      window.removeEventListener('backgroundSync', handleSyncEnd);
      window.removeEventListener('serverStatusChange', handleServerStatusChange as EventListener);
    };
  }, [serverStatus]);

  // Reset dismissed when network status changes
  useEffect(() => {
    if (!isOnline || isSlowConnection) {
      setDismissed(false);
    }
  }, [isOnline, isSlowConnection]);

  // Auto-dismiss slow connection warning after 5 seconds
  useEffect(() => {
    if (isOnline && isSlowConnection && !dismissed) {
      const timer = setTimeout(() => setDismissed(true), 5000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, isSlowConnection, dismissed]);

  // 1. Priority: Recovery Message (Green)
  if (recoveryMessage) {
    return (
      <div className="w-full py-2.5 px-4 text-center text-sm sm:text-base font-semibold bg-emerald-600 text-white transition-all duration-300 shadow-sm flex items-center justify-center gap-2">
        <CheckCircle2 className="h-4 w-4" />
        <span>{recoveryMessage}</span>
      </div>
    );
  }

  // 2. Priority: Offline Banner (Red)
  if (!isOnline) {
    return (
      <div className="w-full py-2.5 px-4 text-center text-sm sm:text-base font-semibold bg-red-600 text-white transition-all duration-300 shadow-sm flex items-center justify-center gap-2">
        <WifiOff className="h-4 w-4" />
        <span>
          Offline.{' '}
          {pendingCount > 0 ? (
            <>
              <span className="font-bold">{pendingCount} pending</span> saved locally
            </>
          ) : (
            'Data saved locally'
          )}
        </span>
      </div>
    );
  }

  // 3. Priority: DB Busy Banner (Yellow/Amber)
  if (serverStatus === 'db_busy') {
    return (
      <div className="w-full py-2.5 px-4 text-center text-sm sm:text-base font-semibold bg-amber-500 text-amber-950 transition-all duration-300 shadow-sm flex items-center justify-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <span>
          Database busy.{' '}
          {pendingCount > 0 ? (
            <><span className="font-bold">{pendingCount} pending</span> will sync later. Continue working offline.</>
          ) : (
            'Will sync later. Continue working offline.'
          )}
        </span>
      </div>
    );
  }

  // 4. Priority: Server Unavailable Banner (Yellow/Amber)
  if (serverStatus === 'server_unavailable') {
    return (
      <div className="w-full py-2.5 px-4 text-center text-sm sm:text-base font-semibold bg-amber-500 text-amber-950 transition-all duration-300 shadow-sm flex items-center justify-center gap-2">
        <AlertTriangle className="h-4 w-4" />
        <span>
          Server unavailable.{' '}
          {pendingCount > 0 ? (
            <><span className="font-bold">{pendingCount} pending</span> will sync later. Continue working offline.</>
          ) : (
            'Will sync later. Continue working offline.'
          )}
        </span>
      </div>
    );
  }

  // 5. Priority: Slow Connection Warning (Yellow/Amber)
  if (isSlowConnection && !dismissed) {
    return (
      <div className="w-full py-2.5 px-4 text-center text-sm sm:text-base font-semibold bg-amber-500 text-amber-950 transition-all duration-300 shadow-sm flex items-center justify-between px-4">
        <div className="flex items-center justify-center gap-2 flex-1">
          <AlertTriangle className="h-4 w-4" />
          <span>Slow connection</span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="p-1 hover:bg-amber-600/30 rounded"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // 6. Priority: Online Pending Badge
  if (pendingCount > 0) {
    return (
      <div className="w-full py-2 px-4 text-center text-sm sm:text-base font-semibold bg-amber-500/90 text-amber-950 transition-all duration-300 shadow-sm">
        <div className="flex items-center justify-center gap-2">
          {isSyncing ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Syncing <span className="font-bold">{pendingCount} pending</span>...</span>
            </>
          ) : (
            <>
              <CloudOff className="h-4 w-4" />
              <span><span className="font-bold">{pendingCount} pending</span> to sync</span>
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
};

export default OfflineIndicator;
