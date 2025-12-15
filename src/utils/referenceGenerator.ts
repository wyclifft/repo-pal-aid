/**
 * Simplified Reference Number Generator
 * Generates unique transaction reference numbers
 * Format: CompanyCode (2 chars) + DeviceCode (5 chars) + SequentialNumber
 * Example: AC0800021433
 * 
 * APPROACH: 
 * - Online: Always fetch from backend API
 * - Offline: Generate timestamp-based reference for uniqueness
 * 
 * FIRST-INSTALL HANDLING:
 * - Uses localStorage as backup when IndexedDB isn't ready
 * - Gracefully handles missing config with fallback generation
 */

interface DeviceConfig {
  companyCode: string;
  deviceCode: string;
  lastOfflineSequential: number;
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
 * Store device configuration in both IndexedDB and localStorage
 */
export const storeDeviceConfig = async (companyName: string, deviceCode: string): Promise<void> => {
  const config: DeviceConfig = {
    companyCode: companyName.substring(0, 2).toUpperCase(),
    deviceCode: String(deviceCode).padStart(5, '0'),
    lastOfflineSequential: 0,
  };
  
  // Always save to localStorage first (reliable backup)
  saveToLocalStorage(config);
  
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
    saveToLocalStorage({ ...currentLs, ...updates });
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
 * Get next offline sequential number atomically
 */
const getNextSequential = async (): Promise<number> => {
  const config = await getDeviceConfig();
  const nextSeq = (config?.lastOfflineSequential || 0) + 1;
  
  await updateConfig({ lastOfflineSequential: nextSeq });
  
  return nextSeq;
};

/**
 * Generate reference using device_ref from backend
 * Format: device_ref (e.g., AE10000001) - increments based on device slot
 * 
 * Device slots: Device 1 = AE1xxxxxxx, Device 2 = AE2xxxxxxx, etc.
 * Each device increments sequentially within its slot.
 */
export const generateOfflineReference = async (): Promise<string | null> => {
  // First, try to use device_ref from backend (stored in localStorage)
  const deviceRef = localStorage.getItem('device_ref');
  
  if (deviceRef) {
    // Extract the base prefix (e.g., "AE1" from "AE10000001") and increment
    // device_ref format: AE + slot(1 digit) + sequence(7 digits) = AE10000001
    const prefix = deviceRef.slice(0, 3); // "AE1", "AE2", etc.
    const nextSequential = await getNextSequential();
    
    // Generate reference: prefix + 7-digit sequential padded
    const reference = `${prefix}${String(nextSequential).padStart(7, '0')}`;
    
    console.log(`⚡ Reference generated using device_ref: ${reference}`);
    return reference;
  }
  
  // Fallback to old format if device_ref not available
  const config = await getDeviceConfig();
  const companyCode = config?.companyCode || 'XX';
  const deviceCode = config?.deviceCode || '00000';
  
  if (!deviceRef) {
    console.warn('⚠️ device_ref not available, using fallback codes');
  }

  // Use timestamp + incremental counter for uniqueness
  const timestamp = Date.now();
  const nextSequential = await getNextSequential();
  
  // Generate reference: CompanyCode + DeviceCode + Timestamp(last 8 digits) + Counter(3 digits)
  const timestampPart = String(timestamp).slice(-8);
  const counterPart = String(nextSequential).padStart(3, '0');
  const reference = `${companyCode}${deviceCode}${timestampPart}${counterPart}`;
  
  console.log(`⚡ Fallback reference generated: ${reference}`);
  
  return reference;
};

/**
 * Check if device config exists
 */
export const hasDeviceConfig = async (): Promise<boolean> => {
  const config = await getDeviceConfig();
  return config !== null && config.companyCode !== undefined;
};

/**
 * Reset device configuration (for testing or when changing device)
 */
export const resetDeviceConfig = async (): Promise<void> => {
  // Clear localStorage
  try {
    localStorage.removeItem(LOCALSTORAGE_KEY);
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
