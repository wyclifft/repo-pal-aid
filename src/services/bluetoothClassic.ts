/**
 * Classic Bluetooth SPP (Serial Port Profile) Service
 * Supports industrial scales like DR series that use RFCOMM/Serial connections
 */

import { Capacitor } from '@capacitor/core';

// Types for Classic Bluetooth
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

let classicScale: ClassicScaleConnection = {
  device: null,
  address: null,
  isConnected: false,
  connectionType: 'classic-spp',
};

// Storage keys
const CLASSIC_DEVICE_KEY = 'lastClassicBluetoothDevice';

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

// Lazy load the Bluetooth Serial plugin
let BluetoothSerial: any = null;
let pluginLoadError: string | null = null;

const loadBluetoothSerial = async (): Promise<any> => {
  if (pluginLoadError) {
    console.warn('⚠️ Classic Bluetooth plugin previously failed to load:', pluginLoadError);
    return null;
  }
  
  if (BluetoothSerial) return BluetoothSerial;
  
  if (!Capacitor.isNativePlatform()) {
    console.log('ℹ️ Classic Bluetooth only available on native platforms');
    return null;
  }
  
  try {
    const module = await import('capacitor-bluetooth-serial');
    BluetoothSerial = module.BluetoothSerial;
    console.log('✅ Classic Bluetooth Serial plugin loaded');
    return BluetoothSerial;
  } catch (error: any) {
    pluginLoadError = error.message || 'Failed to load plugin';
    console.warn('⚠️ Classic Bluetooth Serial plugin not available:', error);
    return null;
  }
};

// Check if device name suggests Classic Bluetooth (industrial scale)
export const isLikelyClassicDevice = (deviceName: string | undefined): boolean => {
  if (!deviceName) return false;
  const upperName = deviceName.toUpperCase();
  return CLASSIC_SCALE_PATTERNS.some(pattern => upperName.includes(pattern.toUpperCase()));
};

// Check if Classic Bluetooth is available
export const isClassicBluetoothAvailable = async (): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) return false;
  
  const plugin = await loadBluetoothSerial();
  if (!plugin) return false;
  
  try {
    const result = await plugin.isEnabled();
    return result.enabled === true;
  } catch (error) {
    console.warn('⚠️ Failed to check Classic Bluetooth status:', error);
    return false;
  }
};

// Enable Bluetooth if needed
export const enableClassicBluetooth = async (): Promise<boolean> => {
  const plugin = await loadBluetoothSerial();
  if (!plugin) return false;
  
  try {
    await plugin.enable();
    return true;
  } catch (error) {
    console.warn('⚠️ Failed to enable Bluetooth:', error);
    return false;
  }
};

// Get list of paired (bonded) devices
export const getPairedDevices = async (): Promise<ClassicBluetoothDevice[]> => {
  const plugin = await loadBluetoothSerial();
  if (!plugin) return [];
  
  try {
    console.log('🔍 Getting paired Bluetooth devices...');
    const result = await plugin.list();
    
    const devices: ClassicBluetoothDevice[] = (result.devices || []).map((d: any) => ({
      address: d.address || d.id,
      name: d.name || `Unknown (${d.address?.slice(-6) || 'N/A'})`,
      bonded: true,
      deviceClass: d.class,
    }));
    
    console.log(`📱 Found ${devices.length} paired devices:`, devices.map(d => d.name).join(', '));
    return devices;
  } catch (error) {
    console.error('❌ Failed to get paired devices:', error);
    return [];
  }
};

// Get paired devices that look like scales
export const getPairedScales = async (): Promise<ClassicBluetoothDevice[]> => {
  const allDevices = await getPairedDevices();
  const scales = allDevices.filter(d => isLikelyClassicDevice(d.name));
  console.log(`📊 Found ${scales.length} potential scale devices:`, scales.map(d => d.name).join(', '));
  return scales;
};

// Parse weight data from raw serial data
const parseSerialWeightData = (data: string): number | null => {
  console.log(`📊 Raw Classic BT data: "${data}" (${data.length} chars)`);
  
  // Clean the data
  const cleanData = data.trim().replace(/[\x00-\x1F\x7F]/g, '');
  
  // Strategy 1: Standard weight format like "ST,GS,+  12.345kg" or "12.345 kg"
  const standardMatch = cleanData.match(/[+-]?\s*(\d+\.?\d*)\s*(kg|g|lb|oz)?/i);
  if (standardMatch) {
    let weight = parseFloat(standardMatch[1]);
    const unit = standardMatch[2]?.toLowerCase();
    
    if (unit === 'g') weight = weight / 1000;
    else if (unit === 'lb') weight = weight * 0.453592;
    else if (unit === 'oz') weight = weight * 0.0283495;
    
    if (weight > 0 && weight < 1000) {
      console.log(`✅ Parsed weight (standard): ${weight.toFixed(3)} kg`);
      return weight;
    }
  }
  
  // Strategy 2: Just decimal number
  const decimalMatch = cleanData.match(/(\d+\.\d{1,4})/);
  if (decimalMatch) {
    const weight = parseFloat(decimalMatch[1]);
    if (weight > 0 && weight < 500) {
      console.log(`✅ Parsed weight (decimal): ${weight.toFixed(3)} kg`);
      return weight;
    }
  }
  
  // Strategy 3: Integer representing grams
  const intMatch = cleanData.replace(/[^0-9]/g, '');
  if (intMatch.length >= 3) {
    const intValue = parseInt(intMatch);
    if (intValue > 100 && intValue < 500000) {
      const weight = intValue / 1000;
      console.log(`✅ Parsed weight (grams): ${weight.toFixed(3)} kg`);
      return weight;
    }
  }
  
  // Strategy 4: Hex format (some Chinese scales)
  const hexMatch = cleanData.match(/[0-9A-Fa-f]{4,8}/);
  if (hexMatch) {
    const hexValue = parseInt(hexMatch[0], 16);
    if (hexValue > 0 && hexValue < 500000) {
      const weight = hexValue / 1000;
      if (weight > 0.1 && weight < 500) {
        console.log(`✅ Parsed weight (hex): ${weight.toFixed(3)} kg`);
        return weight;
      }
    }
  }
  
  console.log(`⚠️ Could not parse weight from: "${cleanData}"`);
  return null;
};

