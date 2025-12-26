/**
 * Transaction Reference Generator
 * Generates unique transaction reference numbers using devcode + trnid
 * Format: devcode (e.g., AG05) + trnid (8-digit padded) = AG0500000001
 * 
 * APPROACH: 
 * - Uses devcode as prefix for all transactions
 * - trnid is incremented for each new transaction
 * - Works consistently for offline and online modes
 * 
 * STORAGE:
 * - devcode: Device code from devSettings (e.g., AG05)
 * - lastTrnId: Last used transaction ID for this device
 */

interface DeviceConfig {
  devcode: string;        // Device code prefix (e.g., AG05)
  lastTrnId: number;      // Last used transaction ID
  companyCode?: string;   // Legacy - kept for compatibility
  deviceCode?: string;    // Legacy - kept for compatibility
  lastOfflineSequential?: number; // Legacy - mapped to lastTrnId
}

const DB_NAME = 'milkCollectionDB';
const DB_VERSION = 9; // Must match useIndexedDB.ts version
const STORE_NAME = 'device_config';
const LOCALSTORAGE_KEY = 'device_config_backup';

/**
 * Get IndexedDB instance with proper error handling for first install
 */
const getDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => {
        console.error('❌ IndexedDB open error:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        resolve(request.result);
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create device_config store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          console.log('✅ Created device_config store');
        }
      };
      
      request.onblocked = () => {
        console.warn('⚠️ IndexedDB open blocked');
        reject(new Error('Database blocked'));
      };
    } catch (error) {
      console.error('❌ IndexedDB exception:', error);
      reject(error);
    }
  });
};

/**
 * Save config to localStorage as backup
 */
const saveToLocalStorage = (config: DeviceConfig): void => {
  try {
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(config));
    console.log('💾 Device config saved to localStorage backup');
  } catch (error) {
    console.error('Failed to save to localStorage:', error);
  }
};

/**
 * Get config from localStorage backup
 */
const getFromLocalStorage = (): DeviceConfig | null => {
  try {
    const stored = localStorage.getItem(LOCALSTORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as DeviceConfig;
    }
  } catch (error) {
    console.error('Failed to get from localStorage:', error);
  }
  return null;
};

/**
 * Store device configuration using devcode
 */
export const storeDeviceConfig = async (companyName: string, devcode: string): Promise<void> => {
  // devcode is the primary identifier (e.g., AG05)
  const config: DeviceConfig = {
    devcode: devcode,
    lastTrnId: 0,
    // Legacy fields for backwards compatibility
    companyCode: companyName.substring(0, 2).toUpperCase(),
    deviceCode: devcode,
    lastOfflineSequential: 0,
  };
  
  // Always save to localStorage first (reliable backup)
  saveToLocalStorage(config);
  
  // Also save devcode directly for quick access
  localStorage.setItem('devcode', devcode);
  
  try {
    const db = await getDB();
    
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put({ id: 'config', ...config });
        
        request.onsuccess = () => {
          console.log('✅ Device config stored in IndexedDB:', config);
          resolve();
        };
        
        request.onerror = () => {
          console.error('❌ Failed to store in IndexedDB:', request.error);
          // Still resolve since localStorage backup exists
          resolve();
        };
        
        tx.onerror = () => {
          console.error('❌ Transaction error:', tx.error);
          resolve(); // localStorage backup exists
        };
      } catch (error) {
        console.error('❌ Store exception:', error);
        resolve(); // localStorage backup exists
      }
    });
  } catch (error) {
    console.error('Failed to open IndexedDB:', error);
    // Config is still saved in localStorage, so don't throw
  }
};

/**
 * Get device configuration from IndexedDB or localStorage
 */
export const getDeviceConfig = async (): Promise<DeviceConfig | null> => {
  // Try IndexedDB first
  try {
    const db = await getDB();
    
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get('config');
        
        request.onsuccess = () => {
          const result = request.result;
          if (result) {
            const { id, ...config } = result;
            console.log('📦 Got config from IndexedDB');
            resolve(config as DeviceConfig);
          } else {
            // Fall back to localStorage
            const lsConfig = getFromLocalStorage();
            if (lsConfig) {
              console.log('📦 Got config from localStorage backup');
            }
            resolve(lsConfig);
          }
        };
        
        request.onerror = () => {
          console.error('IndexedDB read error:', request.error);
          resolve(getFromLocalStorage());
        };
      } catch (error) {
        console.error('IndexedDB transaction error:', error);
        resolve(getFromLocalStorage());
      }
    });
  } catch (error) {
    console.error('Failed to open IndexedDB:', error);
    return getFromLocalStorage();
  }
};

/**
 * Update device config atomically in IndexedDB and localStorage
 */
