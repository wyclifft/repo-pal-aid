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

export type TransactionType = 'milk' | 'store' | 'ai';

interface DeviceConfig {
  devcode: string;        // Device code prefix (e.g., AG05)
  lastTrnId: number;      // Last used transaction ID for transrefno
  milkId: number;         // Last used milk transaction ID for uploadrefno
  storeId: number;        // Last used store transaction ID for uploadrefno
  aiId: number;           // Last used AI transaction ID for uploadrefno
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
 * CRITICAL: Preserves existing lastTrnId to maintain continuity during offline operations
 */
export const storeDeviceConfig = async (companyName: string, devcode: string): Promise<void> => {
  // FIRST: Check if we already have a config with trnid to preserve
  const existingConfig = await getDeviceConfig();
  const existingLocalTrnId = existingConfig?.lastTrnId || 0;
  const existingMilkId = existingConfig?.milkId || 0;
  const existingStoreId = existingConfig?.storeId || 0;
  const existingAiId = existingConfig?.aiId || 0;
  
  console.log(`📦 storeDeviceConfig called. Existing counters: trnid=${existingLocalTrnId}, milkId=${existingMilkId}, storeId=${existingStoreId}, aiId=${existingAiId}`);
  
  // devcode is the primary identifier (e.g., AG05)
  // IMPORTANT: Preserve all existing counters instead of resetting to 0
  const config: DeviceConfig = {
    devcode: devcode,
    lastTrnId: existingLocalTrnId,
    milkId: existingMilkId,
    storeId: existingStoreId,
    aiId: existingAiId,
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
  // Update localStorage first - CRITICAL: create config if it doesn't exist
  const currentLs = getFromLocalStorage();
  if (currentLs) {
    const updated = { ...currentLs, ...updates };
    saveToLocalStorage(updated);
  } else {
    // No existing config - create one with the updates
    const devcode = localStorage.getItem('devcode') || updates.devcode || '';
    const newConfig: DeviceConfig = {
      devcode: devcode,
      lastTrnId: updates.lastTrnId || 0,
      milkId: updates.milkId || 0,
      storeId: updates.storeId || 0,
      aiId: updates.aiId || 0,
    };
    saveToLocalStorage(newConfig);
    console.log('⚠️ Created new config during updateConfig:', newConfig);
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
            // No existing config in IndexedDB - create one
            const devcode = localStorage.getItem('devcode') || updates.devcode || '';
            const newConfig = {
              id: 'config',
              devcode: devcode,
              lastTrnId: updates.lastTrnId || 0,
              milkId: updates.milkId || 0,
              storeId: updates.storeId || 0,
              aiId: updates.aiId || 0,
            };
            const putRequest = store.put(newConfig);
            putRequest.onsuccess = () => {
              console.log('✅ Created new config in IndexedDB during update:', newConfig);
              resolve();
            };
            putRequest.onerror = () => resolve(); // localStorage has update
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
  const nextId = (config?.lastTrnId || 0) + 1;
  
  await updateConfig({ lastTrnId: nextId });
  
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
    const lastUsed = config?.lastTrnId || 0;
    
    // Generate next sequential number
    const nextTrnId = lastUsed + 1;
    
    // Update for next call
    await updateConfig({ lastTrnId: nextTrnId });
    
    // Generate reference: devcode + 8-digit trnid padded
    const reference = `${devcode}${String(nextTrnId).padStart(8, '0')}`;
    
    console.log(`⚡ Reference: ${reference} (devcode: ${devcode}, trnid: ${nextTrnId})`);
    return reference;
  }
  
  // Fallback: try to get devcode from config
  const config = await getDeviceConfig();
  if (config?.devcode) {
    const nextTrnId = (config.lastTrnId || 0) + 1;
    await updateConfig({ lastTrnId: nextTrnId });
    
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
 * Dispatch event when counters are updated
 */
const dispatchCounterUpdateEvent = (counters: { trnid: number; milkId: number; storeId: number; aiId: number }) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('counterUpdate', { 
      detail: counters 
    }));
    console.log('📢 Dispatched counterUpdate event:', counters);
  }
};

/**
 * Sync local counter with backend's last used trnid and type-specific IDs
 * Called when device authorization is checked
 */
export const syncOfflineCounter = async (
  devcode: string, 
  lastBackendTrnId?: number,
  lastBackendMilkId?: number,
  lastBackendStoreId?: number,
  lastBackendAiId?: number
): Promise<void> => {
  // Store devcode for reference generation
  localStorage.setItem('devcode', devcode);
  
  // CRITICAL: Get current local counters to compare
  const currentConfig = await getDeviceConfig();
  const currentLocalTrnId = currentConfig?.lastTrnId || 0;
  const currentLocalMilkId = currentConfig?.milkId || 0;
  const currentLocalStoreId = currentConfig?.storeId || 0;
  const currentLocalAiId = currentConfig?.aiId || 0;
  
  // Use the MAXIMUM of local and backend to ensure we never go backwards
  // This prevents duplicate references when device goes offline and comes back
  const backendTrnId = (lastBackendTrnId !== undefined && lastBackendTrnId > 0) ? lastBackendTrnId : 0;
  const backendMilkId = (lastBackendMilkId !== undefined && lastBackendMilkId > 0) ? lastBackendMilkId : 0;
  const backendStoreId = (lastBackendStoreId !== undefined && lastBackendStoreId > 0) ? lastBackendStoreId : 0;
  const backendAiId = (lastBackendAiId !== undefined && lastBackendAiId > 0) ? lastBackendAiId : 0;
  
  const safeTrnId = Math.max(currentLocalTrnId, backendTrnId);
  const safeMilkId = Math.max(currentLocalMilkId, backendMilkId);
  const safeStoreId = Math.max(currentLocalStoreId, backendStoreId);
  const safeAiId = Math.max(currentLocalAiId, backendAiId);
  
  console.log(`🔄 syncOfflineCounter: trnid(local=${currentLocalTrnId}, backend=${backendTrnId}, using=${safeTrnId})`);
  console.log(`🔄 syncOfflineCounter: milkId(local=${currentLocalMilkId}, backend=${backendMilkId}, using=${safeMilkId})`);
  console.log(`🔄 syncOfflineCounter: storeId(local=${currentLocalStoreId}, backend=${backendStoreId}, using=${safeStoreId})`);
  console.log(`🔄 syncOfflineCounter: aiId(local=${currentLocalAiId}, backend=${backendAiId}, using=${safeAiId})`);
  
  await updateConfig({ 
    devcode: devcode,
    lastTrnId: safeTrnId, 
    milkId: safeMilkId,
    storeId: safeStoreId,
    aiId: safeAiId
  });
  
  // Dispatch event to notify components of counter changes
  dispatchCounterUpdateEvent({
    trnid: safeTrnId,
    milkId: safeMilkId,
    storeId: safeStoreId,
    aiId: safeAiId
  });
  
  console.log(`🔄 Synced counters for devcode ${devcode}`);
};

/**
 * Get next type-specific ID (milkId, storeId, or aiId)
 * This ID is used for uploadrefno in the transactions table
 * Returns the ID and updates local storage atomically
 */
export const getNextTypeId = async (transactionType: TransactionType): Promise<number> => {
  const config = await getDeviceConfig();
  
  let currentId = 0;
  let updateField: Partial<DeviceConfig> = {};
  
  switch (transactionType) {
    case 'milk':
      currentId = config?.milkId || 0;
      updateField = { milkId: currentId + 1 };
      break;
    case 'store':
      currentId = config?.storeId || 0;
      updateField = { storeId: currentId + 1 };
      break;
    case 'ai':
      currentId = config?.aiId || 0;
      updateField = { aiId: currentId + 1 };
      break;
  }
  
  const nextId = currentId + 1;
  await updateConfig(updateField);
  
  console.log(`⚡ Next ${transactionType}Id: ${nextId}`);
  return nextId;
};

/**
 * Generate formatted uploadrefno string (devcode + 8-digit padded ID)
 * Example: BA0500000031 for device BA05 with milkId 31
 */
export const generateFormattedUploadRef = async (transactionType: TransactionType): Promise<string | null> => {
  const devcode = localStorage.getItem('devcode');
  if (!devcode) {
    const config = await getDeviceConfig();
    if (!config?.devcode) {
      console.warn('⚠️ devcode not available - cannot generate uploadrefno');
      return null;
    }
  }
  
  const nextId = await getNextTypeId(transactionType);
  const code = devcode || (await getDeviceConfig())?.devcode || '';
  const formatted = `${code}${String(nextId).padStart(8, '0')}`;
  
  console.log(`⚡ Formatted uploadrefno: ${formatted} (${transactionType}Id: ${nextId})`);
  return formatted;
};

/**
 * Get current type-specific ID without incrementing
 * Useful for checking the current state
 */
export const getCurrentTypeId = async (transactionType: TransactionType): Promise<number> => {
  const config = await getDeviceConfig();
  
  switch (transactionType) {
    case 'milk':
      return config?.milkId || 0;
    case 'store':
      return config?.storeId || 0;
    case 'ai':
      return config?.aiId || 0;
    default:
      return 0;
  }
};

/**
 * Generate transaction reference with type-specific uploadrefno
 * Returns both transrefno (devcode + trnid) and uploadrefno (formatted string: devcode + typeId)
 */
export const generateReferenceWithUploadRef = async (transactionType: TransactionType): Promise<{
  transrefno: string;
  uploadrefno: string;
} | null> => {
  const transrefno = await generateOfflineReference();
  if (!transrefno) return null;
  
  const uploadrefno = await generateFormattedUploadRef(transactionType);
  if (!uploadrefno) return null;
  
  console.log(`⚡ Generated: transrefno=${transrefno}, uploadrefno=${uploadrefno} (type=${transactionType})`);
  
  return { transrefno, uploadrefno };
};

/**
 * Generate ONLY a new transrefno (for additional captures that share an existing uploadrefno)
 * Used when farmer captures multiple buckets in same session - each gets unique transrefno but shares uploadrefno
 */
export const generateTransRefOnly = async (): Promise<string | null> => {
  return generateOfflineReference();
};

/**
 * Reset local offline counter
 */
export const resetOfflineCounter = async (): Promise<void> => {
  await updateConfig({ lastTrnId: 0, milkId: 0, storeId: 0, aiId: 0 });
  console.log('🔄 Reset all offline counters to 0');
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