// Connect to a Classic Bluetooth scale
export const connectClassicScale = async (
  device: ClassicBluetoothDevice,
  onWeightUpdate: (weight: number) => void
): Promise<{ success: boolean; error?: string }> => {
  const plugin = await loadBluetoothSerial();
  if (!plugin) {
    return { success: false, error: 'Classic Bluetooth plugin not available' };
  }
  
  try {
    console.log(`🔗 Connecting to Classic Bluetooth device: ${device.name} (${device.address})`);
    
    // Disconnect if already connected
    if (classicScale.isConnected && classicScale.address) {
      try {
        await plugin.disconnect();
        console.log('🔌 Disconnected previous Classic BT connection');
      } catch (e) {
        console.warn('⚠️ Failed to disconnect previous connection:', e);
      }
    }
    
    // Connect using RFCOMM/SPP
    await plugin.connect({ address: device.address });
    console.log('✅ Connected to Classic Bluetooth device');
    
    // Set up data listener
    await plugin.enableNotifications();
    
    // Listen for incoming data
    plugin.addListener('dataReceived', (data: any) => {
      const rawData = data?.data || data?.value || (typeof data === 'string' ? data : '');
      const weight = parseSerialWeightData(rawData);
      if (weight !== null) {
        onWeightUpdate(weight);
      }
    });
    
    // Update state
    classicScale = {
      device,
      address: device.address,
      isConnected: true,
      connectionType: 'classic-spp',
    };
    
    // Save for quick reconnect
    saveClassicDeviceInfo(device);
    
    // Broadcast connection change
    window.dispatchEvent(new CustomEvent('scaleConnectionChange', { detail: { connected: true, type: 'classic-spp' } }));
    
    console.log('✅ Classic Bluetooth scale ready');
    return { success: true };
  } catch (error: any) {
    console.error('❌ Classic Bluetooth connection failed:', error);
    clearClassicScaleState();
    return { success: false, error: error.message || 'Connection failed' };
  }
};

// Disconnect from Classic Bluetooth scale
export const disconnectClassicScale = async (): Promise<void> => {
  const plugin = await loadBluetoothSerial();
  
  if (plugin && classicScale.isConnected) {
    try {
      await plugin.removeAllListeners();
      await plugin.disconnect();
      console.log('🔌 Disconnected from Classic Bluetooth scale');
    } catch (e) {
      console.warn('⚠️ Failed to disconnect Classic BT:', e);
    }
  }
  
  clearClassicScaleState();
};

// Clear state
const clearClassicScaleState = () => {
  classicScale = {
    device: null,
    address: null,
    isConnected: false,
    connectionType: 'classic-spp',
  };
  window.dispatchEvent(new CustomEvent('scaleConnectionChange', { detail: { connected: false } }));
};

// Save device info
const saveClassicDeviceInfo = (device: ClassicBluetoothDevice) => {
  localStorage.setItem(CLASSIC_DEVICE_KEY, JSON.stringify({
    ...device,
    timestamp: Date.now(),
  }));
};

// Get stored device info
export const getStoredClassicDevice = (): (ClassicBluetoothDevice & { timestamp: number }) | null => {
  try {
    const stored = localStorage.getItem(CLASSIC_DEVICE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

// Clear stored device
export const clearStoredClassicDevice = () => {
  localStorage.removeItem(CLASSIC_DEVICE_KEY);
};

// Quick reconnect to last connected device
export const quickReconnectClassicScale = async (
  onWeightUpdate: (weight: number) => void
): Promise<{ success: boolean; error?: string }> => {
  const storedDevice = getStoredClassicDevice();
  if (!storedDevice) {
    return { success: false, error: 'No stored device' };
  }
  
  // Check if device is still paired
  const pairedDevices = await getPairedDevices();
  const device = pairedDevices.find(d => d.address === storedDevice.address);
  
  if (!device) {
    clearStoredClassicDevice();
    return { success: false, error: 'Device no longer paired' };
  }
  
  return connectClassicScale(device, onWeightUpdate);
};

// Check if Classic scale is connected
export const isClassicScaleConnected = (): boolean => {
  return classicScale.isConnected;
};

// Get current Classic scale info
export const getCurrentClassicScaleInfo = (): { address: string; name: string } | null => {
  if (!classicScale.device || !classicScale.isConnected) return null;
  return {
    address: classicScale.address!,
    name: classicScale.device.name,
  };
};

// Send command to scale (some scales require commands to start streaming)
export const sendScaleCommand = async (command: string): Promise<boolean> => {
  const plugin = await loadBluetoothSerial();
  if (!plugin || !classicScale.isConnected) return false;
  
  try {
    await plugin.write({ value: command });
    console.log(`📤 Sent command to scale: "${command}"`);
    return true;
  } catch (error) {
    console.error('❌ Failed to send command:', error);
    return false;
  }
};

// Common scale commands
export const SCALE_COMMANDS = {
  READ_WEIGHT: '\x05',      // ENQ - common request for weight
  TARE: 'T',                // Tare command
  ZERO: 'Z',                // Zero command
  CONTINUOUS: 'C',          // Start continuous output
  STOP: 'S',                // Stop continuous output
  CRLF: '\r\n',             // Line terminator
};