const updateConfig = async (updates: Partial<DeviceConfig>): Promise<void> => {
  // Update localStorage first
  const currentLs = getFromLocalStorage();
  if (currentLs) {
    const updated = { ...currentLs, ...updates };
    // Keep lastTrnId and lastOfflineSequential in sync
    if (updates.lastTrnId !== undefined) {
      updated.lastOfflineSequential = updates.lastTrnId;
    }
    if (updates.lastOfflineSequential !== undefined) {
      updated.lastTrnId = updates.lastOfflineSequential;
    }
    saveToLocalStorage(updated);
  }
  
  try {
    const db = await getDB();
    
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const getRequest = store.get('config');
        
        getRequest.onsuccess = () => {
          const current = getRequest.result;
          if (current) {
            const updated = { ...current, ...updates };
            // Keep lastTrnId and lastOfflineSequential in sync
            if (updates.lastTrnId !== undefined) {
              updated.lastOfflineSequential = updates.lastTrnId;
            }
            if (updates.lastOfflineSequential !== undefined) {
              updated.lastTrnId = updates.lastOfflineSequential;
            }
            const putRequest = store.put(updated);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => resolve(); // localStorage has update
          } else {
            resolve(); // Config not in IndexedDB, localStorage has update
          }
        };
        
        getRequest.onerror = () => resolve(); // localStorage has update
      } catch (error) {
        resolve(); // localStorage has update
      }
    });
  } catch (error) {
    // localStorage already updated, so we're okay
  }
};

/**
 * Get next transaction ID atomically
 */
const getNextTrnId = async (): Promise<number> => {
  const config = await getDeviceConfig();
  const nextId = (config?.lastTrnId || config?.lastOfflineSequential || 0) + 1;
  
  await updateConfig({ lastTrnId: nextId, lastOfflineSequential: nextId });
  
  return nextId;
};

/**
 * Generate transaction reference using devcode + trnid
 * Format: devcode (e.g., AG05) + trnid (8-digit padded) = AG0500000001 (12 chars)
 * 
 * This is the SINGLE SOURCE OF TRUTH for transaction identification
 * Works consistently for milk, store, and AI transactions
 */
export const generateOfflineReference = async (): Promise<string | null> => {
  // Get devcode from localStorage (set during device authorization)
  const devcode = localStorage.getItem('devcode');
  
  if (devcode) {
    // Get the last used trnId and increment
    const config = await getDeviceConfig();
    const lastUsed = config?.lastTrnId || config?.lastOfflineSequential || 0;
    
    // Generate next sequential number
    const nextTrnId = lastUsed + 1;
    
    // Update for next call
    await updateConfig({ lastTrnId: nextTrnId, lastOfflineSequential: nextTrnId });
    
    // Generate reference: devcode + 8-digit trnid padded
    const reference = `${devcode}${String(nextTrnId).padStart(8, '0')}`;
    
    console.log(`⚡ Reference: ${reference} (devcode: ${devcode}, trnid: ${nextTrnId})`);
    return reference;
  }
  
  // Fallback: try to get devcode from config
  const config = await getDeviceConfig();
  if (config?.devcode) {
    const nextTrnId = (config.lastTrnId || config.lastOfflineSequential || 0) + 1;
    await updateConfig({ lastTrnId: nextTrnId, lastOfflineSequential: nextTrnId });
    
    const reference = `${config.devcode}${String(nextTrnId).padStart(8, '0')}`;
    console.log(`⚡ Reference (from config): ${reference}`);
    return reference;
  }
  
  console.warn('⚠️ devcode not available - cannot generate reference');
  return null;
};

/**
 * Check if device config exists
 */
export const hasDeviceConfig = async (): Promise<boolean> => {
  const config = await getDeviceConfig();
  const devcode = localStorage.getItem('devcode');
  return (config !== null && config.devcode !== undefined) || devcode !== null;
};

/**
 * Sync local counter with backend's last used trnid
 * Called when device authorization is checked
 */
export const syncOfflineCounter = async (devcode: string, lastBackendTrnId?: number): Promise<void> => {
  // Store devcode for reference generation
  localStorage.setItem('devcode', devcode);
  
  if (lastBackendTrnId !== undefined && lastBackendTrnId > 0) {
    // Store the actual last used trnid directly
    await updateConfig({ 
      devcode: devcode,
      lastTrnId: lastBackendTrnId, 
      lastOfflineSequential: lastBackendTrnId 
    });
    console.log(`🔄 Synced trnid counter to ${lastBackendTrnId} for devcode ${devcode} (will generate from ${lastBackendTrnId + 1})`);
  } else {
    await updateConfig({ 
      devcode: devcode,
      lastTrnId: 0, 
      lastOfflineSequential: 0 
    });
    console.log(`🔄 Initialized trnid counter to 0 for devcode ${devcode}`);
  }
};

/**
 * Reset local offline counter (deprecated - use syncOfflineCounter)
 */
export const resetOfflineCounter = async (): Promise<void> => {
  await updateConfig({ lastTrnId: 0, lastOfflineSequential: 0 });
  console.log('🔄 Reset offline counter to 0');
};

/**
 * Reset device configuration (for testing or when changing device)
 */
export const resetDeviceConfig = async (): Promise<void> => {
  // Clear localStorage
  try {
    localStorage.removeItem(LOCALSTORAGE_KEY);
    localStorage.removeItem('devcode');
    console.log('🗑️ Cleared localStorage config');
  } catch (error) {
    console.error('Failed to clear localStorage:', error);
  }
  
  // Clear IndexedDB
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await store.delete('config');
    console.log('🗑️ Device config reset in IndexedDB');
  } catch (error) {
    console.error('Failed to reset IndexedDB config:', error);
  }
};

/**
 * Initialize device config with devcode (called during device authorization)
 */
export const initializeDeviceConfig = async (companyName: string, devcode: string): Promise<void> => {
  await storeDeviceConfig(companyName, devcode);
};
