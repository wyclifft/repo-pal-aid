import { useState, useCallback, useEffect, useRef } from 'react';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useDataSync } from '@/hooks/useDataSync';
import { toast } from 'sonner';

export interface SessionCloseState {
  canClose: boolean;
  isClosing: boolean;
  pendingSyncCount: number;
  isSyncComplete: boolean;
  closeButtonLabel: string;
  closeSession: () => Promise<boolean>;
}

/**
 * Hook to manage session closing behavior based on psettings.sessPrint
 * 
 * sessPrint = 0: Allow session to close without printing Z-report
 * sessPrint = 1: Require all transactions synced before close, then auto-print Z-report
 */
export const useSessionClose = (
  onCloseSuccess: () => void,
  selectedDate?: string
): SessionCloseState => {
  const { sessionPrintOnly } = useAppSettings();
  const { syncAllData, syncOfflineReceipts, isSyncing, pendingCount } = useDataSync();
  const { getUnsyncedReceipts, isReady } = useIndexedDB();
  
  const [isClosing, setIsClosing] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncComplete, setIsSyncComplete] = useState(true);
  const mountedRef = useRef(true);

  // Update pending sync count
  const updateSyncStatus = useCallback(async () => {
    if (!isReady) return;
    
    try {
      const unsynced = await getUnsyncedReceipts();
      const receiptsOnly = unsynced.filter((r: any) => r.type !== 'sale');
      
      if (mountedRef.current) {
        setPendingSyncCount(receiptsOnly.length);
        setIsSyncComplete(receiptsOnly.length === 0);
      }
    } catch (err) {
      console.error('Failed to check pending sync:', err);
    }
  }, [isReady, getUnsyncedReceipts]);

  // Check sync status on mount and when pendingCount changes
  useEffect(() => {
    updateSyncStatus();
  }, [updateSyncStatus, pendingCount]);

  // Listen for sync events
  useEffect(() => {
    const handleSyncComplete = () => updateSyncStatus();
    const handleSyncStart = () => updateSyncStatus();
    
    window.addEventListener('syncComplete', handleSyncComplete);
    window.addEventListener('syncStart', handleSyncStart);
    
    return () => {
      window.removeEventListener('syncComplete', handleSyncComplete);
      window.removeEventListener('syncStart', handleSyncStart);
    };
  }, [updateSyncStatus]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Determine if session can be closed
  const canClose = !isSyncing && !isClosing && (
    !sessionPrintOnly || // sessPrint = 0: always can close
    isSyncComplete       // sessPrint = 1: only if sync complete
  );

  // Dynamic button label
  const getButtonLabel = (): string => {
    if (isClosing) return 'Closing...';
    if (isSyncing) return 'Syncing...';
    
    if (sessionPrintOnly && !isSyncComplete) {
      return `Sync Pending (${pendingSyncCount})`;
    }
    
    return 'Close Session';
  };

  // Close session handler
  const closeSession = useCallback(async (): Promise<boolean> => {
    // Refresh sync status first
    await updateSyncStatus();
    
    // If sessPrint is disabled (0), just close immediately
    if (!sessionPrintOnly) {
      console.log('📝 sessPrint=0: Closing session without Z-report');
      onCloseSuccess();
      return true;
    }
    
    // sessPrint = 1: Require sync completion
    setIsClosing(true);
    
    try {
      // If there are pending syncs, try to sync them first
      if (!isSyncComplete) {
        console.log('📤 sessPrint=1: Syncing pending transactions before close...');
        toast.info('Syncing pending transactions...');
        
        // Attempt to sync
        const syncResult = await syncOfflineReceipts();
        
        // Re-check sync status after sync
        await updateSyncStatus();
        
        // Check again after sync attempt
        const stillUnsynced = await getUnsyncedReceipts();
        const stillPending = stillUnsynced.filter((r: any) => r.type !== 'sale');
        
        if (stillPending.length > 0) {
          if (mountedRef.current) {
            setPendingSyncCount(stillPending.length);
            setIsSyncComplete(false);
          }
          toast.error(`Cannot close: ${stillPending.length} transaction(s) still pending sync`);
          return false;
        }
      }
      
      // All synced - now trigger Z-report print
      console.log('✅ sessPrint=1: All transactions synced, triggering Z-report print...');
      toast.success('All transactions synced! Printing Z-report...');
      
      // Trigger print by navigating to Z-report with print param
      // The Z-report page will auto-print
      const today = selectedDate || new Date().toISOString().split('T')[0];
      
      // Use window.open to print Z-report in background or trigger print dialog
      const printWindow = window.open(`/z-report?date=${today}&autoprint=true`, '_blank');
      
      if (!printWindow) {
        // Fallback: just navigate to Z-report
        window.location.href = `/z-report?date=${today}&autoprint=true`;
      }
      
      // Close the session
      onCloseSuccess();
      return true;
      
    } catch (err) {
      console.error('Session close error:', err);
      toast.error('Failed to close session. Please try again.');
      return false;
    } finally {
      if (mountedRef.current) {
        setIsClosing(false);
      }
    }
  }, [
    sessionPrintOnly, 
    isSyncComplete, 
    syncOfflineReceipts, 
    getUnsyncedReceipts, 
    updateSyncStatus, 
    onCloseSuccess,
    selectedDate
  ]);

  return {
    canClose,
    isClosing,
    pendingSyncCount,
    isSyncComplete,
    closeButtonLabel: getButtonLabel(),
    closeSession
  };
};
