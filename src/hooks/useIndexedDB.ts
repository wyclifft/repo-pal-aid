import { useEffect, useState, useCallback } from 'react';
import type { Farmer, AppUser, MilkCollection } from '@/lib/supabase';

const DB_NAME = 'milkCollectionDB';
const DB_VERSION = 5;

let dbInstance: IDBDatabase | null = null;

export const useIndexedDB = () => {
  const [db, setDb] = useState<IDBDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (dbInstance) {
      setDb(dbInstance);
      setIsReady(true);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains('receipts')) {
        const store = database.createObjectStore('receipts', { keyPath: 'orderId' });
        store.createIndex('synced', 'synced', { unique: false });
      }

      if (!database.objectStoreNames.contains('farmers')) {
        database.createObjectStore('farmers', { keyPath: 'farmer_id' });
      }

      if (!database.objectStoreNames.contains('app_users')) {
        database.createObjectStore('app_users', { keyPath: 'user_id' });
      }

      // Recreate device_approvals with new keyPath (fingerprint instead of device_id)
      if (database.objectStoreNames.contains('device_approvals')) {
        database.deleteObjectStore('device_approvals');
      }
      database.createObjectStore('device_approvals', { keyPath: 'device_fingerprint' });

      // Add items store for offline caching
      if (!database.objectStoreNames.contains('items')) {
        database.createObjectStore('items', { keyPath: 'ID' });
      }

      // Add z_reports store for offline Z Reports
      if (!database.objectStoreNames.contains('z_reports')) {
        database.createObjectStore('z_reports', { keyPath: 'date' });
      }

      // Add periodic_reports store for offline Periodic Reports
      if (!database.objectStoreNames.contains('periodic_reports')) {
        database.createObjectStore('periodic_reports', { keyPath: 'cacheKey' });
      }
    };

    request.onsuccess = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      dbInstance = database;
      setDb(database);
      setIsReady(true);
      console.log('IndexedDB ready ✅');
    };

    request.onerror = (event) => {
      console.error('IndexedDB error:', (event.target as IDBOpenDBRequest).error);
    };

    return () => {
      if (dbInstance && db) {
        dbInstance.close();
        dbInstance = null;
      }
    };
  }, []);

  const saveFarmers = useCallback((farmers: Farmer[]) => {
    if (!db) return;
    const tx = db.transaction('farmers', 'readwrite');
    const store = tx.objectStore('farmers');
    farmers.forEach((farmer) => store.put(farmer));
  }, [db]);

  const getFarmers = useCallback((): Promise<Farmer[]> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject('DB not ready');
      const tx = db.transaction('farmers', 'readonly');
      const store = tx.objectStore('farmers');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, [db]);

  const saveUser = useCallback((user: AppUser) => {
    if (!db) return;
    const tx = db.transaction('app_users', 'readwrite');
    const store = tx.objectStore('app_users');
    store.put(user);
  }, [db]);

  const getUser = useCallback((userId: string): Promise<AppUser | undefined> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject('DB not ready');
      const tx = db.transaction('app_users', 'readonly');
      const store = tx.objectStore('app_users');
      const request = store.get(userId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, [db]);

  const saveReceipt = useCallback((receipt: MilkCollection) => {
    if (!db) return;
    const tx = db.transaction('receipts', 'readwrite');
    const store = tx.objectStore('receipts');
    
    // Ensure orderId exists for IndexedDB key
    const receiptWithId = {
      ...receipt,
      orderId: receipt.orderId || Date.now(),
    };
    
    store.put(receiptWithId);
  }, [db]);

  const getUnsyncedReceipts = useCallback((): Promise<MilkCollection[]> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject('DB not ready');
      const tx = db.transaction('receipts', 'readonly');
      const store = tx.objectStore('receipts');
      const request = store.getAll();
      request.onsuccess = () => {
        const unsynced = request.result.filter((r: MilkCollection) => !r.synced);
        resolve(unsynced);
      };
      request.onerror = () => reject(request.error);
    });
  }, [db]);

  const deleteReceipt = useCallback((orderId: number) => {
    if (!db) return;
    const tx = db.transaction('receipts', 'readwrite');
    const store = tx.objectStore('receipts');
    store.delete(orderId);
  }, [db]);

  const saveDeviceApproval = useCallback((deviceFingerprint: string, backendId: number | null, userId: string, approved: boolean) => {
    if (!db) return;
    const tx = db.transaction('device_approvals', 'readwrite');
    const store = tx.objectStore('device_approvals');
    store.put({ 
      device_fingerprint: deviceFingerprint, 
      backend_id: backendId,
      user_id: userId, 
      approved, 
      last_synced: new Date().toISOString() 
    });
  }, [db]);

  const getDeviceApproval = useCallback((deviceFingerprint: string): Promise<{ device_fingerprint: string; backend_id: number | null; user_id: string; approved: boolean; last_synced: string } | undefined> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject('DB not ready');
      const tx = db.transaction('device_approvals', 'readonly');
      const store = tx.objectStore('device_approvals');
      const request = store.get(deviceFingerprint);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, [db]);

  const saveSale = useCallback(async (sale: any) => {
    if (!db) return;

    try {
      const tx = db.transaction('receipts', 'readwrite');
      const store = tx.objectStore('receipts');
      
      // Use receipts store for sales with a unique ID
      const saleRecord = {
        ...sale,
        orderId: Date.now(),
        type: 'sale',
        synced: false,
      };
      
      await store.put(saleRecord);
      console.log('Sale saved to IndexedDB');
    } catch (error) {
      console.error('Failed to save sale to IndexedDB:', error);
      throw error;
    }
  }, [db]);

  const getUnsyncedSales = useCallback(async (): Promise<any[]> => {
    if (!db) return [];

    try {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('receipts', 'readonly');
        const store = tx.objectStore('receipts');
        const request = store.getAll();
        
        request.onsuccess = () => {
          // Filter for unsynced sales
          const sales = request.result.filter((record: any) => record.type === 'sale' && !record.synced);
          resolve(sales);
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to get unsynced sales:', error);
      return [];
    }
  }, [db]);

  const deleteSale = useCallback(async (orderId: number) => {
    if (!db) return;

    try {
      const tx = db.transaction('receipts', 'readwrite');
      const store = tx.objectStore('receipts');
      await store.delete(orderId);
      console.log('Sale deleted from IndexedDB');
    } catch (error) {
      console.error('Failed to delete sale:', error);
      throw error;
    }
  }, [db]);

  const saveItems = useCallback((items: any[]) => {
    if (!db) return;
    const tx = db.transaction('items', 'readwrite');
    const store = tx.objectStore('items');
    items.forEach((item) => store.put(item));
    console.log('Items cached in IndexedDB');
  }, [db]);

  const getItems = useCallback((): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject('DB not ready');
      const tx = db.transaction('items', 'readonly');
      const store = tx.objectStore('items');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }, [db]);

  /**
   * Save Z Report data to IndexedDB
   */
  const saveZReport = useCallback(async (date: string, data: any) => {
    if (!db) return;
    try {
      const tx = db.transaction('z_reports', 'readwrite');
      const store = tx.objectStore('z_reports');
      await store.put({ date, data, timestamp: Date.now() });
      console.log('Z Report cached successfully');
    } catch (error) {
      console.error('Failed to cache Z Report:', error);
    }
  }, [db]);

  /**
   * Get Z Report data from IndexedDB
   */
  const getZReport = useCallback(async (date: string): Promise<any | null> => {
    if (!db) return null;
    try {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('z_reports', 'readonly');
        const store = tx.objectStore('z_reports');
        const request = store.get(date);
        request.onsuccess = () => resolve(request.result?.data || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to get Z Report from cache:', error);
      return null;
    }
  }, [db]);

  /**
   * Save Periodic Report data to IndexedDB
   */
  const savePeriodicReport = useCallback(async (cacheKey: string, data: any) => {
    if (!db) return;
    try {
      const tx = db.transaction('periodic_reports', 'readwrite');
      const store = tx.objectStore('periodic_reports');
      await store.put({ cacheKey, data, timestamp: Date.now() });
      console.log('Periodic Report cached successfully');
    } catch (error) {
      console.error('Failed to cache Periodic Report:', error);
    }
  }, [db]);

  /**
   * Get Periodic Report data from IndexedDB
   */
  const getPeriodicReport = useCallback(async (cacheKey: string): Promise<any | null> => {
    if (!db) return null;
    try {
      return new Promise((resolve, reject) => {
        const tx = db.transaction('periodic_reports', 'readonly');
        const store = tx.objectStore('periodic_reports');
        const request = store.get(cacheKey);
        request.onsuccess = () => resolve(request.result?.data || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to get Periodic Report from cache:', error);
      return null;
    }
  }, [db]);

  return {
    db,
    isReady,
    saveFarmers,
    getFarmers,
    saveUser,
    getUser,
    saveReceipt,
    getUnsyncedReceipts,
    deleteReceipt,
    saveDeviceApproval,
    getDeviceApproval,
    saveSale,
    getUnsyncedSales,
    deleteSale,
    saveItems,
    getItems,
    saveZReport,
    getZReport,
    savePeriodicReport,
    getPeriodicReport,
  };
};
