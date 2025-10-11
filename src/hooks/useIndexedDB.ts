import { useEffect, useState, useCallback } from 'react';
import type { Farmer, AppUser, MilkCollection } from '@/lib/supabase';

const DB_NAME = 'milkCollectionDB';
const DB_VERSION = 1;

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
    store.put(receipt);
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

  return {
    db,
    isReady,
    saveFarmers,
    getFarmers,
    saveUser,
    getUser,
    saveReceipt,
    getUnsyncedReceipts,
  };
};
