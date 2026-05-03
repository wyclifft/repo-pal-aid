import { useEffect, useState, useCallback } from 'react';
import type { Farmer, AppUser, MilkCollection } from '@/lib/supabase';

const DB_NAME = 'milkCollectionDB';
const DB_VERSION = 13; // v2.10.75: add transactions_cache store for offline Periodic Report engine

let dbInstance: IDBDatabase | null = null;

// Helper function to clear corrupted database
const clearDatabase = async (): Promise<void> => {
  return new Promise((resolve, reject) => {
    console.log('[DB] Clearing corrupted database...');
    const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
    
    deleteRequest.onsuccess = () => {
      console.log('[DB] Database cleared successfully');
      dbInstance = null;
      resolve();
    };
    
    deleteRequest.onerror = () => {
      console.error('[DB] Failed to clear database:', deleteRequest.error);
      reject(deleteRequest.error);
    };
    
    deleteRequest.onblocked = () => {
      console.warn('[DB] Database deletion blocked - close all tabs');
    };
  });
};

export const useIndexedDB = () => {
  const [db, setDb] = useState<IDBDatabase | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [schemaError, setSchemaError] = useState(false);

  useEffect(() => {
    if (dbInstance && !schemaError) {
      setDb(dbInstance);
      setIsReady(true);
      return;
    }

    const openDatabase = () => {
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

      // Only recreate device_approvals if keyPath is wrong — preserve data on normal upgrades
      if (database.objectStoreNames.contains('device_approvals')) {
        try {
          const existingStore = (event.target as IDBOpenDBRequest).transaction!.objectStore('device_approvals');
          if (existingStore.keyPath !== 'device_fingerprint') {
            console.log('[DB] device_approvals keyPath mismatch, recreating store');
            database.deleteObjectStore('device_approvals');
            database.createObjectStore('device_approvals', { keyPath: 'device_fingerprint' });
          } else {
            console.log('[DB] device_approvals store preserved with correct keyPath');
          }
        } catch (e) {
          console.warn('[DB] Could not verify device_approvals, recreating:', e);
          database.deleteObjectStore('device_approvals');
          database.createObjectStore('device_approvals', { keyPath: 'device_fingerprint' });
        }
      } else {
        database.createObjectStore('device_approvals', { keyPath: 'device_fingerprint' });
        console.log('[DB] Created device_approvals store with keyPath: device_fingerprint');
      }

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

      // Add routes store for offline route caching (fm_tanks)
      if (!database.objectStoreNames.contains('routes')) {
        database.createObjectStore('routes', { keyPath: 'tcode' });
      }

      // Add sessions store for offline session caching
      if (!database.objectStoreNames.contains('sessions')) {
        database.createObjectStore('sessions', { keyPath: 'descript' });
      }

      // Add device_config store for offline reference generation
      if (!database.objectStoreNames.contains('device_config')) {
        database.createObjectStore('device_config', { keyPath: 'id' });
        console.log('[DB] Created device_config store');
      }

      // farmer_cumulative store for offline cumulative tracking
      // v2.10.73: cacheKey now includes route for per-factory isolation.
      // On upgrade we wipe and recreate the store so old farmer-month-only keys
      // don't leak across factories. Data is recoverable from backend on next sync.
      if (database.objectStoreNames.contains('farmer_cumulative')) {
        try {
          database.deleteObjectStore('farmer_cumulative');
          console.log('[DB] v2.10.73 migration: dropped legacy farmer_cumulative store (will rebuild from backend)');
        } catch (e) {
          console.warn('[DB] Failed to drop legacy farmer_cumulative store:', e);
        }
      }
      const cumStore = database.createObjectStore('farmer_cumulative', { keyPath: 'cacheKey' });
      cumStore.createIndex('farmer_route_month', ['farmer_id', 'route', 'month'], { unique: true });
      console.log('[DB] Created farmer_cumulative store (v2.10.73 schema: farmer+route+month key)');

      // Add dedicated printed_receipts store (Bug 4 fix: remove mixed-type key from receipts store)
      if (!database.objectStoreNames.contains('printed_receipts')) {
        database.createObjectStore('printed_receipts', { keyPath: 'id' });
        console.log('[DB] Created printed_receipts store');
        
        // Migrate existing PRINTED_RECEIPTS from receipts store if it exists
        if (database.objectStoreNames.contains('receipts')) {
          try {
            const receiptStore = (event.target as IDBOpenDBRequest).transaction!.objectStore('receipts');
            const getReq = receiptStore.get('PRINTED_RECEIPTS');
            getReq.onsuccess = () => {
              if (getReq.result) {
                const printedStore = (event.target as IDBOpenDBRequest).transaction!.objectStore('printed_receipts');
                printedStore.put({ id: 'default', receipts: getReq.result.receipts || [], lastUpdated: new Date() });
                receiptStore.delete('PRINTED_RECEIPTS');
                console.log('[DB] Migrated PRINTED_RECEIPTS to dedicated store');
              }
            };
          } catch (migErr) {
            console.warn('[DB] Could not migrate printed receipts:', migErr);
          }
        }
      }

      // v2.10.75: transactions_cache — rolling local mirror of recent backend
      // transactions, used to build the Periodic Report fully offline. Additive
      // store, never displayed directly. Keyed by transrefno (unique).
      if (!database.objectStoreNames.contains('transactions_cache')) {
        const txStore = database.createObjectStore('transactions_cache', { keyPath: 'transrefno' });
        txStore.createIndex('transdate', 'transdate', { unique: false });
        txStore.createIndex('farmer_id', 'farmer_id', { unique: false });
        txStore.createIndex('tcode', 'tcode', { unique: false });
        console.log('[DB] Created transactions_cache store (v2.10.75)');
      }
    };

    request.onsuccess = (event) => {
      try {
        const database = (event.target as IDBOpenDBRequest).result;
        
        // Verify device_approvals store configuration
        if (database.objectStoreNames.contains('device_approvals')) {
          const tx = database.transaction('device_approvals', 'readonly');
          const store = tx.objectStore('device_approvals');
          console.log('[DB] device_approvals keyPath confirmed:', store.keyPath);
          
          // Check if keyPath is correct
          if (store.keyPath !== 'device_fingerprint') {
            console.error('[DB] SCHEMA MISMATCH: keyPath is', store.keyPath, 'but should be device_fingerprint');
            setSchemaError(true);
            database.close();
            // Clear and recreate database
            clearDatabase().then(() => {
              console.log('[DB] Retrying database initialization...');
              setTimeout(() => openDatabase(), 100);
            }).catch(err => {
              console.error('[DB] Failed to clear database:', err);
            });
            return;
          }
        }
        
        dbInstance = database;
        setDb(database);
        setIsReady(true);
        setSchemaError(false);
        console.log('[DB] IndexedDB ready. Version:', database.version);
      } catch (error) {
        console.error('[DB] Error during database initialization:', error);
        setSchemaError(true);
      }
    };

    request.onerror = (event) => {
      console.error('[DB] IndexedDB error:', (event.target as IDBOpenDBRequest).error);
      setSchemaError(true);
    };

    request.onblocked = () => {
      console.warn('[DB] IndexedDB upgrade blocked - close other tabs');
    };

    // NOTE: No cleanup — dbInstance is a singleton shared across all components.
    // Closing it here would break other components using useIndexedDB().
  };
  
  openDatabase();
  }, [schemaError]);

  const saveFarmers = useCallback((farmers: Farmer[]) => {
    if (!db) return;
    // Guard: never save empty array — prevents accidental cache wipe
    if (!farmers || farmers.length === 0) {
      console.warn('⚠️ saveFarmers called with empty array — skipping to protect cache');
      return;
    }
    try {
      const tx = db.transaction('farmers', 'readwrite');
      const store = tx.objectStore('farmers');
      // Clear old entries then write fresh data to remove stale farmers
      store.clear();
      farmers.forEach((farmer) => store.put(farmer));
      tx.onerror = () => console.error('Error saving farmers:', tx.error);
    } catch (error) {
      console.error('Failed to save farmers:', error);
    }
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

  const saveReceipt = useCallback((receipt: MilkCollection): Promise<{ success: boolean; orderId: number }> => {
    return new Promise((resolve, reject) => {
      if (!db) {
        console.error('[DB] Cannot save receipt - DB not ready');
        return reject(new Error('DB not ready'));
      }
      
      // Ensure orderId exists for IndexedDB key
      // Use collision-safe ID: milliseconds * 1000 + random suffix
      const orderId = receipt.orderId || (Date.now() * 1000 + Math.floor(Math.random() * 1000));
      const receiptWithId = {
        ...receipt,
        orderId,
        // Add safeguard timestamp for data recovery
        savedAt: new Date().toISOString(),
        // Never mark as synced on initial save
        synced: false,
      };
      
      try {
        const tx = db.transaction('receipts', 'readwrite');
        const store = tx.objectStore('receipts');
        const request = store.put(receiptWithId);
        
        request.onsuccess = () => {
          console.log(`[DB] Receipt saved: ${receipt.reference_no} (orderId: ${orderId})`);
          resolve({ success: true, orderId });
        };
        
        request.onerror = () => {
          console.error(`[DB] Failed to save receipt ${receipt.reference_no}:`, request.error);
          reject(request.error);
        };
        
        tx.onerror = () => {
          console.error(`[DB] Transaction error saving receipt:`, tx.error);
          reject(tx.error);
        };
        
        tx.onabort = () => {
          console.error(`[DB] Transaction aborted saving receipt`);
          reject(new Error('Transaction aborted'));
        };
      } catch (error) {
        console.error('[DB] Exception saving receipt:', error);
        reject(error);
      }
    });
  }, [db]);

  const getUnsyncedReceipts = useCallback((): Promise<MilkCollection[]> => {
    return new Promise((resolve, reject) => {
      if (!db) return resolve([]); // Return empty instead of rejecting
      try {
        const tx = db.transaction('receipts', 'readonly');
        const store = tx.objectStore('receipts');
        const request = store.getAll();
        request.onsuccess = () => {
          // Filter out synced receipts, special storage entries, and invalid records
          const unsynced = (request.result || []).filter((r: any) => {
            // Skip special storage entries
            if (r.orderId === 'PRINTED_RECEIPTS') return false;
            // Only include unsynced receipts
            if (r.synced) return false;
            // Skip sale records (synced via different path)
            if (r.type === 'sale') return false;
            // Must have required sync fields to be considered pending
            if (!r.reference_no || !r.farmer_id || !r.weight) return false;
            return true;
          });
          resolve(unsynced);
        };
        request.onerror = () => {
          console.error('Error getting unsynced receipts:', request.error);
          resolve([]); // Return empty on error instead of rejecting
        };
        tx.onerror = () => {
          console.error('Transaction error getting unsynced receipts:', tx.error);
          resolve([]);
        };
      } catch (error) {
        console.error('Exception getting unsynced receipts:', error);
        resolve([]);
      }
    });
  }, [db]);

  const deleteReceipt = useCallback((orderId: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject('DB not ready');
      try {
        const tx = db.transaction('receipts', 'readwrite');
        const store = tx.objectStore('receipts');
        const request = store.delete(orderId);
        
        request.onsuccess = () => {
          console.log(`✅ Deleted receipt ${orderId} from IndexedDB`);
          resolve();
        };
        request.onerror = () => {
          console.error(`❌ Failed to delete receipt ${orderId}:`, request.error);
          reject(request.error);
        };
        
        tx.onerror = () => reject(tx.error);
      } catch (error) {
        reject(error);
      }
    });
  }, [db]);

  const saveDeviceApproval = useCallback((deviceFingerprint: string, backendId: number | null, userId: string, approved: boolean): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject('DB not ready');
      
      // Strict validation for keyPath field
      if (!deviceFingerprint || typeof deviceFingerprint !== 'string' || deviceFingerprint.trim().length === 0) {
        return reject('Device fingerprint must be a non-empty string');
      }
      if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
        return reject('User ID must be a non-empty string');
      }
      
      try {
        const tx = db.transaction('device_approvals', 'readwrite');
        const store = tx.objectStore('device_approvals');
        
        // Verify the keyPath
        console.log('🔍 Device approvals store keyPath:', store.keyPath);
        
        // Create the object to store
        const dataToStore = { 
          device_fingerprint: deviceFingerprint.trim(), 
          backend_id: backendId,
          user_id: userId.trim(), 
          approved, 
          last_synced: new Date().toISOString() 
        };
        
        console.log('💾 Attempting to save device approval:', dataToStore);
        
        const request = store.put(dataToStore);
        
        request.onsuccess = () => {
          console.log('✅ Device approval saved successfully');
          resolve();
        };
        request.onerror = () => {
          console.error('❌ Failed to save device approval:', request.error);
          reject(request.error);
        };
        
        tx.onerror = () => {
          console.error('❌ Transaction error:', tx.error);
          reject(tx.error);
        };
      } catch (error) {
        console.error('❌ Exception in saveDeviceApproval:', error);
        reject(error);
      }
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

  const saveSale = useCallback((sale: any): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error('DB not ready'));

      try {
        const tx = db.transaction('receipts', 'readwrite');
        const store = tx.objectStore('receipts');
        
        const saleRecord = {
          ...sale,
          // Use collision-safe ID: milliseconds * 1000 + random suffix
          orderId: Date.now() * 1000 + Math.floor(Math.random() * 1000),
          type: 'sale',
          synced: false,
        };
        
        const request = store.put(saleRecord);
        request.onsuccess = () => {
          console.log('Sale saved to IndexedDB');
          resolve();
        };
        request.onerror = () => {
          console.error('Failed to save sale to IndexedDB:', request.error);
          reject(request.error);
        };
        tx.onerror = () => reject(tx.error);
      } catch (error) {
        console.error('Failed to save sale to IndexedDB:', error);
        reject(error);
      }
    });
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

  const deleteSale = useCallback((orderId: number): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject('DB not ready');
      try {
        const tx = db.transaction('receipts', 'readwrite');
        const store = tx.objectStore('receipts');
        const request = store.delete(orderId);
        
        request.onsuccess = () => {
          console.log(`✅ Sale ${orderId} deleted from IndexedDB`);
          resolve();
        };
        request.onerror = () => {
          console.error(`❌ Failed to delete sale ${orderId}:`, request.error);
          reject(request.error);
        };
        
        tx.onerror = () => reject(tx.error);
      } catch (error) {
        console.error('Failed to delete sale:', error);
        reject(error);
      }
    });
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
  const saveZReport = useCallback((date: string, data: any): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error('DB not ready'));
      try {
        const tx = db.transaction('z_reports', 'readwrite');
        const store = tx.objectStore('z_reports');
        const request = store.put({ date, data, timestamp: Date.now() });
        request.onsuccess = () => {
          console.log('Z Report cached successfully');
          resolve();
        };
        request.onerror = () => {
          console.error('Failed to cache Z Report:', request.error);
          reject(request.error);
        };
        tx.onerror = () => reject(tx.error);
      } catch (error) {
        console.error('Failed to cache Z Report:', error);
        reject(error);
      }
    });
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
  const savePeriodicReport = useCallback((cacheKey: string, data: any): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error('DB not ready'));
      try {
        const tx = db.transaction('periodic_reports', 'readwrite');
        const store = tx.objectStore('periodic_reports');
        const request = store.put({ cacheKey, data, timestamp: Date.now() });
        request.onsuccess = () => {
          console.log('Periodic Report cached successfully');
          resolve();
        };
        request.onerror = () => {
          console.error('Failed to cache Periodic Report:', request.error);
          reject(request.error);
        };
        tx.onerror = () => reject(tx.error);
      } catch (error) {
        console.error('Failed to cache Periodic Report:', error);
        reject(error);
      }
    });
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

  /**
   * Save printed receipts list for reprint functionality
   */
  const savePrintedReceipts = useCallback(async (receipts: any[]) => {
    if (!db) return;
    try {
      // Use dedicated printed_receipts store (no more mixed-type keys in receipts store)
      const storeName = db.objectStoreNames.contains('printed_receipts') ? 'printed_receipts' : 'receipts';
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (storeName === 'printed_receipts') {
          const request = store.put({ id: 'default', receipts, lastUpdated: new Date() });
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        } else {
          // Fallback for pre-migration: use old format
          const request = store.put({ orderId: 'PRINTED_RECEIPTS', receipts, lastUpdated: new Date() });
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }
      });
    } catch (error) {
      console.error('Failed to save printed receipts:', error);
    }
  }, [db]);

  /**
   * Get saved printed receipts for reprint functionality
   */
  const getPrintedReceipts = useCallback(async (): Promise<any[]> => {
    if (!db) return [];
    try {
      const storeName = db.objectStoreNames.contains('printed_receipts') ? 'printed_receipts' : 'receipts';
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const key = storeName === 'printed_receipts' ? 'default' : 'PRINTED_RECEIPTS';
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result?.receipts || []);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.error('Failed to get printed receipts:', error);
      return [];
    }
  }, [db]);

  /**
   * Clear all unsynced receipts from IndexedDB
   */
  const clearUnsyncedReceipts = useCallback(async (): Promise<number> => {
    if (!db) return 0;
    try {
      const unsyncedReceipts = await getUnsyncedReceipts();
      const count = unsyncedReceipts.length;
      
      return new Promise((resolve, reject) => {
        const tx = db.transaction('receipts', 'readwrite');
        const store = tx.objectStore('receipts');
        
        // Delete each unsynced receipt
        unsyncedReceipts.forEach((receipt) => {
          if (receipt.orderId && typeof receipt.orderId === 'number') {
            store.delete(receipt.orderId);
          }
        });
        
        tx.oncomplete = () => {
          console.log(`✅ Cleared ${count} unsynced receipts from IndexedDB`);
          resolve(count);
        };
        tx.onerror = () => {
          console.error('❌ Failed to clear unsynced receipts:', tx.error);
          reject(tx.error);
        };
      });
    } catch (error) {
      console.error('Failed to clear unsynced receipts:', error);
      return 0;
    }
  }, [db, getUnsyncedReceipts]);

  /**
   * Save routes (fm_tanks) to IndexedDB
   */
  const saveRoutes = useCallback((routes: any[]) => {
    if (!db) return;
    try {
      const tx = db.transaction('routes', 'readwrite');
      const store = tx.objectStore('routes');
      routes.forEach((route) => store.put(route));
      console.log('Routes cached in IndexedDB');
    } catch (error) {
      console.error('Failed to save routes:', error);
    }
  }, [db]);

  /**
   * Get routes (fm_tanks) from IndexedDB
   */
  const getRoutes = useCallback((): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject('DB not ready');
      try {
        const tx = db.transaction('routes', 'readonly');
        const store = tx.objectStore('routes');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (error) {
        // Routes store may not exist in older DB versions
        console.warn('Routes store not available:', error);
        resolve([]);
      }
    });
  }, [db]);

  /**
   * Save sessions to IndexedDB
   */
  const saveSessions = useCallback((sessions: any[]) => {
    if (!db) return;
    if (!sessions || sessions.length === 0) {
      // Guard: never wipe the cache with an empty list
      console.warn('[DB] saveSessions called with empty array — skipping');
      return;
    }
    try {
      const tx = db.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      // v2.10.51: clear before writing so legacy entries (e.g. coffee sessions
      // cached without SCODE) cannot linger and feed AM/PM into transactions.session
      store.clear();
      sessions.forEach((session) => store.put(session));
      console.log('[DB] Sessions cache replaced with', sessions.length, 'entries');
    } catch (error) {
      console.error('Failed to save sessions:', error);
    }
  }, [db]);

  /**
   * Get sessions from IndexedDB
   */
  const getSessions = useCallback((): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      if (!db) return reject('DB not ready');
      try {
        const tx = db.transaction('sessions', 'readonly');
        const store = tx.objectStore('sessions');
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (error) {
        // Sessions store may not exist in older DB versions
        console.warn('Sessions store not available:', error);
        resolve([]);
      }
    });
  }, [db]);

  /**
   * Build the cache key for a farmer cumulative entry.
   * v2.10.73: includes route to keep per-factory totals strictly isolated.
   * Falls back to "ALL" when no route is provided so legacy callers still work
   * (but they will read/write a separate "no-route" bucket).
   */
  const buildCumulativeKey = (cleanId: string, route: string | undefined, month: string): string => {
    const routeKey = (route || '').trim().toUpperCase() || 'ALL';
    return `${cleanId}__${routeKey}__${month}`;
  };

  /**
   * Get farmer's cumulative count for the current month, scoped to a route/factory.
   * Returns { baseCount, localCount, month, route, byProduct }.
   */
  const getFarmerCumulative = useCallback(async (
    farmerId: string,
    route?: string
  ): Promise<{ baseCount: number; localCount: number; month: string; route: string; byProduct: Array<{ icode: string; product_name: string; weight: number }> } | null> => {
    if (!db) return null;
    try {
      const cleanId = farmerId.replace(/^#/, '').trim();
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const cacheKey = buildCumulativeKey(cleanId, route, month);

      return new Promise((resolve, reject) => {
        const tx = db.transaction('farmer_cumulative', 'readonly');
        const store = tx.objectStore('farmer_cumulative');
        const request = store.get(cacheKey);
        request.onsuccess = () => {
          if (request.result) {
            resolve({
              baseCount: request.result.baseCount || 0,
              localCount: request.result.localCount || 0,
              month: request.result.month,
              route: request.result.route || ((route || '').trim().toUpperCase() || 'ALL'),
              byProduct: request.result.byProduct || []
            });
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('Failed to get farmer cumulative:', error);
      return null;
    }
  }, [db]);

  /**
   * Update farmer's cumulative count for a specific route/factory.
   * - fromBackend=true: replaces baseCount and resets localCount.
   * - fromBackend=false: increments localCount, preserves baseCount/byProduct.
   */
  const updateFarmerCumulative = useCallback(async (
    farmerId: string,
    count: number,
    fromBackend: boolean = false,
    byProduct?: Array<{ icode: string; product_name: string; weight: number }>,
    route?: string
  ): Promise<void> => {
    if (!db) return;
    try {
      const cleanId = farmerId.replace(/^#/, '').trim();
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const routeKey = (route || '').trim().toUpperCase() || 'ALL';
      const cacheKey = buildCumulativeKey(cleanId, route, month);

      return new Promise((resolve, reject) => {
        const tx = db.transaction('farmer_cumulative', 'readwrite');
        const store = tx.objectStore('farmer_cumulative');

        const getRequest = store.get(cacheKey);
        getRequest.onsuccess = () => {
          const existing = getRequest.result;
          let newRecord;

          if (fromBackend) {
            newRecord = {
              cacheKey,
              farmer_id: cleanId,
              route: routeKey,
              month,
              baseCount: count,
              localCount: 0,
              byProduct: byProduct || [],
              lastUpdated: new Date().toISOString()
            };
          } else {
            newRecord = {
              cacheKey,
              farmer_id: cleanId,
              route: routeKey,
              month,
              baseCount: existing?.baseCount || 0,
              localCount: (existing?.localCount || 0) + count,
              byProduct: byProduct || existing?.byProduct || [],
              lastUpdated: new Date().toISOString()
            };
          }

          const putRequest = store.put(newRecord);
          putRequest.onsuccess = () => {
            console.log(`✅ Updated farmer cumulative: ${cleanId} route=${routeKey}, base=${newRecord.baseCount}, local=${newRecord.localCount}`);
            resolve();
          };
          putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
      });
    } catch (error) {
      console.error('Failed to update farmer cumulative:', error);
    }
  }, [db]);

  /**
   * Calculate cumulative weight from unsynced receipts in IndexedDB for a farmer in the current month.
   * This ensures offline cumulative is accurate even if the farmer_cumulative cache was never seeded.
   */
  const getUnsyncedWeightForFarmer = useCallback(async (farmerId: string, routeFilter?: string): Promise<{ total: number; byProduct: Array<{ icode: string; product_name: string; weight: number }> }> => {
    if (!db) return { total: 0, byProduct: [] };
    try {
      const unsynced = await getUnsyncedReceipts();
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      // Normalize farmerId consistently
      const cleanFarmerId = farmerId.replace(/^#/, '').trim().toUpperCase();
      const cleanRoute = routeFilter ? routeFilter.trim().toUpperCase() : '';

      let totalWeight = 0;
      const productWeights: Record<string, { icode: string; product_name: string; weight: number }> = {};
      for (const r of unsynced) {
        // Only count Buy (transtype=1) receipts
        if (r.transtype === 2) continue;
        const rFarmerId = (r.farmer_id || '').replace(/^#/, '').trim().toUpperCase();
        if (rFarmerId !== cleanFarmerId) continue;
        // Filter by route if specified
        if (cleanRoute) {
          const rRoute = (r.route || '').trim().toUpperCase();
          if (rRoute !== cleanRoute) continue;
        }
        // Check same month
        const rDate = new Date(r.collection_date);
        if (rDate.getMonth() === currentMonth && rDate.getFullYear() === currentYear) {
          totalWeight += r.weight || 0;
          // Track per-product weights
          const icode = (r.product_code || '').trim().toUpperCase();
          if (icode) {
            if (!productWeights[icode]) {
              productWeights[icode] = { icode, product_name: r.product_name || icode, weight: 0 };
            }
            productWeights[icode].weight += r.weight || 0;
          }
        }
      }
      return { total: totalWeight, byProduct: Object.values(productWeights) };
    } catch (err) {
      console.warn('Failed to get unsynced weight for farmer:', err);
      return { total: 0, byProduct: [] };
    }
  }, [db, getUnsyncedReceipts]);

  /**
   * Get total cumulative for farmer: baseCount (last backend total) + fresh unsynced weight from receipts.
   * This avoids double-counting by NOT using localCount (which duplicates unsynced receipt data).
   * Returns { total, byProduct } with merged per-product breakdown.
   */
  const getFarmerTotalCumulative = useCallback(async (farmerId: string, routeFilter?: string): Promise<{ total: number; byProduct: Array<{ icode: string; product_name: string; weight: number }> }> => {
    const cached = await getFarmerCumulative(farmerId, routeFilter);
    const baseCount = cached?.baseCount || 0;
    const baseProd = cached?.byProduct || [];
    // Always recalculate from actual unsynced receipts instead of using cached localCount
    const unsynced = await getUnsyncedWeightForFarmer(farmerId, routeFilter);
    const total = baseCount + unsynced.total;
    
    // Merge by-product: base + unsynced (normalize icode keys to prevent fragmentation)
    const merged: Record<string, { icode: string; product_name: string; weight: number }> = {};
    for (const p of baseProd) {
      const key = (p.icode || '').trim().toUpperCase();
      merged[key] = { ...p, icode: key };
    }
    for (const p of unsynced.byProduct) {
      const key = (p.icode || '').trim().toUpperCase();
      if (merged[key]) {
        merged[key].weight += p.weight;
      } else {
        merged[key] = { ...p, icode: key };
      }
    }
    return { total, byProduct: Object.values(merged) };
  }, [getFarmerCumulative, getUnsyncedWeightForFarmer]);

  // Get ALL unsynced records from receipts store (no type filtering) — used for legacy orphan cleanup
  const getAllUnsyncedRecords = useCallback((): Promise<any[]> => {
    return new Promise((resolve) => {
      if (!db) return resolve([]);
      try {
        const tx = db.transaction('receipts', 'readonly');
        const store = tx.objectStore('receipts');
        const request = store.getAll();
        request.onsuccess = () => {
          const all = (request.result || []).filter((r: any) => {
            if (r.orderId === 'PRINTED_RECEIPTS') return false;
            if (r.synced) return false;
            return true;
          });
          resolve(all);
        };
        request.onerror = () => resolve([]);
        tx.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }, [db]);

  /**
   * v2.10.75: Bulk upsert backend transactions into the local mirror used by
   * the offline Periodic Report engine. Each row keyed by transrefno (unique).
   */
  const saveTransactionsToCache = useCallback(async (rows: any[]): Promise<number> => {
    if (!db || !rows || rows.length === 0) return 0;
    return new Promise<number>((resolve) => {
      try {
        const tx = db.transaction('transactions_cache', 'readwrite');
        const store = tx.objectStore('transactions_cache');
        let written = 0;
        for (const r of rows) {
          if (!r) continue;
          const transrefno = String(r.transrefno || r.reference_no || '').trim();
          if (!transrefno) continue;
          const normalized = {
            ...r,
            transrefno,
            // Normalize fields used for offline aggregation
            farmer_id: String(r.farmer_id || '').replace(/^#/, '').trim(),
            tcode: String(r.tcode || r.route || '').trim().toUpperCase(),
            transdate: r.transdate || r.collection_date || r.created_at || '',
            quantity: Number(r.quantity || r.weight || 0),
            transtype: Number(r.transtype || 1),
          };
          try { store.put(normalized); written++; } catch { /* skip bad row */ }
        }
        tx.oncomplete = () => resolve(written);
        tx.onerror = () => resolve(written);
      } catch (err) {
        console.warn('[DB] saveTransactionsToCache failed:', err);
        resolve(0);
      }
    });
  }, [db]);

  /**
   * v2.10.75: Read cached transactions filtered by date range (inclusive),
   * optional route (tcode) and farmer_id. Used by the offline Periodic Report builder.
   */
  const getCachedTransactions = useCallback(async (
    startDate: string,
    endDate: string,
    opts: { route?: string; farmerId?: string } = {}
  ): Promise<any[]> => {
    if (!db) return [];
    return new Promise<any[]>((resolve) => {
      try {
        const tx = db.transaction('transactions_cache', 'readonly');
        const store = tx.objectStore('transactions_cache');
        const idx = store.index('transdate');
        const range = IDBKeyRange.bound(startDate, endDate + '\uffff');
        const req = idx.openCursor(range);
        const out: any[] = [];
        const route = (opts.route || '').trim().toUpperCase();
        const farmerId = (opts.farmerId || '').replace(/^#/, '').trim();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const v = cursor.value;
            const okRoute = !route || (v.tcode || '').toUpperCase() === route;
            const okFarmer = !farmerId || (v.farmer_id || '') === farmerId;
            if (okRoute && okFarmer) out.push(v);
            cursor.continue();
          } else {
            resolve(out);
          }
        };
        req.onerror = () => resolve(out);
      } catch (err) {
        console.warn('[DB] getCachedTransactions failed:', err);
        resolve([]);
      }
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
    savePrintedReceipts,
    getPrintedReceipts,
    clearUnsyncedReceipts,
    saveRoutes,
    getRoutes,
    saveSessions,
    getSessions,
    getFarmerCumulative,
    updateFarmerCumulative,
    getFarmerTotalCumulative,
    getUnsyncedWeightForFarmer,
    getAllUnsyncedRecords,
    saveTransactionsToCache,
    getCachedTransactions,
  };
};
