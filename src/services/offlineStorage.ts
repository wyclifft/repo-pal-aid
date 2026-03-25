// Lazy-load @capacitor/core to prevent triggerEvent crash on Android 7 (Chrome 51)

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

let _offlineStorage: OfflineStoragePlugin | null = null;

const getOfflineStorage = async (): Promise<OfflineStoragePlugin | null> => {
  if (_offlineStorage) return _offlineStorage;
  try {
    const { registerPlugin } = await import('@capacitor/core');
    _offlineStorage = registerPlugin<OfflineStoragePlugin>('OfflineStorage');
    return _offlineStorage;
  } catch {
    return null;
  }
};

/**
 * Check if native storage is available (Android app running via Capacitor)
 */
export const isNativeStorageAvailable = (): boolean => {
  try {
    const cap = (window as any).Capacitor;
    if (!cap) return false;
    const isNative = typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : false;
    const platform = cap.getPlatform?.() || cap.platform || 'web';
    return isNative && platform === 'android';
  } catch {
    return false;
  }
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
    const storage = await getOfflineStorage();
    if (!storage) return null;
    const result = await storage.saveRecord({ 
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
    const storage = await getOfflineStorage();
    if (!storage) return [];
    const result = await storage.getUnsyncedRecords(type ? { type } : undefined);
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
    const storage = await getOfflineStorage();
    if (!storage) return false;
    const result = await storage.markAsSynced({ referenceNo, backendId });
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
    const storage = await getOfflineStorage();
    if (!storage) return false;
    const result = await storage.markSyncFailed({ referenceNo, error });
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
    const storage = await getOfflineStorage();
    if (!storage) return { total: 0, synced: 0, unsynced: 0 };
    return await storage.getStats();
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
    const storage = await getOfflineStorage();
    if (!storage) return { triggered: false, pendingCount: 0 };
    return await storage.triggerSync();
  } catch (e) {
    console.error('[STORAGE] Failed to trigger native sync:', e);
    return { triggered: false, pendingCount: 0 };
  }
};

export { getOfflineStorage };
