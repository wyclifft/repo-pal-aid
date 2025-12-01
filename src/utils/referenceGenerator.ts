/**
 * Optimized Reference Number Generator with Batch Reservation
 * Generates unique transaction reference numbers with instant generation
 * Format: CompanyCode (2 chars) + DeviceCode (5 chars) + SequentialNumber
 * Example: AC0800021433
 * 
 * OPTIMIZATION: Reserves batches of sequential numbers from backend for fast, collision-free generation
 */

interface DeviceConfig {
  companyCode: string;
  deviceCode: string;
  reservedStart: number; // Start of reserved batch
  reservedEnd: number; // End of reserved batch (exclusive)
  currentSequential: number; // Current position in batch
}

const DB_NAME = 'MilkCollectionDB';
const DB_VERSION = 6;
const STORE_NAME = 'device_config';
const BATCH_SIZE = 100; // Reserve 100 numbers at a time
const REFILL_THRESHOLD = 10; // Request new batch when 10 numbers left

/**
 * Get IndexedDB instance for atomic operations
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
 * Store device configuration with batch reservation
 */
export const storeDeviceConfig = async (companyName: string, deviceCode: string): Promise<void> => {
  const config: DeviceConfig = {
    companyCode: companyName.substring(0, 2).toUpperCase(),
    deviceCode: String(deviceCode).padStart(5, '0'),
    reservedStart: 0,
    reservedEnd: 0,
    currentSequential: 0,
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
 * Reserve a batch of sequential numbers from backend
 */
export const reserveBatch = async (deviceFingerprint: string): Promise<boolean> => {
  try {
    const response = await fetch('https://backend.maddasystems.co.ke/api/milk-collection/reserve-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        device_fingerprint: deviceFingerprint,
        batch_size: BATCH_SIZE 
      }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    if (data.success && data.data) {
      await updateConfig({
        reservedStart: data.data.start,
        reservedEnd: data.data.end,
        currentSequential: data.data.start,
      });
      console.log(`✅ Reserved batch: ${data.data.start} to ${data.data.end - 1}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to reserve batch:', error);
    return false;
  }
};

/**
 * Generate next reference number with instant batch-based generation
 * OPTIMIZED: No backend calls needed - uses pre-reserved batch
 */
export const generateOfflineReference = async (): Promise<string | null> => {
  const config = await getDeviceConfig();
  if (!config) {
    console.warn('⚠️ Device config not available');
    return null;
  }

  // Check if we need a new batch
  if (config.currentSequential >= config.reservedEnd) {
    console.warn('⚠️ Reserved batch exhausted, using fallback');
    return null;
  }

  // Use next number from reserved batch (INSTANT - no backend call)
  const nextSequential = config.currentSequential;
  
  // Atomically update current position
  await updateConfig({ currentSequential: nextSequential + 1 });
  
  // Generate reference
  const reference = `${config.companyCode}${config.deviceCode}${nextSequential}`;
  
  console.log(`⚡ Instant reference: ${reference} (${config.reservedEnd - nextSequential - 1} remaining)`);
  
  // Background refill if running low (non-blocking)
  if (config.reservedEnd - nextSequential <= REFILL_THRESHOLD && navigator.onLine) {
    console.log('🔄 Background batch refill triggered');
    // Don't await - let it happen in background
    reserveBatch(await getDeviceFingerprint()).catch(() => {});
  }
  
  return reference;
};

/**
 * Get device fingerprint (helper for batch reservation)
 */
const getDeviceFingerprint = async (): Promise<string> => {
  const stored = localStorage.getItem('device_fingerprint');
  if (stored) return stored;
  
  // Generate simple fingerprint
  const ua = navigator.userAgent;
  const screen = `${window.screen.width}x${window.screen.height}`;
  const fingerprint = btoa(`${ua}-${screen}-${Date.now()}`);
  localStorage.setItem('device_fingerprint', fingerprint);
  return fingerprint;
};

/**
 * Sync with backend - ensures we have a valid batch reserved
 * Called when online to ensure continuous operation
 */
export const syncReferenceCounter = async (deviceFingerprint: string): Promise<void> => {
  const config = await getDeviceConfig();
  if (!config) return;

  // Check if we need a new batch
  const remaining = config.reservedEnd - config.currentSequential;
  
  if (remaining < REFILL_THRESHOLD && navigator.onLine) {
    console.log(`🔄 Syncing: ${remaining} numbers remaining, requesting new batch`);
    await reserveBatch(deviceFingerprint);
  }
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

/**
 * Initialize batch reservation on app startup
 */
export const initializeReservation = async (deviceFingerprint: string): Promise<void> => {
  const config = await getDeviceConfig();
  if (!config) {
    console.warn('⚠️ No device config found for initialization');
    return;
  }

  // Check if we have a valid batch
  if (config.currentSequential >= config.reservedEnd && navigator.onLine) {
    console.log('🔄 Initializing reference batch...');
    await reserveBatch(deviceFingerprint);
  }
};
