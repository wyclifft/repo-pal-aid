import { useRef, useCallback, useEffect } from 'react';

// Global singleton to prevent multiple sync managers
let globalSyncLock = false;
let lastSyncTimestamp = 0;
const SYNC_DEBOUNCE_MS = 3000; // Minimum 3 seconds between syncs
const onlineHandlers = new Set<() => void>();
let onlineListenerAttached = false;

// Centralized online event handler - only one listener for the entire app
const initOnlineListener = () => {
  if (typeof window !== 'undefined' && !onlineListenerAttached) {
    const handleOnline = () => {
      console.log('📡 App back online - triggering sync handlers');
      onlineHandlers.forEach(handler => handler());
    };
    window.addEventListener('online', handleOnline);
    onlineListenerAttached = true;
  }
};

// Initialize on module load
initOnlineListener();

export const useSyncManager = () => {
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const acquireLock = useCallback((): boolean => {
    const now = Date.now();
    
    // Check debounce
    if (now - lastSyncTimestamp < SYNC_DEBOUNCE_MS) {
      console.log('⏸️ Sync debounced - too soon after last sync');
      return false;
    }
    
    // Check lock
    if (globalSyncLock) {
      console.log('⏸️ Sync locked - another sync in progress');
      return false;
    }
    
    globalSyncLock = true;
    lastSyncTimestamp = now;
    return true;
  }, []);

  const releaseLock = useCallback(() => {
    globalSyncLock = false;
  }, []);

  const isLocked = useCallback(() => globalSyncLock, []);

  const registerOnlineHandler = useCallback((handler: () => void) => {
    onlineHandlers.add(handler);
    return () => {
      onlineHandlers.delete(handler);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  return {
    acquireLock,
    releaseLock,
    isLocked,
    registerOnlineHandler,
  };
};

// Utility to deduplicate receipts by reference number
export const deduplicateReceipts = <T extends { reference_no?: string; orderId?: number }>(
  receipts: T[]
): T[] => {
  const seen = new Map<string, T>();
  
  for (const receipt of receipts) {
    const key = receipt.reference_no || `order_${receipt.orderId}`;
    if (!seen.has(key)) {
      seen.set(key, receipt);
    } else {
      console.log(`🔄 Skipping duplicate receipt: ${key}`);
    }
  }
  
  return Array.from(seen.values());
};
