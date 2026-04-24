/**
 * Classic Bluetooth SPP (Serial Port Profile) Service
 * Capacitor 7–compatible native plugin for industrial scales using RFCOMM/Serial connections
 * 
 * IMPLEMENTATION:
 * - Native Android plugin: android/.../bluetooth/BluetoothClassicPlugin.kt
 * - Uses standard SPP UUID: 00001101-0000-1000-8000-00805F9B34FB
 * - Thread-safe I/O with buffered continuous reading
 * - Supports Android 8-14 with proper permission handling
 * 
 * For scales that support both BLE and Classic SPP (like many BTM/DR series),
 * BLE is preferred. This module provides Classic SPP for devices
 * that ONLY support Classic Bluetooth or have more reliable SPP connections.
 */

import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';
import { broadcastScaleWeightUpdate } from './bluetooth';

// ============================================================================
// NATIVE PLUGIN INTERFACE - Capacitor 7 Compatible
// ============================================================================

/**
 * Native Classic Bluetooth SPP Plugin Interface
 * Implemented in Kotlin at: android/.../bluetooth/BluetoothClassicPlugin.kt
 */
export interface BluetoothClassicPlugin {
  /** Check if Classic Bluetooth is available on this device */
  isAvailable(): Promise<{ available: boolean }>;

  /** Request required Bluetooth permissions (handles Android 12+ automatically) */
  requestBluetoothPermissions(): Promise<{ granted: boolean }>;

  /** Get list of paired/bonded Bluetooth devices */
  getPairedDevices(): Promise<{ devices: ClassicBluetoothDevice[] }>;

  /** Connect to a Classic Bluetooth device via SPP/RFCOMM */
  connect(options: { address: string }): Promise<{ connected: boolean }>;

  /** Disconnect from currently connected device */
  disconnect(): Promise<void>;

  /** Check if currently connected */
  isConnected(): Promise<{ connected: boolean }>;

  /** Write data to the connected device */
  write(options: { data: string }): Promise<void>;

  /** Add listener for incoming data from the scale */
  addListener(
    eventName: 'dataReceived',
    listenerFunc: (data: { value: string }) => void
  ): Promise<PluginListenerHandle>;

  /** Add listener for connection state changes */
  addListener(
    eventName: 'connectionStateChanged',
    listenerFunc: (state: { connected: boolean }) => void
  ): Promise<PluginListenerHandle>;

  /** Remove all listeners */
  removeAllListeners(): Promise<void>;
}

// Register the plugin - uses native implementation on Android, web fallback elsewhere
const BluetoothClassic = registerPlugin<BluetoothClassicPlugin>('BluetoothClassic', {
  web: () => import('./bluetoothClassicWeb').then(m => new m.BluetoothClassicWeb()),
});

// ============================================================================
// TYPES
// ============================================================================

export interface ClassicBluetoothDevice {
  address: string;
  name: string;
  bonded: boolean;
  deviceClass?: number;
}

export interface ClassicScaleConnection {
  device: ClassicBluetoothDevice | null;
  address: string | null;
  isConnected: boolean;
  connectionType: 'classic-spp';
}

// ============================================================================
// STATE
// ============================================================================

let classicScale: ClassicScaleConnection = {
  device: null,
  address: null,
  isConnected: false,
  connectionType: 'classic-spp',
};

let dataListenerHandle: PluginListenerHandle | null = null;
let connectionListenerHandle: PluginListenerHandle | null = null;

// Storage keys
const CLASSIC_DEVICE_KEY = 'lastClassicBluetoothDevice';

// ============================================================================
// DEVICE DETECTION PATTERNS
// ============================================================================

// DR Series and BTM Series patterns for detection
const CLASSIC_SCALE_PATTERNS = [
  'DR', 'DR 10', 'DR10', 'DR-10', 'DR 20', 'DR20', 'DR-20',
  'DR 30', 'DR30', 'DR-30', 'DR 40', 'DR40', 'DR-40',
  'DR 50', 'DR50', 'DR-50', 'DR 60', 'DR60', 'DR-60',
  'DR 70', 'DR70', 'DR-70', 'DR 80', 'DR80', 'DR-80',
  'DR 90', 'DR90', 'DR-90', 'DR 100', 'DR100', 'DR-100',
  'DR 150', 'DR150', 'DR-150',
  'T SCALE', 'T-SCALE', 'TSCALE', 'SCALE DR', 'SCALE-DR',
  'BTM', 'BTM03', 'BTM04', 'BTM05', 'BTM0304', 'BTM0404',
  'HC-05', 'HC-06', 'HM-10', 'JDY', 'CC41', 'BT-', 'BT_',
  'SCALE', 'WEIGHT', 'BALANCE',
];

