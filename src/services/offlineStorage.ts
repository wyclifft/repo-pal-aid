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

  setDeviceCode(options: { devCode: string }): Promise<{ success: boolean; deviceCode: string; databaseName: string }>;
  upsertMembers(options: { members: any[] }): Promise<{ success: boolean; count: number }>;
  getMembers(): Promise<{ members: string; count: number }>;
  upsertItems(options: { items: any[] }): Promise<{ success: boolean; count: number }>;
  getItems(): Promise<{ items: string; count: number }>;
  getEmTransactions(): Promise<{ transactions: string; count: number }>;
  upsertUsers(options: { users: any[] }): Promise<{ success: boolean; count: number }>;
  upsertCredits(options: { credits: any[] }): Promise<{ success: boolean; count: number }>;
  upsertTanks(options: { tanks: any[] }): Promise<{ success: boolean; count: number }>;
  upsertSeasons(options: { seasons: any[] }): Promise<{ success: boolean; count: number }>;
}

const OfflineStorage = registerPlugin<OfflineStoragePlugin>('OfflineStorage');

// Cache unsynced queries for 2500ms to eliminate rapid redundant native calls from re-rendering components
const unsyncedCache = new Map<string, { data: any[]; timestamp: number }>();
const inFlightPromises = new Map<string, Promise<any[]>>();
const UNSYNCED_CACHE_TTL_MS = 2500;

export const clearUnsyncedLocalDBCache = (): void => {
  unsyncedCache.clear();
  inFlightPromises.clear();
};

/**
 * Check if native storage is available (Android app running via Capacitor)
 */
export const isNativeStorageAvailable = (): boolean => {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
};

/**
 * Synchronize active device code to native Room database.
 * Switches database name dynamically from default delicoop101_database_AH04 to delicoop101_database_{devCode}.
 */
export const syncNativeDeviceCode = async (devCode: string): Promise<boolean> => {
  if (!isNativeStorageAvailable() || !devCode) return false;
  try {
    const cleanCode = String(devCode).trim();
    if (!cleanCode) return false;
    const result = await OfflineStorage.setDeviceCode({ devCode: cleanCode });
    console.log(`[NATIVE_DB] Device code synced: ${result.deviceCode} -> DB: ${result.databaseName}`);
    return result.success;
  } catch (e) {
    console.error('[NATIVE_DB] Failed to sync device code:', e);
    return false;
  }
};

/**
 * Synchronize farmer/member records to native cm_members table.
 */
export const syncNativeMembers = async (members: any[]): Promise<boolean> => {
  if (!isNativeStorageAvailable() || !members || members.length === 0) return false;
  try {
    const formatted = members.map(f => ({
      descript: f.name || f.descript || '',
      mcode: f.farmer_id || f.mcode || f.mPrefix || '',
      idno: f.national_id || f.idno || '',
      route: f.route_code || f.route || '',
      status: f.status !== undefined ? f.status : 1,
      mstatus: f.mstatus || '',
      ccode: f.ccode || f.company_code || '',
      crbal: String(f.credit_balance || f.crbal || '0'),
      prvqty: Number(f.prev_qty || f.prvqty || 0),
      currqty: Number(f.curr_qty || f.currqty || 0),
      multOpt: f.multOpt || 0
    }));
    const result = await OfflineStorage.upsertMembers({ members: formatted });
    console.log(`[NATIVE_DB] Synced ${result.count} members to native cm_members table`);
    return result.success;
  } catch (e) {
    console.error('[NATIVE_DB] Failed to sync members to native DB:', e);
    return false;
  }
};

/**
 * Synchronize items to native fm_items table.
 */
export const syncNativeItems = async (items: any[]): Promise<boolean> => {
  if (!isNativeStorageAvailable() || !items || items.length === 0) return false;
  try {
    const formatted = items.map(i => ({
      icode: i.icode || i.code || i.ID || '',
      descript: i.descript || i.name || '',
      sprice: Number(i.sprice || i.selling_price || i.price || 0),
      mprice: Number(i.mprice || i.member_price || 0),
      stockbal: Number(i.stockbal || i.stock || 0),
      ccode: i.ccode || '',
      invtype: i.invtype || i.type || ''
    }));
    const result = await OfflineStorage.upsertItems({ items: formatted });
    console.log(`[NATIVE_DB] Synced ${result.count} items to native fm_items table`);
    return result.success;
  } catch (e) {
    console.error('[NATIVE_DB] Failed to sync items to native DB:', e);
    return false;
  }
};

