import { useState, useEffect, useCallback } from 'react';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import { WifiOff, AlertTriangle, X, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { useIndexedDB } from '@/hooks/useIndexedDB';

export const OfflineIndicator = () => {
  const { isOnline, isSlowConnection } = useOfflineStatus();
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const { isReady, getUnsyncedReceipts } = useIndexedDB();

  // Update pending count
  const updatePendingCount = useCallback(async () => {
    if (!isReady) return;
    try {
      const unsyncedReceipts = await getUnsyncedReceipts();
      setPendingCount(unsyncedReceipts?.length || 0);
    } catch (error) {
      console.warn('Failed to get pending count:', error);
    }
  }, [isReady, getUnsyncedReceipts]);

  // Check pending count on mount and periodically
  useEffect(() => {
    updatePendingCount();
    const interval = setInterval(updatePendingCount, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, [updatePendingCount]);

  // Listen for sync events
  useEffect(() => {
    const handleSyncStart = () => setIsSyncing(true);
    const handleSyncEnd = () => {
      setIsSyncing(false);
      updatePendingCount();
    };

    window.addEventListener('syncStart', handleSyncStart);
    window.addEventListener('syncComplete', handleSyncEnd);
    window.addEventListener('backgroundSync', handleSyncEnd);

    return () => {
      window.removeEventListener('syncStart', handleSyncStart);
      window.removeEventListener('syncComplete', handleSyncEnd);
      window.removeEventListener('backgroundSync', handleSyncEnd);
    };
  }, [updatePendingCount]);

  // Show indicator only when offline or slow, reset dismissed on status change
  useEffect(() => {
    if (!isOnline || isSlowConnection) {
      setVisible(true);
      setDismissed(false);
    } else {
      // Hide after coming online with a small delay
      const timer = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, isSlowConnection]);

  // Auto-dismiss slow connection warning after 5 seconds
  useEffect(() => {
    if (isOnline && isSlowConnection && !dismissed) {
      const timer = setTimeout(() => setDismissed(true), 5000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, isSlowConnection, dismissed]);

  // Show pending count badge if there are pending items (even when online)
  const showPendingBadge = pendingCount > 0 && isOnline && !visible;

  // Move banner to top of screen instead of bottom to avoid blocking buttons
  if (showPendingBadge) {
    return (
      <div 
        className="fixed top-0 left-0 right-0 z-[100] px-4 py-1.5 text-center text-xs font-medium bg-amber-500 text-amber-900 transition-all duration-300"
        style={{ paddingTop: 'max(0.25rem, env(safe-area-inset-top))' }}
      >
        <div className="flex items-center justify-center gap-2">
          {isSyncing ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>Syncing {pendingCount} pending...</span>
            </>
          ) : (
            <>
              <CloudOff className="h-3.5 w-3.5" />
              <span>{pendingCount} pending to sync</span>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!visible || dismissed || (isOnline && !isSlowConnection)) return null;

  // Position at top instead of bottom to avoid blocking action buttons
  return (
    <div 
      className={`fixed top-0 left-0 right-0 z-[100] px-4 py-1.5 text-center text-xs font-medium transition-all duration-300 ${
        !isOnline 
          ? 'bg-destructive text-destructive-foreground' 
          : 'bg-yellow-500 text-yellow-900'
      }`}
      style={{ paddingTop: 'max(0.25rem, env(safe-area-inset-top))' }}
    >
      <div className="flex items-center justify-center gap-2">
        {!isOnline ? (
          <>
            <WifiOff className="h-3.5 w-3.5" />
            <span>Offline{pendingCount > 0 ? ` - ${pendingCount} pending` : ' - Data saved locally'}</span>
          </>
        ) : (
          <>
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Slow connection</span>
            <button 
              onClick={() => setDismissed(true)}
              className="ml-2 p-0.5 hover:bg-yellow-600 rounded"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default OfflineIndicator;
