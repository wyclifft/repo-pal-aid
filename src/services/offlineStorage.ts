import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

export interface OfflineStoragePlugin {
  saveRecord(options: {
    referenceNo: string;
    recordType: string;
    payload: object;
    userId?: string;
    deviceFingerprint?: string;
  }): Promise<{ id: number; success: boolean; duplicate?: boolean }>;
  
  getUnsyncedRecords(options?: { type?: string }): Promise<{ records: string; count: number }>;
  getUnsyncedCount(): Promise<{ count: number }>;
  markAsSynced(options: { id?: number; referenceNo?: string; backendId?: number }): Promise<{ success: boolean }>;
  markSyncFailed(options: { id?: number; referenceNo?: string; error: string }): Promise<{ success: boolean }>;
  triggerSync(): Promise<{ triggered: boolean; pendingCount: number }>;
  getStats(): Promise<{ total: number; synced: number; unsynced: number }>;
}

const OfflineStorage = registerPlugin<OfflineStoragePlugin>('OfflineStorage');

/**
 * Check if native storage is available (Android app running via Capacitor)
 */
export const isNativeStorageAvailable = (): boolean => {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
};

/**
 * Save a record to the native encrypted SQLite database.
 * This is the PRIMARY storage for offline data - ensures NO DATA LOSS.
 * Falls back gracefully on web platform.
 */
export const saveToLocalDB = async (
  referenceNo: string,
  recordType: 'milk_collection' | 'store_sale' | 'ai_sale',
  payload: object,
  userId?: string,
  deviceFingerprint?: string
): Promise<{ id: number; success: boolean } | null> => {
  if (!isNativeStorageAvailable()) {
    console.log('[STORAGE] Native storage unavailable, using IndexedDB fallback');
    return null;
  }
  
  try {
    const result = await OfflineStorage.saveRecord({ 
      referenceNo, 
      recordType, 
      payload, 
      userId, 
      deviceFingerprint 
    });
    console.log(`[STORAGE] Saved to native DB: ${referenceNo} (id=${result.id})`);
    return result;
  } catch (e) {
    console.error('[STORAGE] Native save failed:', e);
    return null;
  }
};

/**
 * Get all unsynced records from native storage
 */
export const getUnsyncedFromLocalDB = async (type?: string): Promise<any[]> => {
  if (!isNativeStorageAvailable()) {
    return [];
  }
  
  try {
    const result = await OfflineStorage.getUnsyncedRecords(type ? { type } : undefined);
    const records = JSON.parse(result.records);
    console.log(`[STORAGE] Retrieved ${records.length} unsynced from native DB`);
    return records;
  } catch (e) {
    console.error('[STORAGE] Failed to get unsynced from native DB:', e);
    return [];
  }
};

/**
 * Mark a record as synced in native storage
 */
export const markNativeRecordSynced = async (
  referenceNo: string, 
  backendId?: number
): Promise<boolean> => {
  if (!isNativeStorageAvailable()) {
    return false;
  }
  
  try {
    const result = await OfflineStorage.markAsSynced({ referenceNo, backendId });
    if (result.success) {
      console.log(`[STORAGE] Marked synced in native DB: ${referenceNo}`);
    }
    return result.success;
  } catch (e) {
    console.error('[STORAGE] Failed to mark synced in native DB:', e);
    return false;
  }
};

/**
 * Mark a record as sync failed in native storage
 */
export const markNativeRecordFailed = async (
  referenceNo: string, 
  error: string
): Promise<boolean> => {
  if (!isNativeStorageAvailable()) {
    return false;
  }
  
  try {
    const result = await OfflineStorage.markSyncFailed({ referenceNo, error });
    return result.success;
  } catch (e) {
    console.error('[STORAGE] Failed to mark failed in native DB:', e);
    return false;
  }
};

/**
 * Get native storage statistics
 */
export const getLocalDBStats = async (): Promise<{ total: number; synced: number; unsynced: number }> => {
  if (!isNativeStorageAvailable()) {
    return { total: 0, synced: 0, unsynced: 0 };
  }
  
  try {
    return await OfflineStorage.getStats();
  } catch (e) {
    console.error('[STORAGE] Failed to get stats from native DB:', e);
    return { total: 0, synced: 0, unsynced: 0 };
  }
};

/**
 * Trigger a sync check in native storage
 */
export const triggerNativeSync = async (): Promise<{ triggered: boolean; pendingCount: number }> => {
  if (!isNativeStorageAvailable()) {
    return { triggered: false, pendingCount: 0 };
  }
  
  try {
    return await OfflineStorage.triggerSync();
  } catch (e) {
    console.error('[STORAGE] Failed to trigger native sync:', e);
    return { triggered: false, pendingCount: 0 };
  }
};

export { OfflineStorage };
