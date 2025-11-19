/**
 * Offline Reference Number Generator
 * Generates unique transaction reference numbers even without internet
 * Format: CompanyCode (2 chars) + DeviceCode (5 chars) + SequentialNumber
 * Example: AC0800021433
 */

interface DeviceConfig {
  companyCode: string; // First 2 chars of company name
  deviceCode: string; // 5-digit device code
  lastSequentialNumber: number; // Last used sequential number
}

const DEVICE_CONFIG_KEY = 'device_config';
const REFERENCE_COUNTER_KEY = 'reference_counter';

/**
 * Store device configuration in localStorage
 */
export const storeDeviceConfig = (companyName: string, deviceCode: string): void => {
  const config: DeviceConfig = {
    companyCode: companyName.substring(0, 2).toUpperCase(),
    deviceCode: String(deviceCode).padStart(5, '0'),
    lastSequentialNumber: 0,
  };
  localStorage.setItem(DEVICE_CONFIG_KEY, JSON.stringify(config));
  console.log('✅ Device config stored:', config);
};

/**
 * Get device configuration from localStorage
 */
export const getDeviceConfig = (): DeviceConfig | null => {
  const stored = localStorage.getItem(DEVICE_CONFIG_KEY);
  if (!stored) return null;
  
  try {
    return JSON.parse(stored);
  } catch (error) {
    console.error('Failed to parse device config:', error);
    return null;
  }
};

/**
 * Update the last sequential number
 */
export const updateLastSequentialNumber = (sequentialNumber: number): void => {
  const config = getDeviceConfig();
  if (config) {
    config.lastSequentialNumber = sequentialNumber;
    localStorage.setItem(DEVICE_CONFIG_KEY, JSON.stringify(config));
  }
};

/**
 * Generate next reference number offline
 * Returns null if device config is not available
 */
export const generateOfflineReference = (): string | null => {
  const config = getDeviceConfig();
  if (!config) {
    console.warn('⚠️ Device config not available for offline reference generation');
    return null;
  }

  // Increment sequential number
  const nextSequential = config.lastSequentialNumber + 1;
  
  // Generate reference: CompanyCode + DeviceCode + SequentialNumber
  const reference = `${config.companyCode}${config.deviceCode}${nextSequential}`;
  
  // Update stored counter
  updateLastSequentialNumber(nextSequential);
  
  console.log('✅ Generated offline reference:', reference);
  return reference;
};

/**
 * Sync reference counter with backend
 * Call this when online to get the correct starting number from backend
 */
export const syncReferenceCounter = (backendReferenceNo: string): void => {
  const config = getDeviceConfig();
  if (!config) return;

  // Extract sequential number from backend reference
  // Format: CompanyCode (2) + DeviceCode (5) + SequentialNumber
  const prefix = config.companyCode + config.deviceCode; // 7 chars total
  
  if (backendReferenceNo.startsWith(prefix)) {
    const sequentialPart = backendReferenceNo.substring(7);
    const sequentialNumber = parseInt(sequentialPart);
    
    if (!isNaN(sequentialNumber) && sequentialNumber > config.lastSequentialNumber) {
      updateLastSequentialNumber(sequentialNumber);
      console.log('✅ Synced reference counter with backend:', sequentialNumber);
    }
  }
};

/**
 * Reset device configuration (for testing or when changing device)
 */
export const resetDeviceConfig = (): void => {
  localStorage.removeItem(DEVICE_CONFIG_KEY);
  console.log('🗑️ Device config reset');
};