/**
 * Check if device name suggests Classic Bluetooth (industrial scale)
 */
export const isLikelyClassicDevice = (deviceName: string | undefined): boolean => {
  if (!deviceName) return false;
  const upperName = deviceName.toUpperCase();
  return CLASSIC_SCALE_PATTERNS.some(pattern => upperName.includes(pattern.toUpperCase()));
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Check if Classic Bluetooth SPP is available
 * Returns true if native plugin is implemented and Bluetooth is available
 */
export const isClassicBluetoothAvailable = async (): Promise<boolean> => {
  // Only available on native platforms
  if (!Capacitor.isNativePlatform()) {
    console.log('ℹ️ Classic Bluetooth: Not available on web platform');
    return false;
  }

  try {
    const result = await BluetoothClassic.isAvailable();
    console.log(`ℹ️ Classic Bluetooth available: ${result.available}`);
    return result.available;
  } catch (error) {
    // Native plugin not implemented yet
    console.log('ℹ️ Classic Bluetooth: Native plugin not yet implemented');
    console.log('💡 TODO: Implement BluetoothClassicPlugin for Capacitor 7');
    return false;
  }
};

/**
 * Request Bluetooth permissions for Classic Bluetooth
 */
export const requestClassicBluetoothPermissions = async (): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    const result = await BluetoothClassic.requestBluetoothPermissions();
    return result.granted;
  } catch (error) {
    console.warn('⚠️ Failed to request Classic Bluetooth permissions:', error);
    return false;
  }
};

/**
 * Get list of paired/bonded Bluetooth devices
 */
export const getPairedDevices = async (): Promise<ClassicBluetoothDevice[]> => {
  if (!Capacitor.isNativePlatform()) {
    console.log('ℹ️ Classic Bluetooth: Paired devices only available on native');
    return [];
  }

  try {
    const result = await BluetoothClassic.getPairedDevices();
    console.log(`📱 Found ${result.devices.length} paired devices`);
    return result.devices;
  } catch (error) {
    console.log('ℹ️ Classic Bluetooth: getPairedDevices requires native plugin');
    console.log('💡 Tip: DR/BTM series scales often work via BLE with FFE0/FFE1 services');
    return [];
  }
};

/**
 * Get paired devices that are likely scales
 */
export const getPairedScales = async (): Promise<ClassicBluetoothDevice[]> => {
  const devices = await getPairedDevices();
  return devices.filter(d => isLikelyClassicDevice(d.name));
};

/**
 * Get ALL paired devices (including unnamed/unknown ones)
 * Useful for connecting to devices that don't have recognizable names
 */
export const getAllPairedDevices = async (): Promise<ClassicBluetoothDevice[]> => {
  return getPairedDevices();
};

// ============================================================================
// WEIGHT PARSING
// ============================================================================

/**
 * Parse weight data from raw serial data
 * Supports multiple formats used by DR/BTM series scales
 * Enhanced with detailed raw data logging
 */
export const parseSerialWeightData = (data: string): number | null => {
  // Log raw hex bytes for debugging
  const hexBytes = Array.from(data).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
  console.log(`📊 Raw Classic BT data: "${data}" (${data.length} chars)`);
  console.log(`📊 Raw hex bytes: [${hexBytes}]`);
  
  // Clean the data
  const cleanData = data.trim().replace(/[\x00-\x1F\x7F]/g, '');
  console.log(`📊 Cleaned data: "${cleanData}"`);
  
  // Check for negative values - return 0
  const negativeMatch = cleanData.match(/-\s*(\d+\.?\d*)/);
  if (negativeMatch) {
    console.log(`⚠️ Negative weight detected (-${negativeMatch[1]}), returning 0`);
    return 0;
  }
  
  // Check for zero first
  const zeroMatch = cleanData.match(/^\s*\+?\s*0+\.?0*\s*(kg|g|lb|oz)?\s*$/i);
  if (zeroMatch) {
    console.log(`✅ Parsed weight (zero): 0 kg`);
    return 0;
  }
  
  // Strategy 1: Standard weight format like "ST,GS,+  12.345kg" or "12.345 kg"
  const standardMatch = cleanData.match(/[+-]?\s*(\d+\.?\d*)\s*(kg|g|lb|oz)?/i);
  if (standardMatch) {
    let weight = parseFloat(standardMatch[1]);
    const unit = standardMatch[2]?.toLowerCase();
    
    if (unit === 'g') weight = weight / 1000;
    else if (unit === 'lb') weight = weight * 0.453592;
    else if (unit === 'oz') weight = weight * 0.0283495;
    
    if (weight >= 0 && weight < 1000) {
      console.log(`✅ Parsed weight (standard): ${weight.toFixed(3)} kg`);
      return weight;
    }
  }
  
  // Strategy 2: Just decimal number
  const decimalMatch = cleanData.match(/(\d+\.\d{1,4})/);
  if (decimalMatch) {
    const weight = parseFloat(decimalMatch[1]);
    if (weight >= 0 && weight < 500) {
      console.log(`✅ Parsed weight (decimal): ${weight.toFixed(3)} kg`);
      return weight;
    }
  }
  
  // Strategy 3: Integer representing grams
  const intMatch = cleanData.replace(/[^0-9]/g, '');
  if (intMatch.length >= 3) {
    const intValue = parseInt(intMatch);
    if (intValue >= 0 && intValue < 500000) {
      const weight = intValue / 1000;
      console.log(`✅ Parsed weight (grams): ${weight.toFixed(3)} kg`);
      return weight;
    }
  }
  
  console.log(`⚠️ Could not parse weight from: "${cleanData}"`);
  return null;
};

