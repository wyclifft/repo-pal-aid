import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useDataSync } from '@/hooks/useDataSync';
import { toast } from 'sonner';

export interface SessionCloseState {
  canClose: boolean;
  isClosing: boolean;
  isSyncingForClose: boolean;
  pendingSyncCount: number;
  isSyncComplete: boolean;
  closeButtonLabel: string;
  showZReportModal: boolean;
  closeSession: () => Promise<boolean>;
  confirmZReportPrinted: () => void;
  cancelZReportModal: () => void;
}

/**
 * Hook to manage session closing behavior based on psettings.sessPrint
 * 
 * sessPrint = 0: Allow session to close without printing Z-report
 * sessPrint = 1: Require all transactions synced before close, show Z-report, then close after user confirms print
 */
export const useSessionClose = (
  onCloseSuccess: () => void,
  selectedDate?: string
): SessionCloseState => {
  const navigate = useNavigate();
  const { sessionPrintOnly } = useAppSettings();
  const { syncOfflineReceipts, isSyncing, pendingCount } = useDataSync();
  const { getUnsyncedReceipts, isReady } = useIndexedDB();
  
  const [isClosing, setIsClosing] = useState(false);
  const [isSyncingForClose, setIsSyncingForClose] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [isSyncComplete, setIsSyncComplete] = useState(true);
  const [showZReportModal, setShowZReportModal] = useState(false);
  const [pendingCloseAfterPrint, setPendingCloseAfterPrint] = useState(false);
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

  // Called when user confirms they've printed/viewed the Z-report
  const confirmZReportPrinted = useCallback(() => {
    console.log('✅ Z-report confirmed, completing session close');
    setShowZReportModal(false);
    setPendingCloseAfterPrint(false);
    setIsClosing(false);
    onCloseSuccess();
    toast.success('Session closed successfully');
  }, [onCloseSuccess]);

  // Called when user cancels Z-report modal
  const cancelZReportModal = useCallback(() => {
    console.log('❌ Z-report modal cancelled');
    setShowZReportModal(false);
    setPendingCloseAfterPrint(false);
    setIsClosing(false);
  }, []);

  // Close session handler
  const closeSession = useCallback(async (): Promise<boolean> => {
    // Refresh sync status first
    await updateSyncStatus();
    
    // If sessPrint is disabled (0), just close immediately
    if (!sessionPrintOnly) {
      console.log('📝 sessPrint=0: Closing session without Z-report');
      onCloseSuccess();
      toast.success('Session closed');
      return true;
    }
    
    // sessPrint = 1: Require sync completion and Z-report view/print
    setIsClosing(true);
    
    try {
      // If there are pending syncs, try to sync them first
      if (!isSyncComplete) {
        console.log('📤 sessPrint=1: Syncing pending transactions before close...');
        setIsSyncingForClose(true);
        
        // Attempt to sync
        await syncOfflineReceipts();
        
        setIsSyncingForClose(false);
        
        // Re-check sync status after sync
        await updateSyncStatus();
        
        // Check again after sync attempt
        const stillUnsynced = await getUnsyncedReceipts();
        const stillPending = stillUnsynced.filter((r: any) => r.type !== 'sale');
        
        if (stillPending.length > 0) {
          if (mountedRef.current) {
            setPendingSyncCount(stillPending.length);
            setIsSyncComplete(false);
            setIsClosing(false);
          }
          toast.error(`Cannot close: ${stillPending.length} transaction(s) still pending sync`);
          return false;
        }
      }
      
      // All synced - show Z-report for viewing/printing
      console.log('✅ sessPrint=1: All transactions synced, showing Z-report...');
      toast.success('All transactions synced! View/print Z-report to complete');
      
      // Navigate to Z-report page with session close mode
      // The user will need to confirm they've viewed/printed before session closes
      const today = selectedDate || new Date().toISOString().split('T')[0];
      setPendingCloseAfterPrint(true);
      setShowZReportModal(true);
      
      // Navigate to Z-report page
      navigate(`/z-report?date=${today}&sessionclose=true`);
      
      return true;
      
    } catch (err) {
      console.error('Session close error:', err);
      toast.error('Failed to close session. Please try again.');
      if (mountedRef.current) {
        setIsClosing(false);
        setIsSyncingForClose(false);
      }
      return false;
    }
  }, [
    sessionPrintOnly, 
    isSyncComplete, 
    syncOfflineReceipts, 
    getUnsyncedReceipts, 
    updateSyncStatus, 
    onCloseSuccess,
    selectedDate,
    navigate
  ]);

  return {
    canClose,
    isClosing,
    isSyncingForClose,
    pendingSyncCount,
    isSyncComplete,
    closeButtonLabel: getButtonLabel(),
    showZReportModal,
    closeSession,
    confirmZReportPrinted,
    cancelZReportModal
  };
};