/**
 * Synchronize users to native Users table.
 */
export const syncNativeUsers = async (users: any[]): Promise<boolean> => {
  if (!isNativeStorageAvailable() || !users || users.length === 0) return false;
  try {
    const formatted = users.map(u => ({
      userid: u.userid || u.user_id || u.id || '',
      username: u.username || u.name || '',
      password: u.password || '',
      groupid: u.groupid || '1',
      supervisor: u.supervisor ? 1 : 0,
      astatus: u.astatus !== undefined ? u.astatus : 1,
      c_password: u.c_password || u.cPassword || '',
      email: u.email || '',
      ccode: u.ccode || ''
    }));
    const result = await OfflineStorage.upsertUsers({ users: formatted });
    console.log(`[NATIVE_DB] Synced ${result.count} users to native Users table`);
    return result.success;
  } catch (e) {
    console.error('[NATIVE_DB] Failed to sync users to native DB:', e);
    return false;
  }
};

/**
 * Synchronize tanks/routes to native fm_tanks table.
 */
export const syncNativeTanks = async (tanks: any[]): Promise<boolean> => {
  if (!isNativeStorageAvailable() || !tanks || tanks.length === 0) return false;
  try {
    const formatted = tanks.map(t => ({
      tcode: t.tcode || t.code || '',
      descript: t.descript || t.name || '',
      icode: t.icode || '',
      idesc: t.idesc || '',
      depart: t.depart || '',
      ccode: t.ccode || '',
      cname: t.cname || '',
      caddress: t.caddress || '',
      tel: t.tel || '',
      email: t.email || '',
      mprefix: t.mprefix || 'M'
    }));
    const result = await OfflineStorage.upsertTanks({ tanks: formatted });
    console.log(`[NATIVE_DB] Synced ${result.count} tanks/routes to native fm_tanks table`);
    return result.success;
  } catch (e) {
    console.error('[NATIVE_DB] Failed to sync tanks to native DB:', e);
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

  // Ensure native DB is bound to active devcode
  const devcode = localStorage.getItem('devcode');
  if (devcode) {
    syncNativeDeviceCode(devcode).catch(() => {});
  }
  
  try {
    const result = await OfflineStorage.saveRecord({ 
      referenceNo, 
      recordType, 
      payload, 
      userId, 
      deviceFingerprint 
    });
    clearUnsyncedLocalDBCache();
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
  
  const cacheKey = type || '__ALL__';
  const cached = unsyncedCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < UNSYNCED_CACHE_TTL_MS) {
    return cached.data;
  }

  // Reuse in-flight promise for concurrent requests
  if (inFlightPromises.has(cacheKey)) {
    return inFlightPromises.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    try {
      const result = await OfflineStorage.getUnsyncedRecords(type ? { type } : undefined);
      const records = JSON.parse(result.records);
      unsyncedCache.set(cacheKey, { data: records, timestamp: Date.now() });
      console.log(`[STORAGE] Retrieved ${records.length} unsynced from native DB`);
      return records;
    } catch (e) {
      console.error('[STORAGE] Failed to get unsynced from native DB:', e);
      return [];
    } finally {
      inFlightPromises.delete(cacheKey);
    }
  })();

  inFlightPromises.set(cacheKey, fetchPromise);
  return fetchPromise;
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
    const cleanRef = String(referenceNo || '').trim();
    console.log(`[STORAGE] Attempting to mark synced: ${cleanRef} (backendId=${backendId})`);
    const result = await OfflineStorage.markAsSynced({ referenceNo: cleanRef, backendId });
    clearUnsyncedLocalDBCache();
    if (result.success) {
      console.log(`[STORAGE] RESPONSE: Mark synced SUCCESS for ${cleanRef}`);
    } else {
      console.warn(`[STORAGE] RESPONSE: Mark synced FAILED for ${cleanRef}`);
    }
    return result.success;
  } catch (e) {
    console.error(`[STORAGE] ERROR marking synced in native DB: ${referenceNo}`, e);
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
    clearUnsyncedLocalDBCache();
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

// Auto-sync stored devcode to native Room DB on startup if present in localStorage
if (typeof window !== 'undefined' && isNativeStorageAvailable()) {
  try {
    const cachedDevcode = localStorage.getItem('devcode');
    if (cachedDevcode) {
      syncNativeDeviceCode(cachedDevcode).catch(() => {});
    }
  } catch {}
}

export { OfflineStorage };