// ============================================================================
// CONNECTION MANAGEMENT
// ============================================================================

/**
 * Connect to a Classic Bluetooth scale via SPP/RFCOMM
 */
export const connectClassicScale = async (
  device: ClassicBluetoothDevice,
  onWeightUpdate: (weight: number) => void
): Promise<{ success: boolean; error?: string }> => {
  if (!Capacitor.isNativePlatform()) {
    return { 
      success: false, 
      error: 'Classic Bluetooth only available on native platforms' 
    };
  }

  try {
    console.log(`🔗 Connecting to Classic BT device: ${device.name} (${device.address})`);

    // Connect to device
    const result = await BluetoothClassic.connect({ address: device.address });
    
    if (!result.connected) {
      return { success: false, error: 'Failed to connect to device' };
    }

    // Set up data listener - uses global broadcast as primary, callback as secondary
    dataListenerHandle = await BluetoothClassic.addListener('dataReceived', (event: any) => {
      // Native plugin sends { data: "..." }, handle both .data and .value for compatibility
      const rawData = event.data ?? event.value ?? '';
      console.log(`📡 Classic BT dataReceived event keys: ${Object.keys(event).join(', ')}, raw: "${rawData}"`);
      const weight = parseSerialWeightData(rawData);
      if (weight !== null) {
        // Always broadcast globally - this is the app-level persistent mechanism
        broadcastScaleWeightUpdate(weight, 'Classic-SPP');
        
        // Try calling the callback, but wrap in try-catch in case it's stale
        // (e.g., component that passed the callback has unmounted)
        try {
          onWeightUpdate(weight);
        } catch (callbackError) {
          // Stale callback - this is expected when navigating away from Settings
          // Global broadcast already handled the update
          console.log('📡 Classic BT: Callback stale (component unmounted), global broadcast sent');
        }
      }
    });

    // Set up connection state listener
    connectionListenerHandle = await BluetoothClassic.addListener('connectionStateChanged', (state) => {
      if (!state.connected) {
        console.log('⚠️ Classic BT connection lost');
        clearClassicScaleState();
      }
    });

    // Update state
    classicScale = {
      device,
      address: device.address,
      isConnected: true,
      connectionType: 'classic-spp',
    };

    // Save device for quick reconnect
    saveClassicDeviceInfo(device);

    // Broadcast connection change
    window.dispatchEvent(new CustomEvent('scaleConnectionChange', { detail: { connected: true } }));

    console.log(`✅ Connected to Classic BT scale: ${device.name}`);
    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Check if this is because native plugin isn't implemented
    if (errorMessage.includes('not implemented') || errorMessage.includes('plugin')) {
      console.log('⚠️ Classic Bluetooth SPP requires native plugin implementation');
      console.log('💡 Try using BLE connection instead - most BTM/DR scales support both');
      return { 
        success: false, 
        error: 'Classic Bluetooth plugin not yet implemented. Try BLE connection.' 
      };
    }

    console.error('❌ Classic BT connection error:', error);
    return { success: false, error: errorMessage };
  }
};

/**
 * Disconnect from Classic Bluetooth scale
 */
export const disconnectClassicScale = async (): Promise<void> => {
  try {
    // Remove listeners
    if (dataListenerHandle) {
      await dataListenerHandle.remove();
      dataListenerHandle = null;
    }
    if (connectionListenerHandle) {
      await connectionListenerHandle.remove();
      connectionListenerHandle = null;
    }

    // Disconnect
    await BluetoothClassic.disconnect();
  } catch (error) {
    console.warn('⚠️ Error disconnecting Classic BT:', error);
  }

  clearClassicScaleState();
};

