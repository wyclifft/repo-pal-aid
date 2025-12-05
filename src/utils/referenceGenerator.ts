/**
 * Simplified Reference Number Generator
 * Generates unique transaction reference numbers
 * Format: CompanyCode (2 chars) + DeviceCode (5 chars) + SequentialNumber
 * Example: AC0800021433
 * 
 * APPROACH: 
 * - Online: Always fetch from backend API
 * - Offline: Generate timestamp-based reference for uniqueness
 */

interface DeviceConfig {
  companyCode: string;
  deviceCode: string;
  lastOfflineSequential: number; // Last used offline sequential
}

const DB_NAME = 'milkCollectionDB'; // Must match useIndexedDB.ts
const DB_VERSION = 6;
const STORE_NAME = 'device_config';

/**
 * Get IndexedDB instance
 */
const getDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

/**
 * Store device configuration
 */
export const storeDeviceConfig = async (companyName: string, deviceCode: string): Promise<void> => {
  const config: DeviceConfig = {
    companyCode: companyName.substring(0, 2).toUpperCase(),
    deviceCode: String(deviceCode).padStart(5, '0'),
    lastOfflineSequential: 0,
  };
  
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await store.put({ id: 'config', ...config });
  
  console.log('✅ Device config stored:', config);
};

/**
 * Get device configuration from IndexedDB
 */
export const getDeviceConfig = async (): Promise<DeviceConfig | null> => {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    
    return new Promise((resolve, reject) => {
      const request = store.get('config');
      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          const { id, ...config } = result;
          resolve(config as DeviceConfig);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to get device config:', error);
    return null;
  }
};

/**
 * Update device config atomically in IndexedDB
 */
const updateConfig = async (updates: Partial<DeviceConfig>): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  
  return new Promise((resolve, reject) => {
    const getRequest = store.get('config');
    getRequest.onsuccess = () => {
      const current = getRequest.result;
      if (current) {
        const updated = { ...current, ...updates };
        const putRequest = store.put(updated);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        reject(new Error('Config not found'));
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
};

/**
 * Generate offline reference using timestamp-based approach
 * Format: CompanyCode + DeviceCode + Timestamp-based sequential
 */
export const generateOfflineReference = async (): Promise<string | null> => {
  const config = await getDeviceConfig();
  if (!config) {
    console.warn('⚠️ Device config not available');
    return null;
  }

  // Use timestamp + incremental counter for uniqueness
  const timestamp = Date.now();
  const nextSequential = config.lastOfflineSequential + 1;
  
  // Atomically update counter
  await updateConfig({ lastOfflineSequential: nextSequential });
  
  // Generate reference: CompanyCode + DeviceCode + Timestamp(last 8 digits) + Counter(3 digits)
  const timestampPart = String(timestamp).slice(-8);
  const counterPart = String(nextSequential).padStart(3, '0');
  const reference = `${config.companyCode}${config.deviceCode}${timestampPart}${counterPart}`;
  
  console.log(`⚡ Offline reference generated: ${reference}`);
  
  return reference;
};

/**
 * Reset device configuration (for testing or when changing device)
 */
export const resetDeviceConfig = async (): Promise<void> => {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await store.delete('config');
    console.log('🗑️ Device config reset');
  } catch (error) {
    console.error('Failed to reset config:', error);
  }
};
