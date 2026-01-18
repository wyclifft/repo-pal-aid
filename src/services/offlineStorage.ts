import { registerPlugin } from '@capacitor/core';

export interface OfflineStoragePlugin {
  saveRecord(options: {
    referenceNo: string;
    recordType: string;
    payload: object;
    userId?: string;
    deviceFingerprint?: string;
  }): Promise<{ id: number; success: boolean }>;
  
  getUnsyncedRecords(options?: { type?: string }): Promise<{ records: string }>;
  getUnsyncedCount(): Promise<{ count: number }>;
  markAsSynced(options: { id?: number; referenceNo?: string; backendId?: number }): Promise<{ success: boolean }>;
  triggerSync(): Promise<{ triggered: boolean }>;
  getStats(): Promise<{ total: number; synced: number; unsynced: number }>;
}

const OfflineStorage = registerPlugin<OfflineStoragePlugin>('OfflineStorage');

export const saveToLocalDB = async (
  referenceNo: string,
  recordType: 'milk_collection' | 'store_sale' | 'ai_sale',
  payload: object,
  userId?: string,
  deviceFingerprint?: string
) => {
  try {
    return await OfflineStorage.saveRecord({ referenceNo, recordType, payload, userId, deviceFingerprint });
  } catch (e) {
    console.log('[STORAGE] Native storage unavailable, using IndexedDB fallback');
    return null;
  }
};

export const getUnsyncedFromLocalDB = async (type?: string) => {
  try {
    const result = await OfflineStorage.getUnsyncedRecords(type ? { type } : undefined);
    return JSON.parse(result.records);
  } catch {
    return [];
  }
};

export const getLocalDBStats = async () => {
  try {
    return await OfflineStorage.getStats();
  } catch {
    return { total: 0, synced: 0, unsynced: 0 };
  }
};

export const triggerNativeSync = async () => {
  try {
    return await OfflineStorage.triggerSync();
  } catch {
    return { triggered: false };
  }
};

export { OfflineStorage };