/**
 * Clear Classic scale state
 */
const clearClassicScaleState = () => {
  classicScale = {
    device: null,
    address: null,
    isConnected: false,
    connectionType: 'classic-spp',
  };
  window.dispatchEvent(new CustomEvent('scaleConnectionChange', { detail: { connected: false } }));
};

// ============================================================================
// DEVICE STORAGE
// ============================================================================

/**
 * Save device info for quick reconnect
 */
const saveClassicDeviceInfo = (device: ClassicBluetoothDevice) => {
  localStorage.setItem(CLASSIC_DEVICE_KEY, JSON.stringify({
    ...device,
    timestamp: Date.now(),
  }));
};

/**
 * Get stored device info
 */
export const getStoredClassicDevice = (): (ClassicBluetoothDevice & { timestamp: number }) | null => {
  try {
    const stored = localStorage.getItem(CLASSIC_DEVICE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

/**
 * Clear stored device
 */
export const clearStoredClassicDevice = () => {
  localStorage.removeItem(CLASSIC_DEVICE_KEY);
};

// ============================================================================
// RECONNECTION
// ============================================================================

/**
 * Quick reconnect to last used Classic scale
 */
export const quickReconnectClassicScale = async (
  onWeightUpdate: (weight: number) => void
): Promise<{ success: boolean; error?: string }> => {
  const storedDevice = getStoredClassicDevice();
  if (!storedDevice) {
    return { success: false, error: 'No stored Classic device' };
  }

  // Check if device is still valid (within 24 hours)
  const hoursSinceLastConnect = (Date.now() - storedDevice.timestamp) / (1000 * 60 * 60);
  if (hoursSinceLastConnect > 24) {
    clearStoredClassicDevice();
    return { success: false, error: 'Stored device expired' };
  }

  return connectClassicScale(storedDevice, onWeightUpdate);
};

// ============================================================================
// STATUS FUNCTIONS
// ============================================================================

/**
 * Check if Classic scale is connected
 */
export const isClassicScaleConnected = (): boolean => {
  return classicScale.isConnected;
};

/**
 * Get current Classic scale info
 */
export const getCurrentClassicScaleInfo = (): { address: string; name: string } | null => {
  if (!classicScale.device || !classicScale.isConnected) return null;
  return {
    address: classicScale.address!,
    name: classicScale.device.name,
  };
};

// ============================================================================
// SCALE COMMANDS
// ============================================================================

/**
 * Common scale commands for future use with write() function
 */
export const SCALE_COMMANDS = {
  READ_WEIGHT: '\x05',      // ENQ - common request for weight
  TARE: 'T',                // Tare command
  ZERO: 'Z',                // Zero command
  CONTINUOUS: 'C',          // Start continuous output
  STOP: 'S',                // Stop continuous output
  CRLF: '\r\n',             // Line terminator
};

/**
 * Send command to connected scale
 */
export const sendScaleCommand = async (command: string): Promise<boolean> => {
  if (!classicScale.isConnected) {
    console.warn('⚠️ Cannot send command: No Classic BT connection');
    return false;
  }

  try {
    await BluetoothClassic.write({ data: command });
    return true;
  } catch (error) {
    console.error('❌ Failed to send command:', error);
    return false;
  }
};

// ============================================================================
// CLASSIC BLUETOOTH PRINTER SUPPORT
// ============================================================================

let classicPrinter: {
  device: ClassicBluetoothDevice | null;
  address: string | null;
  isConnected: boolean;
} = {
  device: null,
  address: null,
  isConnected: false,
};

const CLASSIC_PRINTER_KEY = 'lastClassicBluetoothPrinter';

/**
 * Connect to a Classic Bluetooth printer (built-in POS printers, SPP printers)
 */
export const connectClassicPrinter = async (
  device: ClassicBluetoothDevice
): Promise<{ success: boolean; error?: string }> => {
  if (!Capacitor.isNativePlatform()) {
    return { 
      success: false, 
      error: 'Classic Bluetooth only available on native platforms' 
    };
  }

  try {
    console.log(`🖨️ Connecting to Classic BT printer: ${device.name} (${device.address})`);

    // Disconnect any existing printer connection first
    if (classicPrinter.isConnected) {
      await disconnectClassicPrinter();
    }

    // Connect to device
    const result = await BluetoothClassic.connect({ address: device.address });
    
    if (!result.connected) {
      return { success: false, error: 'Failed to connect to printer' };
    }

    // Set up connection state listener
    await BluetoothClassic.addListener('connectionStateChanged', (state) => {
      if (!state.connected) {
        console.log('⚠️ Classic BT printer connection lost');
        clearClassicPrinterState();
      }
    });

    // Update state
    classicPrinter = {
      device,
      address: device.address,
      isConnected: true,
    };

    // Save device for quick reconnect
    localStorage.setItem(CLASSIC_PRINTER_KEY, JSON.stringify({
      ...device,
      timestamp: Date.now(),
    }));

    // Broadcast connection change
    window.dispatchEvent(new CustomEvent('printerConnectionChange', { detail: { connected: true, type: 'classic' } }));

    console.log(`✅ Connected to Classic BT printer: ${device.name}`);
    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Classic BT printer connection error:', error);
    return { success: false, error: errorMessage };
  }
};

/**
 * Disconnect from Classic Bluetooth printer
 */
export const disconnectClassicPrinter = async (): Promise<void> => {
  try {
    await BluetoothClassic.disconnect();
  } catch (error) {
    console.warn('⚠️ Error disconnecting Classic BT printer:', error);
  }
  clearClassicPrinterState();
};

const clearClassicPrinterState = () => {
  classicPrinter = {
    device: null,
    address: null,
    isConnected: false,
  };
  window.dispatchEvent(new CustomEvent('printerConnectionChange', { detail: { connected: false, type: 'classic' } }));
};

/**
 * Check if Classic printer is connected
 */
export const isClassicPrinterConnected = (): boolean => {
  return classicPrinter.isConnected;
};

/**
 * Get stored Classic printer device
 */
export const getStoredClassicPrinter = (): (ClassicBluetoothDevice & { timestamp: number }) | null => {
  try {
    const stored = localStorage.getItem(CLASSIC_PRINTER_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

/**
 * Quick reconnect to last used Classic printer
 */
export const quickReconnectClassicPrinter = async (): Promise<{ success: boolean; error?: string }> => {
  const storedDevice = getStoredClassicPrinter();
  if (!storedDevice) {
    return { success: false, error: 'No stored Classic printer' };
  }

  // Check if device is still valid (within 24 hours)
  const hoursSinceLastConnect = (Date.now() - storedDevice.timestamp) / (1000 * 60 * 60);
  if (hoursSinceLastConnect > 24) {
    localStorage.removeItem(CLASSIC_PRINTER_KEY);
    return { success: false, error: 'Stored printer expired' };
  }

  return connectClassicPrinter(storedDevice);
};

/**
 * Print data to Classic Bluetooth printer using SPP
 */
export const printToClassicPrinter = async (content: string): Promise<{ success: boolean; error?: string }> => {
  if (!classicPrinter.isConnected) {
    return { success: false, error: 'No Classic printer connected' };
  }

  try {
    console.log('🖨️ Printing via Classic Bluetooth SPP...');
    
    // ESC/POS commands
    const ESC = '\x1B';
    const GS = '\x1D';
    
    // Build print data with ESC/POS commands
    const printData = 
      ESC + '@' +           // Initialize printer
      ESC + 'a\x01' +       // Center alignment
      content +
      '\n\n\n\n\n' +        // Line feeds
      GS + 'V\x00';         // Cut paper
    
    // Send data in chunks to avoid buffer overflow
    const chunkSize = 200;
    for (let i = 0; i < printData.length; i += chunkSize) {
      const chunk = printData.slice(i, i + chunkSize);
      await BluetoothClassic.write({ data: chunk });
      // Small delay between chunks
      if (i + chunkSize < printData.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    console.log('✅ Classic BT print completed');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Print failed';
    console.error('❌ Classic BT print error:', error);
    return { success: false, error: errorMessage };
  }
};

/**
 * Get paired devices that are likely printers
 */
export const getPairedPrinters = async (): Promise<ClassicBluetoothDevice[]> => {
  const devices = await getPairedDevices();
  const printerPatterns = [
    'PRINT', 'POS', 'THERMAL', 'RECEIPT', 'EPSON', 'STAR', 
    'BIXOLON', 'ZEBRA', 'TSP', 'TM-', 'CS10', 'SUNMI', 'IMIN',
    'PP-', 'RPP', 'PT-', 'MPT-', 'MP-',
  ];
  
  return devices.filter(d => {
    if (!d.name) return false;
    const upperName = d.name.toUpperCase();
    return printerPatterns.some(pattern => upperName.includes(pattern));
  });
};
