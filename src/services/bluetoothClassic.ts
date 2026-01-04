/**
 * Classic Bluetooth SPP (Serial Port Profile) Service
 * Supports industrial scales like DR series that use RFCOMM/Serial connections
 * 
 * NOTE: This module uses dynamic imports to avoid breaking web builds.
 * Classic Bluetooth is only available on native Android platforms.
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

// Classic Bluetooth is not available in web builds - these are stub implementations
// In a native app, you would need to implement a custom Capacitor plugin for Classic BT
// or use an existing compatible one

// Check if device name suggests Classic Bluetooth (industrial scale)
export const isLikelyClassicDevice = (deviceName: string | undefined): boolean => {
  if (!deviceName) return false;
  const upperName = deviceName.toUpperCase();
  return CLASSIC_SCALE_PATTERNS.some(pattern => upperName.includes(pattern.toUpperCase()));
};

// Classic Bluetooth is currently only supported through BLE fallback
// DR series scales that use Classic BT SPP need to be paired at system level
// and may appear as BLE devices with SPP-like services
export const isClassicBluetoothAvailable = async (): Promise<boolean> => {
  // Classic BT SPP requires a native plugin that's compatible with Capacitor 7
  // Currently, no stable Capacitor 7 compatible Classic BT plugin exists
  // Users should try BLE connection first - many "Classic" scales also support BLE
  console.log('ℹ️ Classic Bluetooth SPP: Using BLE with extended service discovery');
  return false;
};

// Placeholder - returns empty array since Classic BT plugin not available
export const getPairedDevices = async (): Promise<ClassicBluetoothDevice[]> => {
  console.log('ℹ️ Classic Bluetooth: Paired device listing requires native plugin');
  console.log('💡 Tip: DR series scales (BTM modules) often work via BLE with FFE0/FFE1 services');
  return [];
};

// Placeholder - returns empty array
export const getPairedScales = async (): Promise<ClassicBluetoothDevice[]> => {
  return getPairedDevices();
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
  
  console.log(`⚠️ Could not parse weight from: "${cleanData}"`);
  return null;
};

// Placeholder - Classic BT connection not available without native plugin
export const connectClassicScale = async (
  device: ClassicBluetoothDevice,
  onWeightUpdate: (weight: number) => void
): Promise<{ success: boolean; error?: string }> => {
  console.log('⚠️ Classic Bluetooth SPP connection requires a native Capacitor plugin');
  console.log('💡 Try using BLE connection instead - most BTM/DR scales support both');
  return { 
    success: false, 
    error: 'Classic Bluetooth SPP not available. Please use BLE connection.' 
  };
};

// Disconnect placeholder
export const disconnectClassicScale = async (): Promise<void> => {
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

// Quick reconnect placeholder
export const quickReconnectClassicScale = async (
  onWeightUpdate: (weight: number) => void
): Promise<{ success: boolean; error?: string }> => {
  return { success: false, error: 'Classic Bluetooth not available' };
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

// Common scale commands (for future use when native plugin is available)
export const SCALE_COMMANDS = {
  READ_WEIGHT: '\x05',      // ENQ - common request for weight
  TARE: 'T',                // Tare command
  ZERO: 'Z',                // Zero command
  CONTINUOUS: 'C',          // Start continuous output
  STOP: 'S',                // Stop continuous output
  CRLF: '\r\n',             // Line terminator
};
