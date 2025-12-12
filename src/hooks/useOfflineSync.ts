/**
 * Unified Offline Sync Hook
 * Handles all offline data synchronization with deduplication and conflict resolution
 */
import { useCallback, useRef, useEffect, useState } from 'react';
import { useIndexedDB } from './useIndexedDB';
import { milkCollectionApi, salesApi } from '@/services/mysqlApi';
import { nativeUtils } from './useNativePlatform';
import { deduplicateReceipts } from './useSyncManager';
import { toast } from '@/hooks/use-toast';

// Sync configuration
const SYNC_CONFIG = {
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 2000,
  BATCH_SIZE: 10,
  DEBOUNCE_MS: 1000,
};

interface SyncState {
  isSyncing: boolean;
  lastSyncTime: number | null;
  pendingCount: number;
  syncProgress: { synced: number; total: number } | null;
  error: string | null;
}

export const useOfflineSync = () => {
  const { 
    getUnsyncedReceipts, 
    deleteReceipt, 
    getUnsyncedSales, 
    deleteSale,
    isReady 
  } = useIndexedDB();
  
  const [syncState, setSyncState] = useState<SyncState>({
    isSyncing: false,
    lastSyncTime: null,
    pendingCount: 0,
    syncProgress: null,
    error: null,
  });
  
  const syncLockRef = useRef(false);
  const syncDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  /**
   * Update pending count
   */
  const updatePendingCount = useCallback(async () => {
    if (!isReady) return;
    
    try {
      const [receipts, sales] = await Promise.all([
        getUnsyncedReceipts().catch(() => []),
        getUnsyncedSales().catch(() => []),
      ]);
      
      if (mountedRef.current) {
        setSyncState(prev => ({
          ...prev,
          pendingCount: receipts.length + sales.length,
        }));
      }
    } catch (error) {
      console.warn('Failed to update pending count:', error);
    }
  }, [isReady, getUnsyncedReceipts, getUnsyncedSales]);

  /**
   * Sync a single receipt with retry logic
   */
  const syncReceipt = useCallback(async (receipt: any, retryCount = 0): Promise<boolean> => {
    try {
      const result = await milkCollectionApi.create({
        reference_no: receipt.reference_no,
        farmer_id: receipt.farmer_id,
        farmer_name: receipt.farmer_name,
        route: receipt.route,
        session: receipt.session,
        weight: receipt.weight,
        clerk_name: receipt.clerk_name,
        collection_date: receipt.collection_date,
      });
      
      if (result.success) {
        await deleteReceipt(receipt.orderId);
        return true;
      }
      
      throw new Error('Sync failed');
    } catch (error) {
      console.error(`Sync failed for receipt ${receipt.orderId}:`, error);
      
      if (retryCount < SYNC_CONFIG.MAX_RETRIES) {
        await new Promise(resolve => 
          setTimeout(resolve, SYNC_CONFIG.RETRY_DELAY_MS * (retryCount + 1))
        );
        return syncReceipt(receipt, retryCount + 1);
      }
      
      return false;
    }
  }, [deleteReceipt]);

  /**
   * Sync a single sale with retry logic
   */
  const syncSale = useCallback(async (sale: any, retryCount = 0): Promise<boolean> => {
    try {
      const success = await salesApi.create({
        farmer_id: sale.farmer_id,
        farmer_name: sale.farmer_name,
        item_code: sale.item_code,
        item_name: sale.item_name,
        quantity: sale.quantity,
        price: sale.price,
        sold_by: sale.sold_by,
        device_fingerprint: sale.uniquedevcode || sale.device_fingerprint,
      });
      
      if (success) {
        await deleteSale(sale.orderId);
        return true;
      }
      
      throw new Error('Sale sync failed');
    } catch (error) {
      console.error(`Sync failed for sale ${sale.orderId}:`, error);
      
      if (retryCount < SYNC_CONFIG.MAX_RETRIES) {
        await new Promise(resolve => 
          setTimeout(resolve, SYNC_CONFIG.RETRY_DELAY_MS * (retryCount + 1))
        );
        return syncSale(sale, retryCount + 1);
      }
      
      return false;
    }
  }, [deleteSale]);

  /**
   * Main sync function - syncs all pending data
   */
  const syncAllPending = useCallback(async (silent = false): Promise<{ success: boolean; synced: number; failed: number }> => {
    // Prevent concurrent syncs
    if (syncLockRef.current) {
      console.log('⏸️ Sync already in progress');
      return { success: false, synced: 0, failed: 0 };
    }
    
    // Check network status
    const isOnline = await nativeUtils.getNetworkStatus();
    if (!isOnline) {
      console.log('📴 Offline - skipping sync');
      return { success: false, synced: 0, failed: 0 };
    }
    
    syncLockRef.current = true;
    setSyncState(prev => ({ ...prev, isSyncing: true, error: null }));
    
    let syncedCount = 0;
    let failedCount = 0;
    
    try {
      // Get pending items
      const [receipts, sales] = await Promise.all([
        getUnsyncedReceipts().catch(() => []),
        getUnsyncedSales().catch(() => []),
      ]);
      
      // Deduplicate receipts
      const uniqueReceipts = deduplicateReceipts(receipts);
      const totalItems = uniqueReceipts.length + sales.length;
      
      if (totalItems === 0) {
        console.log('✅ No pending items to sync');
        return { success: true, synced: 0, failed: 0 };
      }
      
      console.log(`📤 Syncing ${totalItems} items (${uniqueReceipts.length} receipts, ${sales.length} sales)`);
      
      if (!silent) {
        toast({
          title: 'Syncing data...',
          description: `${totalItems} items pending`,
        });
      }
      
      // Update progress
      setSyncState(prev => ({
        ...prev,
        syncProgress: { synced: 0, total: totalItems },
      }));
      
      // Sync receipts in batches
      for (let i = 0; i < uniqueReceipts.length; i += SYNC_CONFIG.BATCH_SIZE) {
        const batch = uniqueReceipts.slice(i, i + SYNC_CONFIG.BATCH_SIZE);
        const results = await Promise.all(batch.map(r => syncReceipt(r)));
        
        const batchSynced = results.filter(Boolean).length;
        syncedCount += batchSynced;
        failedCount += results.length - batchSynced;
        
        if (mountedRef.current) {
          setSyncState(prev => ({
            ...prev,
            syncProgress: { synced: syncedCount, total: totalItems },
          }));
        }
        
        // Trigger haptic on each batch
        await nativeUtils.triggerHaptic('light');
      }
      
      // Sync sales in batches
      for (let i = 0; i < sales.length; i += SYNC_CONFIG.BATCH_SIZE) {
        const batch = sales.slice(i, i + SYNC_CONFIG.BATCH_SIZE);
        const results = await Promise.all(batch.map(s => syncSale(s)));
        
        const batchSynced = results.filter(Boolean).length;
        syncedCount += batchSynced;
        failedCount += results.length - batchSynced;
        
        if (mountedRef.current) {
          setSyncState(prev => ({
            ...prev,
            syncProgress: { synced: syncedCount, total: totalItems },
          }));
        }
      }
      
      // Success feedback
      if (syncedCount > 0 && !silent) {
        await nativeUtils.triggerHaptic('heavy');
        toast({
          title: 'Sync complete',
          description: `${syncedCount} items synced${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
        });
      }
      
      console.log(`✅ Sync complete: ${syncedCount} synced, ${failedCount} failed`);
      
      return { success: true, synced: syncedCount, failed: failedCount };
    } catch (error) {
      console.error('❌ Sync failed:', error);
      
      if (!silent) {
        await nativeUtils.triggerHaptic('heavy');
        toast({
          title: 'Sync failed',
          description: 'Will retry when connection is stable',
          variant: 'destructive',
        });
      }
      
      setSyncState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Sync failed',
      }));
      
      return { success: false, synced: syncedCount, failed: failedCount };
    } finally {
      syncLockRef.current = false;
      
      if (mountedRef.current) {
        setSyncState(prev => ({
          ...prev,
          isSyncing: false,
          lastSyncTime: Date.now(),
          syncProgress: null,
        }));
        
        // Update pending count
        await updatePendingCount();
      }
    }
  }, [getUnsyncedReceipts, getUnsyncedSales, syncReceipt, syncSale, updatePendingCount]);

  /**
   * Debounced sync trigger
   */
  const triggerSync = useCallback((silent = false) => {
    if (syncDebounceRef.current) {
      clearTimeout(syncDebounceRef.current);
    }
    
    syncDebounceRef.current = setTimeout(() => {
      syncAllPending(silent);
    }, SYNC_CONFIG.DEBOUNCE_MS);
  }, [syncAllPending]);

  /**
   * Force immediate sync (bypasses debounce)
   */
  const forceSync = useCallback(async () => {
    if (syncDebounceRef.current) {
      clearTimeout(syncDebounceRef.current);
    }
    return syncAllPending(false);
  }, [syncAllPending]);

  // Update pending count on mount and when ready
  useEffect(() => {
    if (isReady) {
      updatePendingCount();
    }
  }, [isReady, updatePendingCount]);

  // Cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (syncDebounceRef.current) {
        clearTimeout(syncDebounceRef.current);
      }
    };
  }, []);

  return {
    ...syncState,
    triggerSync,
    forceSync,
    updatePendingCount,
    isReady,
  };
};
