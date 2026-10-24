import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIndexedDB } from '@/hooks/useIndexedDB';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useSync } from '@/contexts/SyncContext';
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
  const { sessionPrintOnly, isCoffee } = useAppSettings();
  const { syncOfflineReceipts, isSyncing, pendingCount } = useSync();
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

  // Determine total pending count
  const totalPending = Math.max(pendingSyncCount, pendingCount || 0);
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  // Determine if session can be closed (Operators can always close sessions)
  const canClose = !isSyncing && !isClosing;

  // Dynamic button label
  const getButtonLabel = (): string => {
    if (isClosing) return 'Closing...';
    if (isSyncing) return 'Syncing...';
    return 'Close Session';
  };

  // Called when user confirms they've printed/viewed the Z-report
  const confirmZReportPrinted = useCallback(() => {
    console.log('✅ Z-report confirmed, completing session close');
    setShowZReportModal(false);
    setPendingCloseAfterPrint(false);
    setIsClosing(false);
    onCloseSuccess();
    toast.success('Session closed');
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
    
    const currentlyOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const currentPending = Math.max(pendingSyncCount, pendingCount || 0);

    // If offline or sessPrint disabled, close session cleanly without navigating to Z-report
    if (!currentlyOnline || !sessionPrintOnly || isCoffee) {
      console.log('📝 Closing session directly (offline or Z-report requirement disabled)');
      onCloseSuccess();
      toast.success('Session closed');
      return true;
    }

    setIsClosing(true);

    try {
      let remainingPending = currentPending;

      // If online with pending transactions, attempt background sync first
      if (currentlyOnline && currentPending > 0) {
        console.log('📤 Syncing pending transactions before session close...');
        setIsSyncingForClose(true);

        try {
          await syncOfflineReceipts();
        } catch (sErr) {
          console.warn('Pre-close sync error:', sErr);
        }

        setIsSyncingForClose(false);
        await updateSyncStatus();

        const stillUnsynced = await getUnsyncedReceipts();
        remainingPending = Math.max(stillUnsynced.filter((r: any) => r.type !== 'sale').length, pendingCount || 0);
      }

      // If still offline or pending transactions remain, close session cleanly without Z-report
      if (remainingPending > 0 || !navigator.onLine) {
        console.log('📝 Closing session cleanly (Z-report omitted due to pending sync or offline state)');
        onCloseSuccess();
        toast.success('Session closed');
        if (mountedRef.current) {
          setIsClosing(false);
        }
        return true;
      }

      // All synced and online - show Z-report for viewing/printing
      console.log('✅ All transactions synced, showing Z-report...');
      const today = selectedDate || new Date().toISOString().split('T')[0];
      setPendingCloseAfterPrint(true);
      setShowZReportModal(true);

      navigate(`/z-report?date=${today}&sessionclose=true`);

      return true;

    } catch (err) {
      console.error('Session close error:', err);
      // Fallback: close session cleanly on error so operator is never blocked
      onCloseSuccess();
      toast.success('Session closed');
      if (mountedRef.current) {
        setIsClosing(false);
        setIsSyncingForClose(false);
      }
      return true;
    }
  }, [
    sessionPrintOnly,
    isCoffee,
    pendingCount,
    pendingSyncCount,
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
