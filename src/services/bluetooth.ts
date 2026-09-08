import { type Farmer } from '@/lib/supabase';
import { resolveMemberName } from '@/utils/farmerUtils';
import { BleClient, BleDevice, numberToUUID } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { logConnectionTips } from '@/utils/bluetoothDiagnostics';
import {
  isClassicBluetoothAvailable,
  getPairedScales,
  connectClassicScale,
  disconnectClassicScale,
  isClassicScaleConnected,
  getCurrentClassicScaleInfo,
  quickReconnectClassicScale,
  getStoredClassicDevice,
  clearStoredClassicDevice,
  type ClassicBluetoothDevice,
  isLikelyClassicDevice,
  // Classic Printer functions
  connectClassicPrinter,
  disconnectClassicPrinter,
  isClassicPrinterConnected,
  getCurrentClassicPrinterInfo,
  printToClassicPrinter,
  getPairedPrinters,
  quickReconnectClassicPrinter,
  getStoredClassicPrinter,
  isInternalPosPrinter,
  connectDirectToAddress,
  isInternalPrinterAvailable,
  connectInternalPrinter,
  printToInternalPrinter,
  INTERNAL_PRINTER_ADDRESSES,
} from './bluetoothClassic';

// Re-export Classic Bluetooth functions for convenience
export {
  isClassicBluetoothAvailable,
  getPairedScales,
  connectClassicScale,
  disconnectClassicScale,
  isClassicScaleConnected,
  getCurrentClassicScaleInfo,
  quickReconnectClassicScale,
  getStoredClassicDevice,
  clearStoredClassicDevice,
  type ClassicBluetoothDevice,
  isLikelyClassicDevice,
  // Classic Printer exports
  connectClassicPrinter,
  disconnectClassicPrinter,
  isClassicPrinterConnected,
  getCurrentClassicPrinterInfo,
  printToClassicPrinter,
  getPairedPrinters,
  quickReconnectClassicPrinter,
  getStoredClassicPrinter,
  isInternalPosPrinter,
  connectDirectToAddress,
  isInternalPrinterAvailable,
  connectInternalPrinter,
  printToInternalPrinter,
  INTERNAL_PRINTER_ADDRESSES,
};

export type ScaleType = 'HC-05' | 'HM-10' | 'DR-Series' | 'BTM-Series' | 'Classic-SPP' | 'Unknown';
export type ConnectionType = 'ble' | 'classic-spp';

// DR Series scale models for detection
const DR_SERIES_MODELS = [
  'DR 10', 'DR10', 'DR-10',
  'DR 20', 'DR20', 'DR-20',
  'DR 30', 'DR30', 'DR-30',
  'DR 40', 'DR40', 'DR-40',
  'DR 50', 'DR50', 'DR-50',
  'DR 60', 'DR60', 'DR-60',
  'DR 70', 'DR70', 'DR-70',
  'DR 80', 'DR80', 'DR-80',
  'DR 90', 'DR90', 'DR-90',
  'DR 100', 'DR100', 'DR-100',
  'DR 150', 'DR150', 'DR-150',
  'T SCALE', 'T-SCALE', 'TSCALE',
  'SCALE DR', 'SCALE-DR',
];

// BTM Series (Bluetooth Module scales) - common Chinese Bluetooth scale modules
// These are often used in various digital scales including T-Scale DR series
const BTM_SERIES_PATTERNS = [
  'BTM', 'BTM0', 'BTM03', 'BTM04', 'BTM05',
  'BTM0304', 'BTM0404', 'BTM0504',
  'BTM0304C', 'BTM0404C', 'BTM0504C',
  // Common Bluetooth module prefixes
  'BT-', 'BT_', 'BTLE', 'BLE-',
  'HC-', 'HM-', 'JDY-', 'CC41',
  // Generic scale prefixes
  'SCALE', 'WEIGHT', 'BALANCE', 'TY',
];

// Check if device name matches DR series
const isDRSeriesScale = (deviceName: string | undefined): boolean => {
  if (!deviceName) return false;
  const upperName = deviceName.toUpperCase();
  return DR_SERIES_MODELS.some(model => upperName.includes(model.toUpperCase()));
};

// Check if device name matches BTM series (Bluetooth Module)
const isBTMSeriesScale = (deviceName: string | undefined): boolean => {
  if (!deviceName) return false;
  const upperName = deviceName.toUpperCase();
  return BTM_SERIES_PATTERNS.some(pattern => upperName.includes(pattern.toUpperCase()));
};

// v2.10.99: Dual-mode HC-04/HC-05 modules expose BOTH a Classic SPP port
// (e.g. "HC-04") that streams weight AND a BLE companion port (e.g. "HC-04BLE")
// that does NOT transmit weight. We must never auto-connect or list the BLE
// half — it silently pairs, reports "connected" but no data ever arrives.
// Match any name ending in "BLE" (case-insensitive) belonging to a known
// scale module family.
export const isBleHalfOfDualModeScale = (deviceName: string | undefined): boolean => {
  if (!deviceName) return false;
  const upper = deviceName.trim().toUpperCase();
  if (!/BLE$/.test(upper)) return false;
  // Strip trailing BLE (and optional separator) to test the underlying base name.
  const base = upper.replace(/[-_ ]?BLE$/, '');
  if (!base) return false;
  // Treat as dual-mode if the base looks like a known scale module prefix.
  return /^(HC-?\d+|HM-?\d+|BTM|JDY|CC41|BT[-_])/.test(base);
};

// Check if device is a compatible scale (DR Series or BTM Series)
const isCompatibleScale = (deviceName: string | undefined): boolean => {
  // Never treat the BLE half of a dual-mode scale as a usable scale.
  if (isBleHalfOfDualModeScale(deviceName)) return false;
  return isDRSeriesScale(deviceName) || isBTMSeriesScale(deviceName);
};

// Log helpful tips when this module loads
if (typeof window !== 'undefined') {
  logConnectionTips();
}

interface BluetoothScale {
  device: BleDevice | any | null;
  deviceId: string | null;
  serviceUuid: string | null;
  characteristic: string | any | null;
  type: ScaleType;
  isConnected: boolean;
  connectionType: ConnectionType;
}

let scale: BluetoothScale = {
  device: null,
  deviceId: null,
  serviceUuid: null,
  characteristic: null,
  type: 'Unknown',
  isConnected: false,
  connectionType: 'ble',
};

// v2.10.101: Session state tracker for strict sequential GATT flow
type BLESessionState = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'DISCOVERING' | 'NOTIFYING' | 'HANDSHAKING' | 'READY';
let bleSessionState: BLESessionState = 'IDLE';

const setBleState = (state: BLESessionState) => {
  console.log(`📡 [BLE-STATE] Transition: ${bleSessionState} -> ${state}`);
  bleSessionState = state;
};

// Check if a GATT error is status 201 (Device Not Ready)
const isGattNotReadyError = (error: any): boolean => {
  const msg = error?.message || String(error);
  return msg.includes('status 201') || msg.includes('GATT_INTERNAL_ERROR') || msg.includes('Not ready');
};

interface BluetoothPrinter {
  device: BleDevice | any | null;
  deviceId: string | null;
  characteristic: { serviceUuid: string; charUuid: string; writeWithoutResponse: boolean } | null;
  isConnected: boolean;
}

let printer: BluetoothPrinter = {
  device: null,
  deviceId: null,
  characteristic: null,
  isConnected: false,
};

// v2.10.54: Track when scale was last (re)connected to defer printer auto-reconnect
let lastScaleConnectedAt = 0;
export const getLastScaleConnectedAt = (): number => lastScaleConnectedAt;

// v2.10.54: Module-level BLE op mutex — serialize connect/scan/reconnect to
// prevent the shared Android GATT client from killing the other device.
let bleOperationLock: Promise<unknown> = Promise.resolve();
const runBleOp = <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const next = bleOperationLock.then(async () => {
    console.log(`🔒 [BLE-LOCK] acquired by ${label}`);
    try {
      return await fn();
    } finally {
      console.log(`🔓 [BLE-LOCK] released by ${label}`);
    }
  });
  // Ensure chain doesn't break on rejection
  bleOperationLock = next.catch(() => undefined);
  return next as Promise<T>;
};

// Store device info for quick reconnect
interface StoredDeviceInfo {
  deviceId: string;
  deviceName: string;
  scaleType: ScaleType;
  connectionType: ConnectionType;
  timestamp: number;
}

const STORAGE_KEY = 'lastConnectedScale';
const PRINTER_STORAGE_KEY = 'lastConnectedPrinter';

interface StoredPrinterInfo {
  deviceId: string;
  deviceName: string;
  timestamp: number;
}

// Debounce mechanism for BLE verification to prevent Android Bluetooth stack issues from frequent calls
let lastVerificationTime = 0;
const VERIFICATION_DEBOUNCE_MS = 2000; // Minimum 2 seconds between verifications

const canVerifyConnection = (): boolean => {
  const now = Date.now();
  if (now - lastVerificationTime < VERIFICATION_DEBOUNCE_MS) {
    return false;
  }
  lastVerificationTime = now;
  return true;
};

const saveDeviceInfo = (deviceId: string, deviceName: string, scaleType: ScaleType, connectionType: ConnectionType = 'ble') => {
  const info: StoredDeviceInfo = {
    deviceId,
    deviceName,
    scaleType,
    connectionType,
    timestamp: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
  // v2.10.100: keep the two scale slots (BLE vs Classic SPP) mutually
  // exclusive. If we just saved a BLE scale, drop any prior Classic record;
  // saveClassicDeviceInfo() does the symmetric clear for the other side.
  if (connectionType === 'ble') {
    try { localStorage.removeItem('lastClassicBluetoothDevice'); } catch {}
  }
};

export const getStoredDeviceInfo = (): StoredDeviceInfo | null => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as StoredDeviceInfo;
  } catch {
    return null;
  }
};

export const clearStoredDevice = () => {
  localStorage.removeItem(STORAGE_KEY);
};

const savePrinterInfo = (deviceId: string, deviceName: string) => {
  const info: StoredPrinterInfo = {
    deviceId,
    deviceName,
    timestamp: Date.now(),
  };
  localStorage.setItem(PRINTER_STORAGE_KEY, JSON.stringify(info));
};

export const getStoredPrinterInfo = (): StoredPrinterInfo | null => {
  const stored = localStorage.getItem(PRINTER_STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as StoredPrinterInfo;
  } catch {
    return null;
  }
};

export const clearStoredPrinter = () => {
  localStorage.removeItem(PRINTER_STORAGE_KEY);
};

const SERVICE_UUID_HC05 = numberToUUID(0xffe0);
const SERVICE_UUID_HM10 = numberToUUID(0xfee7);
const SERVICE_UUID_TUYA = numberToUUID(0xA201);
const SERVICE_UUID_TUYA_SMART = numberToUUID(0x1910);

// Expanded list of known scale service UUIDs for broader compatibility
// Including T-Scale DR series (DR 10-150), ACS, and other common digital scale modules
const GENERIC_SCALE_SERVICES = [
  // Standard HC-05 / HM-10 modules
  numberToUUID(0xffe0),
  numberToUUID(0xfee7),
  // Tuya Scale Services
  numberToUUID(0xA201),
  numberToUUID(0x1910),
  // Generic Access / Device Info (for discovery)
  numberToUUID(0x1800),
  numberToUUID(0x180a),
  // Common scale services (FFF0-FFF9 range)
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000fff1-0000-1000-8000-00805f9b34fb',
  '0000fff2-0000-1000-8000-00805f9b34fb',
  '0000fff3-0000-1000-8000-00805f9b34fb',
  '0000fff4-0000-1000-8000-00805f9b34fb',
  '0000fff5-0000-1000-8000-00805f9b34fb',
  // ISSC/Microchip Transparent UART
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  // Nordic UART Service (NUS) - used by many BLE scales
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  // T-Scale / DR Series common services (FFE0-FFE9 range) - CRITICAL for DR 10-150
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '0000ffe2-0000-1000-8000-00805f9b34fb',
  '0000ffe3-0000-1000-8000-00805f9b34fb',
  '0000ffe4-0000-1000-8000-00805f9b34fb',
  '0000ffe5-0000-1000-8000-00805f9b34fb',
  // Weight Scale Service (official Bluetooth SIG)
  numberToUUID(0x181d),
  // Heart Rate Service (some scales misuse this)
  numberToUUID(0x180d),
  // Battery Service (for discovery)
  numberToUUID(0x180f),
  // Xiaomi / Huami scales
  '00001530-0000-3512-2118-0009af100700',
  // Generic SPP-like services
  '00001101-0000-1000-8000-00805f9b34fb',
  // Additional DR series specific UUIDs
  '0000fee0-0000-1000-8000-00805f9b34fb',
  '0000fee1-0000-1000-8000-00805f9b34fb',
  '0000fee2-0000-1000-8000-00805f9b34fb',
  // Custom services sometimes used by T-Scale DR
  '0000180f-0000-1000-8000-00805f9b34fb',
  '0000181c-0000-1000-8000-00805f9b34fb',
];

// DR Series characteristic UUIDs - common across DR 10-150 models
const DR_SERIES_CHARACTERISTIC_PATTERNS = [
  'ffe1', 'ffe2', 'ffe3', 'ffe4', 'ffe5',
  'fff1', 'fff2', 'fff3', 'fff4', 'fff5',
  'fee1', 'fee2',
];

// Tuya-specific characteristic patterns
const TUYA_CHARACTERISTIC_PATTERNS = [
  '2b10', // Command/Write
  '2b11', // Data/Notify
  '2b12',
];

// Parse weight data from DR Series scales (DR 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150)
const parseDRSeriesWeight = (rawBytes: Uint8Array, text: string): number | null => {
  // DR Series scales typically send data in one of these formats:
  console.log(`📊 DR Parser input - text: "${text}", bytes: [${Array.from(rawBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);
  
  // PRIORITY 1: ASCII text formats - most reliable
  // Format: "ST,GS,+  12.345kg" or "  12.345 kg" or just "12.345"
  
  // v2.12.75: Allow parsing negative values for display (e.g. tared scale with container removed)
  // We no longer return 0 for negative matches.
  // v2.12.76: Fixed regex to allow unlimited leading zeros (scale sends many).
  const negativeMatch = text.match(/-\s*(\d+\.?\d*)/);
  if (negativeMatch) {
    const weight = -parseFloat(negativeMatch[1]);
    if (weight >= -50 && weight <= 200) {
      console.log(`✅ DR Series parsed negative: ${weight} kg`);
      return weight;
    }
  }
  
  // First try to find a proper decimal weight with decimal point (positive only)
  // v2.12.76: Fixed regex to allow unlimited leading zeros.
  const decimalMatch = text.match(/\+?\s*(\d+\.\d+)/);
  if (decimalMatch) {
    const weight = parseFloat(decimalMatch[1]);
    // Sanity check: realistic weight range (0.1 to 200 kg for dairy)
    if (weight >= 0.1 && weight <= 200) {
      console.log(`✅ DR Series parsed decimal: ${weight} kg`);
      return weight;
    }
    // Return 0 for values below 0.1 (essentially zero/empty)
    if (weight >= 0 && weight < 0.1) {
      console.log(`📊 DR Series: Near-zero weight (${weight}), returning 0`);
      return 0;
    }
  }
  
  // Format with unit suffix - check for sign
  const unitMatch = text.match(/([+-]?)\s*(\d+\.?\d*)\s*(kg|KG|Kg)/);
  if (unitMatch) {
    const isNegative = unitMatch[1] === '-';
    let weight = parseFloat(unitMatch[2]);
    if (isNegative) weight = -weight;

    if (weight >= -50 && weight <= 200) {
      console.log(`✅ DR Series parsed with unit: ${weight} kg`);
      return weight;
    }
    if (weight >= 0 && weight < 0.1) {
      return 0;
    }
  }
  
  // Grams format (e.g., "12345g" or "12345 g")
  const gramsMatch = text.match(/(\d{3,6})\s*(g|G)\b/);
  if (gramsMatch) {
    const weight = parseInt(gramsMatch[1]) / 1000;
    if (weight >= 0.1 && weight <= 200) {
      console.log(`✅ DR Series parsed grams: ${weight} kg`);
      return weight;
    }
  }
  
  // PRIORITY 2: Structured binary formats with known headers
  // Only parse binary if text parsing completely failed AND we have recognizable structure
  
  // Check for known scale data header patterns (0x02 STX, 0x53 'S', etc.)
  if (rawBytes.length >= 8 && (rawBytes[0] === 0x02 || rawBytes[0] === 0x53)) {
    // Common format: [STX][Status][Sign][Weight 4 bytes][Unit][ETX]
    // Weight as BCD or ASCII digits in bytes 3-6
    const isBCD = rawBytes.slice(3, 7).every(b => (b & 0xF0) <= 0x90 && (b & 0x0F) <= 0x09);
    if (isBCD) {
      // Decode BCD: each nibble is a digit
      let bcdValue = 0;
      for (let i = 3; i < 7; i++) {
        bcdValue = bcdValue * 100 + ((rawBytes[i] >> 4) * 10) + (rawBytes[i] & 0x0F);
      }
      const weight = bcdValue / 1000; // Assume 3 decimal places
      if (weight >= 0.1 && weight <= 200) {
        console.log(`✅ DR Series parsed BCD: ${weight} kg`);
        return weight;
      }
    }
  }
  
  // PRIORITY 3: Check if the entire text is digits that could be grams
  const cleanDigits = text.replace(/[^0-9]/g, '');
  if (cleanDigits.length >= 4 && cleanDigits.length <= 6) {
    const gramsValue = parseInt(cleanDigits);
    // Must be in reasonable grams range (100g to 200kg = 200000g)
    if (gramsValue >= 100 && gramsValue <= 200000) {
      const weight = gramsValue / 1000;
      console.log(`✅ DR Series parsed integer grams: ${weight} kg`);
      return weight;
    }
  }
  
  // DO NOT fall back to arbitrary binary byte interpretation
  // This was causing the hardcoded 212 kg issue from misinterpreted header bytes
  
  console.log(`⚠️ DR Series: Could not parse weight from data`);
  return null;
};

// Parse weight data from Tuya BLE scales (TY)
const parseTuyaWeight = (rawBytes: Uint8Array, text: string): number | null => {
  console.log(`📊 Tuya Parser input - bytes: [${Array.from(rawBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);

  // Tuya protocol often has weight in bytes 3-4 or 4-5 (Big Endian)
  // Standard report: [Header][Type][Len][W1][W0][Unit][...]
  // Common headers: 0x01 0x03 or 0x00 0x03 or just 0x03
  if (rawBytes.length >= 4) {
    // Check for weight report command (0x03)
    let weightOffset = -1;

    if (rawBytes[0] === 0x03 && rawBytes.length >= 3) {
      weightOffset = 1;
    } else if ((rawBytes[0] === 0x01 || rawBytes[0] === 0x00) && rawBytes[1] === 0x03 && rawBytes.length >= 4) {
      weightOffset = 2;
    } else if (rawBytes[2] === 0x03 && rawBytes.length >= 5) {
      weightOffset = 3;
    }

    if (weightOffset !== -1 && rawBytes.length >= weightOffset + 2) {
      const weightInt = (rawBytes[weightOffset] << 8) | rawBytes[weightOffset + 1];

      // Conversion depends on the scale.
      // Try 0.1kg first (common for industrial) then 0.01kg (common for kitchen/body)
      let weight = weightInt / 10;
      if (weight > 500) weight = weightInt / 100;

      if (weight >= 0 && weight <= 500) {
        console.log(`✅ Tuya parsed weight: ${weight} kg`);
        return weight;
      }
    }

    // Strategy: Look for 2-byte sequence that looks like weight (Big Endian)
    // Most industrial scales are 0-150kg, so 0-1500 in 0.1 units.
    for (let i = 0; i < rawBytes.length - 1; i++) {
      const val = (rawBytes[i] << 8) | rawBytes[i+1];
      if (val > 10 && val < 5000) { // Reasonable range 1.0kg to 500.0kg
        // Check if the previous byte is a known Tuya header
        if (i > 0 && (rawBytes[i-1] === 0x03 || rawBytes[i-1] === 0x01)) {
           console.log(`✅ Tuya heuristic parsed at offset ${i}: ${val/10} kg`);
           return val/10;
        }
      }
    }
  }

  return null;
};

// Clear scale state and broadcast disconnection
const clearScaleState = () => {
  scale = {
    device: null,
    deviceId: null,
    serviceUuid: null,
    characteristic: null,
    type: 'Unknown',
    isConnected: false,
    connectionType: 'ble',
  };
  setBleState('IDLE');
  broadcastScaleConnectionChange(false);
};

// Clear printer state and broadcast disconnection
const clearPrinterState = () => {
  printer = {
    device: null,
    deviceId: null,
    characteristic: null,
    isConnected: false,
  };
  broadcastPrinterConnectionChange(false);
};

// Broadcast connection state change events
export const broadcastScaleConnectionChange = (connected: boolean) => {
  // v2.10.69: Truth-source guard. A `connected: true` event MUST correspond to
  // an actual scale role being active — either a BLE scale with a deviceId on
  // the `scale` singleton, or a Classic SPP scale (isClassicScaleConnected()).
  // Otherwise it is suppressed. This makes it impossible for any future code
  // path (including printer reconnects on integrated POS hardware that share
  // the RFCOMM socket) to flip the Dashboard scale indicator green.
  if (connected) {
    const real = (scale.isConnected && !!scale.deviceId) || isClassicScaleConnected();
    if (!real) {
      console.warn('🚫 Suppressed scaleConnectionChange(true) — no scale role active (likely printer cross-talk)');
      return;
    }
    // Track last successful connect time so the printer auto-reconnect can
    // defer if the scale is "warming up" (avoids cross-talk on Android GATT).
    lastScaleConnectedAt = Date.now();
  }
  console.log(`📡 Broadcasting scale connection: ${connected}`);
  window.dispatchEvent(new CustomEvent('scaleConnectionChange', { detail: { connected } }));
};

// Broadcast weight update events - allows any component to receive live weight
export const broadcastScaleWeightUpdate = (weight: number, scaleType: ScaleType) => {
  console.log(`📡 Broadcasting weight update: ${weight} kg from ${scaleType}`);
  window.dispatchEvent(new CustomEvent('scaleWeightUpdate', { detail: { weight, scaleType } }));
};

export const broadcastPrinterConnectionChange = (connected: boolean) => {
  console.log(`📡 Broadcasting printer connection: ${connected}`);
  window.dispatchEvent(new CustomEvent('printerConnectionChange', { detail: { connected } }));
};

// Force re-subscribe to BLE notifications on current scale connection
// Use when weight data stops flowing but scale still shows connected
export const resubscribeScaleNotifications = async (
  onWeightUpdate: (weight: number, scaleType: ScaleType) => void
): Promise<{ success: boolean; error?: string }> => {
  if (!scale.deviceId || !scale.isConnected || scale.connectionType !== 'ble') {
    console.warn('⚠️ Cannot resubscribe: no BLE scale connected');
    return { success: false, error: 'No BLE scale connected' };
  }
  
  if (!Capacitor.isNativePlatform()) {
    console.warn('⚠️ Resubscribe only supported on native platform');
    return { success: false, error: 'Not supported on web' };
  }
  
  console.log('🔄 Force re-subscribing to scale notifications...');
  const deviceId = scale.deviceId;
  const scaleType = scale.type;
  
  try {
    // Stop existing notifications first
    if (scale.serviceUuid && scale.characteristic) {
      try {
        await BleClient.stopNotifications(deviceId, scale.serviceUuid, scale.characteristic);
        console.log('⏹️ Stopped existing notifications');
      } catch (e) {
        console.warn('⚠️ Could not stop existing notifications:', e);
      }
    }
    
    // Small delay for hardware reset
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Re-discover services
    const services = await BleClient.getServices(deviceId);
    console.log(`📋 Rediscovered ${services.length} services`);
    
    // Find notify/indicate characteristics
    let serviceUuid = '';
    let characteristicUuid = '';
    
    for (const service of services) {
      if (service.uuid.toLowerCase().includes('1800') || 
          service.uuid.toLowerCase().includes('1801') ||
          service.uuid.toLowerCase().includes('180a')) {
        continue;
      }
      
      const notifyChar = service.characteristics.find(c => c.properties.notify);
      const indicateChar = service.characteristics.find(c => c.properties.indicate);
      
      if (notifyChar) {
        serviceUuid = service.uuid;
        characteristicUuid = notifyChar.uuid;
        break;
      }
      if (indicateChar && !serviceUuid) {
        serviceUuid = service.uuid;
        characteristicUuid = indicateChar.uuid;
      }
    }
    
    if (!serviceUuid || !characteristicUuid) {
      throw new Error('No notify characteristic found');
    }
    
    // Create weight handler
    const handleResubscribeWeight = (value: DataView) => {
      const rawBytes = new Uint8Array(value.buffer);
      const text = new TextDecoder().decode(value);
      console.log(`📊 Resubscribe data: "${text}"`);
      
      // Parse weight
      let parsed: number | null = null;
      
      // Use DR/BTM parser
      parsed = parseDRSeriesWeight(rawBytes, text);

      if (parsed === null) {
        // Try Tuya parser
        parsed = parseTuyaWeight(rawBytes, text);
      }

      if (parsed === null) {
        // Standard decimal format
        const decimalMatch = text.match(/([+-]?)\s*(\d+\.\d+)/);
        if (decimalMatch) {
          const isNeg = decimalMatch[1] === '-';
          parsed = parseFloat(decimalMatch[2]);
          if (isNeg) parsed = -parsed;
        }
      }
      
      if (parsed === null) {
        // Zero match
        const zeroMatch = text.match(/^\s*[+-]?\s*0+\.?0*\s*$/);
        if (zeroMatch) parsed = 0;
      }
      
      if (parsed === null) {
        // Integer
        const intMatch = text.match(/([+-]?)\s*(\d+)/);
        if (intMatch) {
          const isNeg = intMatch[1] === '-';
          const intValue = parseInt(intMatch[2]);
          parsed = intValue > 1000 ? intValue / 1000 : intValue;
          if (isNeg) parsed = -parsed;
        }
      }
      
      if (parsed !== null && !isNaN(parsed) && parsed >= -50 && parsed < 1000) {
        console.log(`✅ Resubscribe weight: ${parsed} kg`);
        broadcastScaleWeightUpdate(parsed, scaleType);
        try { onWeightUpdate(parsed, scaleType); } catch (e) { /* Stale callback */ }
      }
    };
    
    // Start notifications
    await BleClient.startNotifications(
      deviceId,
      serviceUuid,
      characteristicUuid,
      handleResubscribeWeight
    );
    
    // Update scale state
    scale.serviceUuid = serviceUuid;
    scale.characteristic = characteristicUuid;
    
    console.log('✅ Successfully re-subscribed to notifications');
    broadcastScaleConnectionChange(true);
    
    return { success: true };
    
  } catch (error: any) {
    console.error('❌ Resubscribe failed:', error);
    return { success: false, error: error?.message || 'Resubscribe failed' };
  }
};

// Verify if scale is actually connected by checking BLE state
// Uses debouncing to prevent Android Bluetooth stack issues from frequent calls
// NOTE: Does NOT clear state on timeout - only on definitive disconnection evidence
export const verifyScaleConnection = async (): Promise<boolean> => {
  // First check if Classic scale is connected
  if (isClassicScaleConnected()) {
    return true;
  }
  
  if (!scale.deviceId || !scale.isConnected) {
    return false;
  }

  // v2.10.101: If we are in the middle of a connection flow, don't interrupt
  if (bleSessionState !== 'READY' && bleSessionState !== 'IDLE') {
     return true;
  }
  
  // Skip verification if called too frequently (return cached state)
  if (!canVerifyConnection()) {
    return scale.isConnected;
  }
  
  if (Capacitor.isNativePlatform()) {
    try {
      // v2.10.101: use getServices as a real GATT health check.
      // If it fails with status 201 or any error, the GATT session is dead.
      const verifyPromise = BleClient.getServices(scale.deviceId).then(() => true).catch(() => false);
      const timeoutPromise = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000));
      const ok = await Promise.race([verifyPromise, timeoutPromise]);

      if (!ok) {
        console.warn('⚠️ Scale GATT health check failed (timeout or error)');
        return false;
      }
      return true;
    } catch (error) {
      console.warn('⚠️ Scale connection verification error:', error);
      return false;
    }
  }
  
  // For web, check gatt connection
  if (scale.device?.gatt?.connected) {
    return true;
  }
  
  // Only clear on definitive web bluetooth disconnection
  if (scale.device?.gatt && !scale.device.gatt.connected) {
    clearScaleState();
    return false;
  }
  
  return scale.isConnected;
};

// Verify if printer is actually connected
// Uses debouncing to prevent Android Bluetooth stack issues from frequent calls
// NOTE: Does NOT clear state on timeout - only on definitive disconnection evidence
export const verifyPrinterConnection = async (): Promise<boolean> => {
  // First check if Classic printer is connected
  if (isClassicPrinterConnected()) {
    return true;
  }
  
  if (!printer.deviceId || !printer.isConnected) {
    return false;
  }
  
  // Skip verification if called too frequently (return cached state)
  if (!canVerifyConnection()) {
    return printer.isConnected;
  }
  
  if (Capacitor.isNativePlatform()) {
    try {
      // Use a timeout to prevent hanging on some Android devices
      const timeoutPromise = new Promise<boolean>((resolve) => 
        setTimeout(() => resolve(true), 3000) // On timeout, assume still connected
      );
      const verifyPromise = BleClient.getServices(printer.deviceId).then(() => true).catch(() => false);
      const result = await Promise.race([verifyPromise, timeoutPromise]);
      if (!result) {
        console.warn('⚠️ Printer verification failed but not clearing state');
      }
      return result;
    } catch (error) {
      console.warn('⚠️ Printer connection verification error:', error);
      // Don't clear state - let the actual print operation fail gracefully
      return printer.isConnected;
    }
  }
  
  if (printer.device?.gatt?.connected) {
    return true;
  }
  
  // Only clear on definitive web bluetooth disconnection
  if (printer.device?.gatt && !printer.device.gatt.connected) {
    clearPrinterState();
    return false;
  }
  
  return printer.isConnected;
};

export const connectBluetoothScale = async (
  onWeightUpdate: (weight: number, scaleType: ScaleType) => void
): Promise<{ success: boolean; type: ScaleType; error?: string }> => {
  return runBleOp('connectBluetoothScale', async () => {
    try {
      setBleState('IDLE');
      
      // Disconnect existing connection first to ensure clean state
      if (scale.isConnected && scale.deviceId) {
        try {
          console.log('🧹 Cleaning up existing BLE connection before new attempt...');
          await BleClient.disconnect(scale.deviceId);
        } catch (e) {
          console.warn('Failed to disconnect existing scale (ignoring):', e);
        }
      }
      clearScaleState();

      if (Capacitor.isNativePlatform()) {
        await BleClient.initialize();

        console.log('🔍 Requesting Bluetooth scale device...');
        setBleState('CONNECTING');

        const device = await BleClient.requestDevice({
          optionalServices: GENERIC_SCALE_SERVICES,
        });

        console.log(`📱 Device selected: ${device.name || 'Unknown'} (ID: ${device.deviceId})`);

        if (isBleHalfOfDualModeScale(device.name)) {
          console.warn(`🚫 Rejected BLE half of dual-mode scale: ${device.name}`);
          try { await BleClient.disconnect(device.deviceId); } catch {}
          setBleState('IDLE');
          return {
            success: false,
            type: 'Unknown',
            error: `${device.name} is the BLE port and does not transmit weight.`,
          };
        }

        // 1. CONNECT
        await BleClient.connect(device.deviceId, (disconnectedDeviceId) => {
          if (disconnectedDeviceId === scale.deviceId) {
            console.log(`⚠️ Scale ${disconnectedDeviceId} disconnected unexpectedly`);
            clearScaleState();
            setBleState('IDLE');
          }
        });
        setBleState('CONNECTED');
        console.log('✅ [STEP 1/4] Connected to GATT server');

        // 2. DISCOVER & VERIFY
        setBleState('DISCOVERING');
        const services = await BleClient.getServices(device.deviceId);
        console.log(`📋 [STEP 2/4] Discovered ${services.length} services`);

        // Log all for debugging
        console.log('📋 Full Discovered Services/Characteristics:');
        for (const s of services) {
          console.log(`  Service: ${s.uuid}`);
          for (const c of s.characteristics) {
            console.log(`    📌 Char: ${c.uuid} [notify:${c.properties.notify}, indicate:${c.properties.indicate}, read:${c.properties.read}, write:${c.properties.write}]`);
          }
        }

        let scaleType: ScaleType = 'Unknown';
        let serviceUuid = '';
        let characteristicUuid = '';
        let writeUuid = '';

        const isBTMScale = isBTMSeriesScale(device.name);
        const isDRScale = isDRSeriesScale(device.name);
        const isTuyaDevice = (device.name && device.name.toUpperCase().includes('TY')) ||
            services.some(s => s.uuid.toLowerCase().includes('1910') || s.uuid.toLowerCase().includes('a201'));

        if (isTuyaDevice) scaleType = 'Unknown';
        if (isBTMScale) scaleType = 'BTM-Series';
        if (isDRScale) scaleType = 'DR-Series';

        // Find Target Service and Characteristics
        for (const service of services) {
          const uuid = service.uuid.toLowerCase();
          const isScaleService = DR_SERIES_CHARACTERISTIC_PATTERNS.some(p => uuid.includes(p)) ||
              uuid.includes('ffe0') || uuid.includes('fff0') || uuid.includes('fee0') ||
              uuid.includes('1910') || uuid.includes('a201') ||
              uuid.includes('1101');
              
          if (isScaleService) {
            if (isTuyaDevice) {
               // v2.10.101: 2b10 = Notify/Data, 2b11 = Write/Command
               const tuyaNotify = service.characteristics.find(c => c.uuid.toLowerCase().includes('2b10') && c.properties.notify);
               const tuyaWrite = service.characteristics.find(c => c.uuid.toLowerCase().includes('2b11') && (c.properties.write || c.properties.writeWithoutResponse));

               if (tuyaNotify) {
                  serviceUuid = service.uuid;
                  characteristicUuid = tuyaNotify.uuid;
                  writeUuid = tuyaWrite?.uuid || '';
                  console.log(`🎯 Identified Tuya Data Char: ${characteristicUuid}, Command Char: ${writeUuid}`);
                  break;
               }
            }

            const notifyChar = service.characteristics.find(c => c.properties.notify);
            if (notifyChar) {
              serviceUuid = service.uuid;
              characteristicUuid = notifyChar.uuid;
              break;
            }
          }
        }

        if (!serviceUuid || !characteristicUuid) {
           console.log('⚠️ Primary target not found, using generic notify discovery');
           for (const service of services) {
             const char = service.characteristics.find(c => c.properties.notify);
             if (char && !isGenericGattService(service.uuid)) {
               serviceUuid = service.uuid;
               characteristicUuid = char.uuid;
               break;
             }
           }
        }

        if (!serviceUuid || !characteristicUuid) {
          console.error('❌ Could not find any compatible scale service');
          await BleClient.disconnect(device.deviceId);
          setBleState('IDLE');
          throw new Error('Compatible service not found.');
        }

        // 3. ENABLE NOTIFICATIONS
        setBleState('NOTIFYING');
        console.log(`📡 [STEP 3/4] Starting notifications on ${characteristicUuid}...`);

        const handleWeightData = (value: DataView) => {
          const rawBytes = new Uint8Array(value.buffer);
          const hex = Array.from(rawBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
          console.log(`📊 BLE Notification [${characteristicUuid}]: ${hex}`);
          
          const text = new TextDecoder().decode(value);
          let parsed: number | null = null;
          if (isTuyaDevice || (device.name && device.name.includes('TY'))) {
             parsed = parseTuyaWeight(rawBytes, text);
          } else {
             parsed = parseDRSeriesWeight(rawBytes, text);
          }
          
          if (parsed === null) {
            const decimalMatch = text.match(/([+-]?)\s*(\d+\.\d+)/);
            if (decimalMatch) {
              const isNeg = decimalMatch[1] === '-';
              parsed = parseFloat(decimalMatch[2]);
              if (isNeg) parsed = -parsed;
            }
          }

          if (parsed !== null && !isNaN(parsed) && parsed >= -50 && parsed < 1000) {
            broadcastScaleWeightUpdate(parsed, scaleType);
            try { onWeightUpdate(parsed, scaleType); } catch {}
          }
        };

        try {
          await BleClient.startNotifications(device.deviceId, serviceUuid, characteristicUuid, handleWeightData);
          console.log('✅ Notifications enabled successfully');
        } catch (err) {
          console.error('❌ Failed to enable notifications:', err);
          if (isGattNotReadyError(err)) {
            console.log('🛑 Aborting: GATT stack not ready (status 201)');
          }
          await BleClient.disconnect(device.deviceId);
          setBleState('IDLE');
          throw err;
        }

        // 4. HANDSHAKE
        setBleState('HANDSHAKING');
        console.log('📤 [STEP 4/4] Sending handshake commands...');

        if (!writeUuid) {
           const targetService = services.find(s => s.uuid.toLowerCase() === serviceUuid.toLowerCase());
           const wChar = targetService?.characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);
           writeUuid = wChar?.uuid || '';
        }

        if (writeUuid) {
          const startCommands = [
            new Uint8Array([0x55]),
            new Uint8Array([0x01]),
            new Uint8Array([0x01, 0x01]),
            new Uint8Array([0x01, 0x03]),
            new Uint8Array([0x00, 0x01]),
            new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x01])
          ];
          for (const cmd of startCommands) {
            try {
              console.log(`📤 Writing command [${Array.from(cmd).map(b => b.toString(16)).join(' ')}] to ${writeUuid}`);
              await BleClient.write(device.deviceId, serviceUuid, writeUuid, new DataView(cmd.buffer), { timeout: 500 });
              await new Promise(r => setTimeout(r, 100));
            } catch (e) {
              if (isGattNotReadyError(e)) {
                console.error('🛑 Handshake failed: GATT not ready (status 201)');
                await BleClient.disconnect(device.deviceId);
                setBleState('IDLE');
                throw e;
              }
            }
          }
        }

        // FINISH
        scale = {
          device,
          deviceId: device.deviceId,
          serviceUuid,
          characteristic: characteristicUuid,
          type: scaleType,
          isConnected: true,
          connectionType: 'ble',
        };

        saveDeviceInfo(device.deviceId, device.name || 'Unknown Scale', scaleType, 'ble');
        broadcastScaleConnectionChange(true);
        setBleState('READY');
        console.log('🎉 Scale READY for use');
        return { success: true, type: scaleType };

      } else {
        // Web Bluetooth fallback
        const device = await (navigator as any).bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [0xffe0, 0xfee7],
        });

        const server = await device.gatt!.connect();
        let service;
        let scaleType: ScaleType = 'Unknown';

        try {
          service = await server.getPrimaryService(0xffe0);
          scaleType = 'HC-05';
        } catch {
          service = await server.getPrimaryService(0xfee7);
          scaleType = 'HM-10';
        }

        const characteristics = await service.getCharacteristics();
        const characteristic = characteristics[0];

        characteristic.addEventListener('characteristicvaluechanged', (event: Event) => {
          const target = event.target as any;
          const text = new TextDecoder().decode(target.value);
          const match = text.match(/([+-]?\d+\.\d+)/);
          if (match) {
            const parsed = parseFloat(match[1]);
            if (!isNaN(parsed) && parsed >= -50) {
              onWeightUpdate(parsed, scaleType);
            }
          }
        });
        await characteristic.startNotifications();

        device.addEventListener('gattserverdisconnected', () => {
          console.log('⚠️ Scale disconnected (Web Bluetooth)');
          clearScaleState();
        });

        scale = {
          device,
          deviceId: device.id,
          serviceUuid: null,
          characteristic,
          type: scaleType,
          isConnected: true,
          connectionType: 'ble',
        };

        broadcastScaleConnectionChange(true);
        setBleState('READY');
        return { success: true, type: scaleType };
      }
    } catch (err) {
      console.error('❌ Bluetooth connection error:', err);
      clearScaleState();
      setBleState('IDLE');
      return {
        success: false,
        type: 'Unknown',
        error: err instanceof Error ? err.message : 'Connection failed',
      };
    }
  });
};

export const disconnectBluetoothScale = async (clearSaved: boolean = false): Promise<void> => {
  try {
    if (scale.deviceId) {
      if (Capacitor.isNativePlatform()) {
        try {
          // Stop notifications first
          if (scale.serviceUuid && scale.characteristic) {
            await BleClient.stopNotifications(scale.deviceId, scale.serviceUuid, scale.characteristic);
          }
        } catch (e) {
          console.warn('Failed to stop scale notifications:', e);
        }
        
        try {
          await BleClient.disconnect(scale.deviceId);
        } catch (e) {
          console.warn('Failed to disconnect scale:', e);
        }
      } else if ('bluetooth' in navigator && scale.device?.gatt?.connected) {
        scale.device.gatt.disconnect();
      }
    }
    
    clearScaleState();
    
    if (clearSaved) {
      clearStoredDevice();
    }
  } catch (error) {
    console.error('Failed to disconnect from scale:', error);
    clearScaleState();
    throw error;
  }
};

export const quickReconnect = async (
  deviceId: string,
  onWeightUpdate: (weight: number, scaleType: ScaleType) => void,
  retries: number = 3
): Promise<{ success: boolean; type: ScaleType; error?: string }> => {
  return runBleOp('quickReconnect', async () => {
    // v2.10.99: If the persisted device is the BLE half of a dual-mode scale
    // (e.g. HC-04BLE), do NOT attempt to reconnect. Clear it so the retry
    // loop in btConnectionManager does not flood the log every 2-4 s.
    const storedInfoForBleCheck = getStoredDeviceInfo();
    if (storedInfoForBleCheck && isBleHalfOfDualModeScale(storedInfoForBleCheck.deviceName)) {
      console.warn(`🚫 [v2.10.99] Stored scale "${storedInfoForBleCheck.deviceName}" is the BLE half of a dual-mode scale — clearing and requiring Classic SPP pairing.`);
      clearStoredDevice();
      return { success: false, type: 'Unknown', error: 'BLE_HALF_BLOCKED' };
    }
    let lastError: any = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        setBleState('IDLE');
        if (Capacitor.isNativePlatform()) {
          await BleClient.initialize();

          console.log(`🔄 Quick reconnecting to scale: ${deviceId} (attempt ${attempt}/${retries})`);

          // v2.10.54: Only disconnect if this id matches our current scale slot.
          // Calling BleClient.disconnect on an unrelated id can reset the shared
          // Android GATT client and kill the printer connection.
          if (scale.deviceId === deviceId) {
            try {
              await BleClient.disconnect(deviceId);
              console.log('🔌 Disconnected stale scale connection');
            } catch {
              // Ignore — device may not be connected
            }
          } else {
            console.log(`ℹ️ Skipping stale-disconnect: ${deviceId} is not the active scale slot`);
          }

          await new Promise(resolve => setTimeout(resolve, 300 * attempt));

          setBleState('CONNECTING');
          await BleClient.connect(deviceId, (disconnectedDeviceId) => {
            if (disconnectedDeviceId === scale.deviceId) {
              console.log(`⚠️ Scale ${disconnectedDeviceId} disconnected unexpectedly`);
              clearScaleState();
              setBleState('IDLE');
            }
          });
          setBleState('CONNECTED');

          const storedInfo = getStoredDeviceInfo();
          if (!storedInfo) {
            setBleState('IDLE');
            return { success: false, type: 'Unknown', error: 'No stored device info' };
          }

          let serviceUuid = '';
          let characteristicUuid = '';
          let writeUuid = '';
          const scaleType = storedInfo.scaleType;

          setBleState('DISCOVERING');
          const services = await BleClient.getServices(deviceId);
          console.log(`📋 Scale has ${services.length} services`);

          // Log all discovered services for debugging (v2.10.101)
          console.log('📋 Discovered Characteristics (Reconnect):');
          for (const s of services) {
            console.log(`  S: ${s.uuid}`);
            for (const c of s.characteristics) {
              console.log(`    C: ${c.uuid} [N:${c.properties.notify}, I:${c.properties.indicate}, W:${c.properties.write}]`);
            }
          }

          const isTuyaDevice = storedInfo.deviceName.toUpperCase().includes('TY') ||
              services.some(s => s.uuid.toLowerCase().includes('1910') || s.uuid.toLowerCase().includes('a201'));

          const targetServiceUuid = scaleType === 'HC-05' ? SERVICE_UUID_HC05 : SERVICE_UUID_HM10;
          let service = services.find(s =>
            s.uuid.toLowerCase().includes(targetServiceUuid.toLowerCase()) ||
            (isTuyaDevice && (s.uuid.toLowerCase().includes('1910') || s.uuid.toLowerCase().includes('a201')))
          );

          if (!service) {
            for (const svc of services) {
              if (isGenericGattService(svc.uuid)) continue;
              const notifyChar = svc.characteristics.find(c => c.properties.notify);
              if (notifyChar) {
                service = svc;
                break;
              }
            }
          }

          if (!service || service.characteristics.length === 0) {
            throw new Error('Compatible scale service not found');
          }

          serviceUuid = service.uuid;

          // Identify Notify and Write
          if (isTuyaDevice) {
             const tuyaNotify = service.characteristics.find(c => c.uuid.toLowerCase().includes('2b10') && c.properties.notify);
             const tuyaWrite = service.characteristics.find(c => c.uuid.toLowerCase().includes('2b11') && (c.properties.write || c.properties.writeWithoutResponse));
             if (tuyaNotify) {
               characteristicUuid = tuyaNotify.uuid;
               writeUuid = tuyaWrite?.uuid || '';
             }
          }

          if (!characteristicUuid) {
             const n = service.characteristics.find(c => c.properties.notify);
             characteristicUuid = n?.uuid || '';
          }
          
          // Helper for weight parsing - mirrors main connection logic
          const handleReconnectWeight = (value: DataView) => {
            const rawBytes = new Uint8Array(value.buffer);
            const hex = Array.from(rawBytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
            console.log(`📊 BLE Reconnect Notification [${characteristicUuid}]: ${hex}`);

            const text = new TextDecoder().decode(value);
            let parsed: number | null = null;
            if (isTuyaDevice) {
               parsed = parseTuyaWeight(rawBytes, text);
            } else {
               parsed = parseDRSeriesWeight(rawBytes, text);
            }

            if (parsed === null) {
              const decimalMatch = text.match(/([+-]?)\s*(\d+\.\d+)/);
              if (decimalMatch) {
                const isNeg = decimalMatch[1] === '-';
                parsed = parseFloat(decimalMatch[2]);
                if (isNeg) parsed = -parsed;
              }
            }

            if (parsed !== null && !isNaN(parsed) && parsed >= -50 && parsed < 1000) {
              broadcastScaleWeightUpdate(parsed, scaleType);
              try { onWeightUpdate(parsed, scaleType); } catch (e) { /* Stale callback */ }
            }
          };

          // 3. ENABLE NOTIFICATIONS
          setBleState('NOTIFYING');
          console.log(`📡 [STEP 3/4] Reconnect: trying notifications on ${characteristicUuid}...`);
          try {
            await BleClient.startNotifications(deviceId, serviceUuid, characteristicUuid, handleReconnectWeight);
            console.log('✅ Reconnect notifications started');
          } catch (e) {
            if (isGattNotReadyError(e)) {
               console.error('🛑 Reconnect: GATT not ready (status 201)');
               await BleClient.disconnect(deviceId);
               setBleState('IDLE');
               throw e;
            }
            throw e;
          }

          // 4. HANDSHAKE
          setBleState('HANDSHAKING');
          if (!writeUuid) {
             const wChar = service.characteristics.find(c => c.properties.write || c.properties.writeWithoutResponse);
             writeUuid = wChar?.uuid || '';
          }

          if (writeUuid) {
            const startCommands = [
              new Uint8Array([0x55]),
              new Uint8Array([0x01]),
              new Uint8Array([0x01, 0x01]),
              new Uint8Array([0x01, 0x03]),
              new Uint8Array([0x00, 0x01]),
              new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x01])
            ];
            for (const cmd of startCommands) {
              try {
                console.log(`📤 Sending Reconnect Tuya start command [${Array.from(cmd).map(b => b.toString(16)).join(' ')}] to ${writeUuid}`);
                await BleClient.write(deviceId, serviceUuid, writeUuid, new DataView(cmd.buffer), { timeout: 300 });
              } catch (e) {
                if (isGattNotReadyError(e)) {
                   console.error('🛑 Reconnect handshake failed: status 201');
                   await BleClient.disconnect(deviceId);
                   setBleState('IDLE');
                   throw e;
                }
              }
            }
          }

          scale = {
            device: { deviceId } as BleDevice,
            deviceId,
            serviceUuid,
            characteristic: characteristicUuid,
            type: scaleType,
            isConnected: true,
            connectionType: 'ble',
          };

          broadcastScaleConnectionChange(true);
          setBleState('READY');
          console.log('✅ Reconnected to scale successfully');
          return { success: true, type: scaleType };
        } else {
           return { success: false, type: 'Unknown', error: 'Bluetooth not available on this device' };
        }
      } catch (error: any) {
        console.error(`❌ Scale reconnect attempt ${attempt} failed:`, error.message);
        lastError = error;
        setBleState('IDLE');
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 800 * attempt));
        }
      }
    }

    clearScaleState();
    console.error('❌ All scale reconnect attempts failed');
    return { success: false, type: 'Unknown', error: lastError?.message || 'Failed to reconnect after multiple attempts' };
  });
};

// Check if scale is currently connected (BLE or Classic SPP)
export const isScaleConnected = (): boolean => {
  // Check BLE connection first
  const bleConnected = scale.isConnected && scale.deviceId !== null;
  // Also check Classic SPP connection
  const classicConnected = isClassicScaleConnected();
  return bleConnected || classicConnected;
};

// Get current scale info
export const getCurrentScaleInfo = (): { deviceId: string; type: ScaleType } | null => {
  if (!scale.deviceId || !scale.isConnected) return null;
  return {
    deviceId: scale.deviceId,
    type: scale.type
  };
};

// Common printer service UUIDs
const COMMON_PRINTER_SERVICES = [
  numberToUUID(0x18f0),
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '38eb4a80-c570-11e3-9507-0002a5d5c51b',
];

const GENERIC_GATT_SERVICES = ['1800', '1801', '180a'];

const isGenericGattService = (uuid: string) =>
  GENERIC_GATT_SERVICES.some((g) => uuid.toLowerCase().includes(g));

const selectPrinterWriteCharacteristic = (
  services: Array<{ uuid: string; characteristics: Array<{ uuid: string; properties: any }> }>
): { serviceUuid: string; charUuid: string; writeWithoutResponse: boolean } | null => {
  const pickFromService = (service: any) => {
    const chars = service.characteristics || [];

    // Prefer writeWithoutResponse for many thermal printers
    const wnr = chars.find((c: any) => c.properties?.writeWithoutResponse);
    if (wnr) return { serviceUuid: service.uuid, charUuid: wnr.uuid, writeWithoutResponse: true };

    const w = chars.find((c: any) => c.properties?.write);
    if (w) return { serviceUuid: service.uuid, charUuid: w.uuid, writeWithoutResponse: false };

    return null;
  };

  // 1) Prefer known printer services (in the order listed)
  for (const preferred of COMMON_PRINTER_SERVICES.map((s) => s.toLowerCase())) {
    const svc = services.find((s: any) => s.uuid?.toLowerCase() === preferred);
    if (!svc) continue;
    const picked = pickFromService(svc);
    if (picked) return picked;
  }

  // 2) Fallback: any non-generic service with a writable characteristic
  for (const svc of services) {
    if (!svc?.uuid || isGenericGattService(svc.uuid)) continue;
    const picked = pickFromService(svc as any);
    if (picked) return picked;
  }

  return null;
};

export interface DiscoveredPrinter {
  deviceId: string;
  name: string;
  rssi?: number;
}

export const scanForPrinters = async (scanDuration: number = 3000): Promise<{
  success: boolean;
  printers: DiscoveredPrinter[];
  error?: string;
}> => {
  return runBleOp('scanForPrinters', async () => {
    const discoveredPrinters: DiscoveredPrinter[] = [];

    // v2.10.54: Pause scale notifications during the LE scan to avoid GATT
    // resource contention that can supervision-timeout the scale link.
    let pausedScaleNotifications = false;
    const scaleSnapshot = {
      deviceId: scale.deviceId,
      serviceUuid: scale.serviceUuid,
      characteristic: scale.characteristic,
      connectionType: scale.connectionType,
    };
    if (
      Capacitor.isNativePlatform() &&
      scale.isConnected &&
      scaleSnapshot.connectionType === 'ble' &&
      scaleSnapshot.deviceId &&
      scaleSnapshot.serviceUuid &&
      typeof scaleSnapshot.characteristic === 'string'
    ) {
      try {
        await BleClient.stopNotifications(
          scaleSnapshot.deviceId,
          scaleSnapshot.serviceUuid,
          scaleSnapshot.characteristic as string
        );
        pausedScaleNotifications = true;
        console.log('⏸️ Paused scale notifications during printer scan');
      } catch (e) {
        console.warn('Could not pause scale notifications before scan (continuing):', e);
      }
    }

    try {
      if (Capacitor.isNativePlatform()) {
        await BleClient.initialize();

        console.log('🔍 Scanning for Bluetooth printers...');

        await BleClient.requestLEScan(
          { allowDuplicates: false },
          (result) => {
            const deviceName = result.device.name || '';
            const isPrinter = deviceName.toLowerCase().includes('print') ||
                             deviceName.toLowerCase().includes('pos') ||
                             deviceName.toLowerCase().includes('thermal') ||
                             deviceName.toLowerCase().includes('receipt') ||
                             deviceName.length > 0;

            if (isPrinter && !discoveredPrinters.find(p => p.deviceId === result.device.deviceId)) {
              console.log(`📱 Found device: ${deviceName || 'Unknown'}`);
              discoveredPrinters.push({
                deviceId: result.device.deviceId,
                name: deviceName || `Unknown Device (${result.device.deviceId.slice(-6)})`,
                rssi: result.rssi,
              });
            }
          }
        );

        await new Promise(resolve => setTimeout(resolve, scanDuration));
        await BleClient.stopLEScan();

        console.log(`✅ Scan complete. Found ${discoveredPrinters.length} devices.`);
        return { success: true, printers: discoveredPrinters };
      } else {
        return {
          success: false,
          printers: [],
          error: 'Printer scanning requires native app.'
        };
      }
    } catch (error: any) {
      console.error('❌ Printer scan failed:', error);
      try { await BleClient.stopLEScan(); } catch {}
      return { success: false, printers: discoveredPrinters, error: error.message || 'Scan failed' };
    } finally {
      // Resume scale notifications if we paused them
      if (pausedScaleNotifications && scaleSnapshot.deviceId && scaleSnapshot.serviceUuid && typeof scaleSnapshot.characteristic === 'string') {
        try {
          await BleClient.startNotifications(
            scaleSnapshot.deviceId,
            scaleSnapshot.serviceUuid,
            scaleSnapshot.characteristic as string,
            () => { /* re-attached by main scale handler via existing wiring */ }
          );
          console.log('▶️ Resumed scale notifications after printer scan');
        } catch (e) {
          console.warn('Could not resume scale notifications after scan:', e);
        }
      }
    }
  });
};

export const connectToSpecificPrinter = async (deviceId: string, deviceName: string): Promise<{
  success: boolean;
  deviceName?: string;
  error?: string;
}> => {
  try {
    // Disconnect existing printer first
    if (printer.isConnected && printer.deviceId) {
      try {
        await disconnectBluetoothPrinter(false);
      } catch (e) {
        console.warn('Failed to disconnect existing printer:', e);
      }
    }

    if (Capacitor.isNativePlatform()) {
      await BleClient.initialize();
      
      console.log(`🔗 Connecting to printer: ${deviceName} (${deviceId})`);
      
      await BleClient.connect(deviceId, (disconnectedDeviceId) => {
        if (disconnectedDeviceId !== printer.deviceId) {
          console.log(`ℹ️ Ignoring disconnect for ${disconnectedDeviceId} — not our active printer (${printer.deviceId})`);
          return;
        }
        console.log(`⚠️ Printer ${disconnectedDeviceId} disconnected unexpectedly`);
        clearPrinterState();
      });
      console.log('✅ Connected to printer');

      const services = await BleClient.getServices(deviceId);

      const selected = selectPrinterWriteCharacteristic(services as any);

      printer = {
        device: { deviceId } as BleDevice,
        deviceId,
        characteristic: selected,
        isConnected: true,
      };
      savePrinterInfo(deviceId, deviceName);
      broadcastPrinterConnectionChange(true);

      return { success: true, deviceName };
    } else {
      return { success: false, error: 'Native platform required for direct connection' };
    }
  } catch (error: any) {
    console.error('❌ Failed to connect to printer:', error);
    clearPrinterState();
    return { success: false, error: error.message || 'Connection failed' };
  }
};

export const connectBluetoothPrinter = async (): Promise<{ 
  success: boolean; 
  deviceName?: string;
  error?: string 
}> => {
  try {
    // Disconnect existing printer first
    if (printer.isConnected && printer.deviceId) {
      try {
        await disconnectBluetoothPrinter(false);
      } catch (e) {
        console.warn('Failed to disconnect existing printer:', e);
      }
    }

    if (Capacitor.isNativePlatform()) {
      await BleClient.initialize();

      console.log('🔍 Scanning for Bluetooth printers...');
      
      const device = await BleClient.requestDevice({
        optionalServices: COMMON_PRINTER_SERVICES,
      });

      console.log(`📱 Printer selected: ${device.name || 'Unknown'} (ID: ${device.deviceId})`);
      
      await BleClient.connect(device.deviceId, (disconnectedDeviceId) => {
        if (disconnectedDeviceId !== printer.deviceId) {
          console.log(`ℹ️ Ignoring disconnect for ${disconnectedDeviceId} — not our active printer (${printer.deviceId})`);
          return;
        }
        console.log(`⚠️ Printer ${disconnectedDeviceId} disconnected unexpectedly`);
        clearPrinterState();
      });
      console.log('✅ Connected to printer');

      const services = await BleClient.getServices(device.deviceId);

      const selected = selectPrinterWriteCharacteristic(services as any);

      printer = {
        device,
        deviceId: device.deviceId,
        characteristic: selected,
        isConnected: true,
      };
      savePrinterInfo(device.deviceId, device.name || 'Bluetooth Printer');
      broadcastPrinterConnectionChange(true);

      return { success: true, deviceName: device.name || 'Bluetooth Printer' };
    } else if ('bluetooth' in navigator) {
      console.log('🔍 Scanning for Bluetooth printers (Web Bluetooth)...');
      
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: COMMON_PRINTER_SERVICES,
      });

      const server = await device.gatt!.connect();
      console.log('✅ Connected to printer via Web Bluetooth');
      
      device.addEventListener('gattserverdisconnected', () => {
        console.log('⚠️ Printer disconnected (Web Bluetooth)');
        clearPrinterState();
      });

      printer = { 
        device, 
        deviceId: device.id,
        characteristic: null,
        isConnected: true,
      };
      savePrinterInfo(device.id, device.name || 'Bluetooth Printer');
      broadcastPrinterConnectionChange(true);

      return { success: true, deviceName: device.name || 'Bluetooth Printer' };
    } else {
      return { success: false, error: 'Bluetooth not available' };
    }
  } catch (error: any) {
    console.error('Failed to connect to printer:', error);
    clearPrinterState();
    return { success: false, error: error.message || 'Failed to connect' };
  }
};

export const quickReconnectPrinter = async (deviceId: string, retries: number = 3): Promise<{ 
  success: boolean; 
  error?: string 
}> => {
  let lastError: any = null;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (Capacitor.isNativePlatform()) {
        await BleClient.initialize();
        console.log(`🔄 Quick reconnecting to printer: ${deviceId} (attempt ${attempt}/${retries})`);
        
        // v2.10.54: Only disconnect if this id matches our current printer slot
        if (printer.deviceId === deviceId) {
          try {
            await BleClient.disconnect(deviceId);
            console.log('🔌 Disconnected stale printer connection');
          } catch {
            // Ignore
          }
        } else {
          console.log(`ℹ️ Skipping stale-disconnect: ${deviceId} is not the active printer slot`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
        
        await BleClient.connect(deviceId, (disconnectedDeviceId) => {
          if (disconnectedDeviceId !== printer.deviceId) {
            console.log(`ℹ️ Ignoring disconnect for ${disconnectedDeviceId} — not our active printer`);
            return;
          }
          console.log(`⚠️ Printer ${disconnectedDeviceId} disconnected unexpectedly`);
          clearPrinterState();
        });
        
        const services = await BleClient.getServices(deviceId);

        const selected = selectPrinterWriteCharacteristic(services as any);

        printer = {
          device: { deviceId } as BleDevice,
          deviceId,
          characteristic: selected,
          isConnected: true,
        };

        broadcastPrinterConnectionChange(true);
        console.log('✅ Reconnected to printer successfully');
        return { success: true };
      } else if ('bluetooth' in navigator) {
        const device = await (navigator as any).bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: COMMON_PRINTER_SERVICES,
        });

        const server = await device.gatt.connect();
        
        device.addEventListener('gattserverdisconnected', () => {
          console.log('⚠️ Printer disconnected (Web Bluetooth)');
          clearPrinterState();
        });

        printer = { 
          device, 
          deviceId: device.id,
          characteristic: null,
          isConnected: true,
        };
        
        broadcastPrinterConnectionChange(true);
        return { success: true };
      } else {
        return { success: false, error: 'Bluetooth not available on this device' };
      }
    } catch (error: any) {
      console.error(`❌ Reconnect attempt ${attempt} failed:`, error.message);
      lastError = error;
      
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 800 * attempt));
      }
    }
  }
  
  clearPrinterState();
  console.error('❌ All reconnect attempts failed');
  return { success: false, error: lastError?.message || 'Failed to reconnect after multiple attempts' };
};

// Check if printer is currently connected (BLE or Classic SPP)
export const isPrinterConnected = (): boolean => {
  // Check BLE connection first
  const bleConnected = printer.isConnected && printer.deviceId !== null;
  // Also check Classic SPP connection
  const classicConnected = isClassicPrinterConnected();
  return bleConnected || classicConnected;
};

// Get current printer info
export const getCurrentPrinterInfo = (): { deviceId: string; hasWriteChar: boolean } | null => {
  if (!printer.deviceId || !printer.isConnected) return null;
  return {
    deviceId: printer.deviceId,
    hasWriteChar: printer.characteristic !== null
  };
};

export const disconnectBluetoothPrinter = async (clearSaved: boolean = false): Promise<void> => {
  try {
    if (printer.deviceId) {
      if (Capacitor.isNativePlatform()) {
        try {
          await BleClient.disconnect(printer.deviceId);
        } catch (e) {
          console.warn('Failed to disconnect printer:', e);
        }
      } else if ('bluetooth' in navigator && printer.device?.gatt?.connected) {
        printer.device.gatt.disconnect();
      }
    }
    
    clearPrinterState();
    
    if (clearSaved) {
      clearStoredPrinter();
    }
  } catch (error) {
    console.error('Failed to disconnect from printer:', error);
    clearPrinterState();
    throw error;
  }
};

// ESC/POS Commands for thermal printers
const ESC = 0x1B;
const GS = 0x1D;

const COMMANDS = {
  INIT: [ESC, 0x40],
  LINE_FEED: [0x0A],
  CUT_PAPER: [GS, 0x56, 0x00],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
};

const stringToBytes = (str: string): number[] => {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
  }
  return bytes;
};

export const printToBluetoothPrinter = async (content: string): Promise<{ success: boolean; error?: string }> => {
  try {
    // Check for Classic printer first - if connected, delegate to Classic printer
    if (isClassicPrinterConnected()) {
      console.log('🖨️ Using Classic Bluetooth printer...');
      return await printToClassicPrinter(content);
    }

    if (Capacitor.isNativePlatform() && !printer.isConnected && await isInternalPrinterAvailable()) {
      console.log('🖨️ Using CS10 internal printer bridge...');
      return await printToInternalPrinter(content);
    }
    
    // Check BLE printer connection
    if (!printer.isConnected || !printer.deviceId) {
      return { success: false, error: 'No printer connected' };
    }

    // Verify BLE connection before printing (skip aggressive verification)
    // Only verify if we have time - don't clear state on timeout
    try {
      if (Capacitor.isNativePlatform()) {
        const timeoutPromise = new Promise<boolean>((resolve) => 
          setTimeout(() => resolve(true), 2000) // Return true on timeout - assume still connected
        );
        const verifyPromise = BleClient.getServices(printer.deviceId).then(() => true).catch(() => false);
        const stillConnected = await Promise.race([verifyPromise, timeoutPromise]);
        if (!stillConnected) {
          console.warn('⚠️ Printer verification failed, but attempting print anyway');
        }
      }
    } catch (e) {
      console.warn('⚠️ Printer verification error:', e);
      // Don't fail - try to print anyway
    }

    console.log('🖨️ Starting print job...');

    const printData: number[] = [
      ...COMMANDS.INIT,
      ...COMMANDS.ALIGN_LEFT,
      ...stringToBytes(content),
      ...COMMANDS.LINE_FEED,
      ...COMMANDS.LINE_FEED,
      ...COMMANDS.LINE_FEED,
      ...COMMANDS.LINE_FEED,
      ...COMMANDS.LINE_FEED,
      ...COMMANDS.CUT_PAPER,
    ];

    const dataView = new Uint8Array(printData);
    console.log(`📄 Print data size: ${dataView.length} bytes`);

    if (Capacitor.isNativePlatform()) {
      let serviceUuid: string | null = null;
      let writeCharUuid: string | null = null;
      let preferWriteWithoutResponse = false;

      if (printer.characteristic) {
        serviceUuid = printer.characteristic.serviceUuid;
        writeCharUuid = printer.characteristic.charUuid;
        preferWriteWithoutResponse = printer.characteristic.writeWithoutResponse;
      }

      if (!serviceUuid || !writeCharUuid) {
        console.log('🔍 Discovering printer services...');
        const services = await BleClient.getServices(printer.deviceId);
        const selected = selectPrinterWriteCharacteristic(services as any);
        if (selected) {
          serviceUuid = selected.serviceUuid;
          writeCharUuid = selected.charUuid;
          preferWriteWithoutResponse = selected.writeWithoutResponse;
          // cache for next print
          printer = { ...printer, characteristic: selected };
        }
      }

      if (!serviceUuid || !writeCharUuid) {
        return { success: false, error: 'No writable characteristic found. Printer may not be compatible.' };
      }

      // Many 58mm printers have tiny BLE buffers; 20 bytes is the safest default.
      const chunkSize = preferWriteWithoutResponse ? 20 : 60;
      const delayMs = preferWriteWithoutResponse ? 30 : 15;

      console.log(`📤 Sending ${Math.ceil(dataView.length / chunkSize)} chunks (chunkSize=${chunkSize})...`);

      for (let i = 0; i < dataView.length; i += chunkSize) {
        const chunk = dataView.slice(i, Math.min(i + chunkSize, dataView.length));
        const dataViewChunk = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

        try {
          if (preferWriteWithoutResponse) {
            await BleClient.writeWithoutResponse(printer.deviceId, serviceUuid, writeCharUuid, dataViewChunk);
          } else {
            await BleClient.write(printer.deviceId, serviceUuid, writeCharUuid, dataViewChunk);
          }
        } catch (writeError) {
          // Fallback: try the other mode
          try {
            await BleClient.writeWithoutResponse(printer.deviceId, serviceUuid, writeCharUuid, dataViewChunk);
          } catch {
            await BleClient.write(printer.deviceId, serviceUuid, writeCharUuid, dataViewChunk);
          }
        }

        if (i + chunkSize < dataView.length) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }

      console.log('✅ Print job completed successfully');
      return { success: true };
    } else if ('bluetooth' in navigator && printer.device?.gatt?.connected) {
      let writeChar: any = null;
      
      for (const serviceUuid of COMMON_PRINTER_SERVICES) {
        try {
          const service = await printer.device.gatt.getPrimaryService(serviceUuid);
          const characteristics = await service.getCharacteristics();
          
          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              writeChar = char;
              break;
            }
          }
          if (writeChar) break;
        } catch {
          continue;
        }
      }

      if (!writeChar) {
        return { success: false, error: 'No writable characteristic found' };
      }

      const chunkSize = 100;
      for (let i = 0; i < dataView.length; i += chunkSize) {
        const chunk = dataView.slice(i, Math.min(i + chunkSize, dataView.length));
        await writeChar.writeValue(chunk);
        if (i + chunkSize < dataView.length) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      console.log('✅ Print job completed successfully');
      return { success: true };
    } else {
      return { success: false, error: 'Printer not connected or Bluetooth not available' };
    }
  } catch (error: any) {
    console.error('❌ Print failed:', error);
    // v2.10.65: Don't blindly mark the printer disconnected on a single failed
    // write — verify first. A transient BLE buffer hiccup must not drop the
    // user back to the "Select Printer" screen mid-receipt.
    try {
      const stillConnected = await verifyPrinterConnection();
      if (stillConnected) {
        console.warn('⚠️ Print failed but printer is still connected — preserving state');
      } else {
        clearPrinterState();
      }
    } catch {
      // If verify itself throws, err on the side of preserving state — the
      // next print attempt will reveal a true disconnect anyway.
      console.warn('⚠️ verifyPrinterConnection threw — preserving printer state');
    }
    return { success: false, error: error.message || 'Failed to print' };
  }
};

// Helper to center text within a given width
const centerText = (text: string, width: number): string => {
  if (text.length >= width) return text.substring(0, width);
  const padding = width - text.length;
  const left = Math.floor(padding / 2);
  const right = padding - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
};

// Helper to format label:value with proper alignment
const formatLine = (label: string, value: string, width: number): string => {
  const maxValueLen = width - label.length - 1;
  const truncatedValue = value.length > maxValueLen ? value.substring(0, maxValueLen) : value;
  return label + truncatedValue.padStart(width - label.length);
};

export const printReceipt = async (data: {
  companyName?: string;
  farmerName: string;
  farmerId: string;
  route?: string;
  routeLabel?: string;
  session?: string;
  periodLabel?: string;
  productName?: string;
  uploadRefNo?: string;
  collectorName: string;
  collections: Array<{
    index: number;
    weight: number;
    transrefno?: string;
  }>;
  cumulativeFrequency?: number;
  cumulativeByProduct?: Array<{ icode: string; product_name: string; weight: number }>;
  locationCode?: string;
  locationName?: string;
  collectionDate?: Date;
  deliveredBy?: string;
  reprintedAt?: Date;
  receiptTitle?: string;
  totalLabel?: string;
}): Promise<{ success: boolean; error?: string }> => {
  const companyName = data.companyName || 'DAIRY COLLECTION';
  const totalWeight = data.collections.reduce((sum, col) => sum + col.weight, 0);
  
  const dateObj = data.collectionDate || new Date();
  const formattedDate = dateObj.toLocaleDateString('en-CA');
  // Use 24-hour format for time (no AM/PM)
  const formattedTime = dateObj.toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // 58mm thermal paper = 32 characters per line
  const W = 32;
  const sep = '-'.repeat(W);

  // Build collections text
  let collectionsText = '';
  data.collections.forEach((col) => {
    const prefix = `${col.index}: ${col.transrefno || '-'}`;
    const weight = (Math.floor(col.weight * 10) / 10).toFixed(1);
    const spaces = W - prefix.length - weight.length;
    collectionsText += prefix + ' '.repeat(Math.max(1, spaces)) + weight + '\n';
  });

  let receipt = '';
  
  receipt += centerText(companyName, W) + '\n';
  receipt += centerText(data.receiptTitle || 'CUSTOMER DELIVERY RECEIPT', W) + '\n';
  receipt += sep + '\n';
  
  receipt += formatLine('MNO       ', '#' + data.farmerId, W) + '\n';
  receipt += formatLine('Name      ', data.farmerName, W) + '\n';
  receipt += formatLine('Ref       ', data.uploadRefNo || '', W) + '\n';
  receipt += formatLine('Date      ', formattedDate + ' ' + formattedTime, W) + '\n';
  
  // Product name (for milk/coffee types)
  if (data.productName) {
    receipt += formatLine('Product   ', data.productName, W) + '\n';
  }
  receipt += sep + '\n';
  
  receipt += collectionsText;
  receipt += sep + '\n';
  
  const totalStr = (Math.floor(totalWeight * 10) / 10).toFixed(1);
  const totalLabel = data.totalLabel ? (data.totalLabel.length > 20 ? data.totalLabel.substring(0, 20) : data.totalLabel.padEnd(20)) : 'Total Kgs ';
  receipt += formatLine(totalLabel, totalStr, W) + '\n';
  
  if (data.cumulativeFrequency !== undefined) {
    receipt += formatLine('Cumulative', (Math.floor(data.cumulativeFrequency * 10) / 10).toFixed(1), W) + '\n';
    // Per-product breakdown
    if (data.cumulativeByProduct && data.cumulativeByProduct.length > 1) {
      for (const prod of data.cumulativeByProduct) {
        const label = (prod.product_name || prod.icode).substring(0, 18);
        receipt += formatLine(`  ${label}`, (Math.floor(prod.weight * 10) / 10).toFixed(1), W) + '\n';
      }
    }
  }
  receipt += sep + '\n';
  
  // Merge location code + name into single line
  if (data.locationCode || data.locationName) {
    const locValue = data.locationCode && data.locationName
      ? `${data.locationCode} - ${data.locationName}`
      : (data.locationCode || data.locationName || '');
    receipt += formatLine('Loc       ', locValue, W) + '\n';
  }
  receipt += formatLine('Route     ', data.route || '', W) + '\n';
  receipt += formatLine('Clerk     ', data.collectorName, W) + '\n';
  if (data.deliveredBy && data.deliveredBy !== 'owner') {
    receipt += formatLine('Delivered ', data.deliveredBy, W) + '\n';
  }
  
  // Use periodLabel (Session/Season) with the session value
  const periodLabel = data.periodLabel || 'Session';
  receipt += formatLine((periodLabel.length <= 10 ? periodLabel.padEnd(10) : periodLabel), data.session || '', W) + '\n';
  receipt += sep + '\n';

  // Add reprint timestamp if this is a reprint
  if (data.reprintedAt) {
    const rpDate = data.reprintedAt.toLocaleDateString('en-CA');
    const rpTime = data.reprintedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    receipt += formatLine('Reprinted on', rpDate + ' ' + rpTime, W) + '\n';
    receipt += sep + '\n';
  }

  // Try Classic Bluetooth printer first (for built-in POS printers)
  if (isClassicPrinterConnected()) {
    console.log('🖨️ Using Classic Bluetooth printer');
    return printToClassicPrinter(receipt);
  }
  
  // Fall back to BLE printer
  return printToBluetoothPrinter(receipt);
};

// Store/AI Receipt Item interface for reprinting
interface StoreAIReceiptItem {
  item_code: string;
  item_name: string;
  quantity: number;
  price: number;
  lineTotal: number;
  cowDetails?: {
    cowName?: string;
    cowBreed?: string;
    numberOfCalves?: number | string;
    bullCode?: string;
    bullName?: string;
    nextHeat?: string;
  };
}

// Print Store/AI receipt with full item details
export const printStoreAIReceipt = async (data: {
  companyName?: string;
  memberName: string;
  memberId: string;
  memberRoute?: string;
  uploadRefNo?: string;
  clerkName: string;
  deliveredBy?: string;
  items: StoreAIReceiptItem[];
  totalAmount: number;
  transactionDate?: Date;
  receiptType: 'store' | 'ai';
  reprintedAt?: Date;
}): Promise<{ success: boolean; error?: string }> => {
  const companyName = data.companyName || 'DAIRY COLLECTION';
  
  const dateObj = data.transactionDate || new Date();
  const formattedDate = dateObj.toLocaleDateString('en-CA');
  // Use 24-hour format for time (no AM/PM)
  const formattedTime = dateObj.toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  // 58mm thermal paper = 32 characters per line
  const W = 32;
  const sep = '-'.repeat(W);

  // Build items text
  let itemsText = '';
  data.items.forEach((item, index) => {
    // Truncate item name to fit
    const displayName = item.item_name.length > 16 
      ? item.item_name.substring(0, 14) + '..' 
      : item.item_name;
    const qty = `x${(Math.floor(Number(item.quantity || 0) * 10) / 10).toFixed(1)}`;
    const amount = `${item.lineTotal.toFixed(0)}`;
    
    // Format: "ItemName x2    500"
    const leftPart = `${displayName} ${qty}`;
    const spaces = W - leftPart.length - amount.length;
    itemsText += leftPart + ' '.repeat(Math.max(1, spaces)) + amount + '\n';
    
    // For AI receipts, add cow details if present
    if (data.receiptType === 'ai' && item.cowDetails) {
      const cd = item.cowDetails;
      if (cd.cowName) {
        itemsText += `  Cow: ${cd.cowName.substring(0, W - 7)}\n`;
      }
      if (cd.cowBreed) {
        itemsText += `  Breed: ${cd.cowBreed.substring(0, W - 9)}\n`;
      }
      if (cd.numberOfCalves) {
        itemsText += `  Calves: ${cd.numberOfCalves}\n`;
      }
      if (cd.bullCode) {
        itemsText += `  Bull Code: ${cd.bullCode}\n`;
      }
      if (cd.bullName) {
        itemsText += `  Bull Name: ${cd.bullName.substring(0, W - 13)}\n`;
      }
      if (cd.nextHeat) {
        itemsText += `  Next Heat: ${cd.nextHeat}\n`;
      }
    }
  });

  const receiptTitle = data.receiptType === 'store' 
    ? 'STORE PURCHASE RECEIPT' 
    : 'AI SERVICE RECEIPT';

  let receipt = '';
  
  receipt += centerText(companyName, W) + '\n';
  receipt += centerText(receiptTitle, W) + '\n';
  receipt += formatLine('MNO       ', '#' + data.memberId, W) + '\n';
  receipt += formatLine('Name      ', data.memberName, W) + '\n';
  receipt += formatLine('Ref       ', data.uploadRefNo || '', W) + '\n';
  receipt += formatLine('Date      ', formattedDate + ' ' + formattedTime, W) + '\n';
  receipt += sep + '\n';
  receipt += itemsText;
  receipt += sep + '\n';
  const totalStr = data.totalAmount.toFixed(0);
  receipt += formatLine('Total[KES]', totalStr, W) + '\n';
  if (data.memberRoute) {
    receipt += formatLine('Region    ', data.memberRoute, W) + '\n';
  }
  receipt += formatLine('Clerk     ', data.clerkName, W) + '\n';
  if (data.deliveredBy && data.deliveredBy !== 'owner') {
    receipt += formatLine('Del.By    ', data.deliveredBy, W) + '\n';
  }
  // v2.10.81: Force ID NO / SIGN labels flush-left (column 0). Pad each label
  // line to the full printer width so prior right-aligned values cannot bleed
  // and visually center the label. Underscore lines and spacing unchanged.
  const writeLine = '_'.repeat(W);
  receipt += 'ID NO:'.padEnd(W) + '\n';
  receipt += writeLine + '\n';
  receipt += '\n';
  receipt += 'SIGN:'.padEnd(W) + '\n';
  receipt += writeLine + '\n';

  // Add reprint timestamp if this is a reprint
  if (data.reprintedAt) {
    const rpDate = data.reprintedAt.toLocaleDateString('en-CA');
    const rpTime = data.reprintedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    receipt += formatLine('Reprinted on', rpDate + ' ' + rpTime, W) + '\n';
  }

  // Try Classic Bluetooth printer first (for built-in POS printers)
  if (isClassicPrinterConnected()) {
    console.log('[PRINT] Using Classic Bluetooth printer for Store/AI receipt');
    return printToClassicPrinter(receipt);
  }
  
  // Fall back to BLE printer
  return printToBluetoothPrinter(receipt);
};

// Print Device Z Report to thermal printer
// Follows layout: Company → Summary → Season → Date → Center → Produce → Transactions (MNO/REFNO/QTY/TIME) → Total → Clerk → Print Time → Device Code
// Supports grouping by produce type and center with dotted separators
export const printZReport = async (data: {
  companyName: string;
  produceLabel: string;
  periodLabel: string;
  seasonName: string;
  date: string;
  factoryName: string; // Main center name (used for single-center reports)
  routeLabel?: string; // Dynamic "Center" or "Route" label
  produceName?: string;
  transactions: Array<{
    farmer_id: string;
    refno: string;
    weight: number;
    time: string;
    route?: string; // Route code for grouping
    route_name?: string; // Full center descriptive name
    product_code?: string;
    product_name?: string;
    transtype?: number; // 1=Buy, 2=Sell/Store, 3=AI
    transTypeLabel?: string; // "BUY", "SELL", "AI"
    session?: string; // Session code for period filtering
    price?: number;  // Unit price (Store/AI)
    amount?: number; // Total amount (Store/AI)
  }>;
  totalWeight: number;
  totalAmount?: number; // v2.10.73: total monetary value across SELL/AI groups
  clerkName: string;
  deviceCode: string;
  isCoffee?: boolean;
  activeRouteCode?: string; // v2.12.21: prioritize this store in the print order
  periodFilter?: string; // Display label for selected period (e.g., "Morning Z", "All Z")
  milkSessionId?: string; // Explicit 10-digit Milk Session ID if selected
  // v2.10.98: 'store' renders a stock-only Z report — no SUMMARY/SEASON/PRODUCE
  // metadata, item names left-aligned full-width, items+KSh totals only.
  reportType?: 'produce' | 'store';
}): Promise<{ success: boolean; error?: string }> => {
  // 58mm thermal paper = 32 characters per line
  const W = 32;
  const sep = '-'.repeat(W);

  // Helper to determine if a transaction represents produce (weight in KGS) vs store merchandise
  const isProduceTx = (tx: { product_code?: string; milk_session_id?: string; transtype?: number }) => {
    const code = (tx.product_code || '').trim().toUpperCase();
    const milkId = String((tx as any).milk_session_id || '').trim();
    return code === 'S0001' || tx.transtype === 1 || milkId.length === 10 || (tx.transtype === 2 && data.isCoffee);
  };

  // Format date as DD/MM/YYYY
  const formattedDate = new Date(data.date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  // Format print time as DD/MM/YYYY - HH:MM (24-hour format, no AM/PM)
  const now = new Date();
  const printDate = now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const printTime = now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const weightUnit = 'KGS';
  const routeLabel = data.routeLabel || (data.isCoffee ? 'CENTER' : 'ROUTE');

  // Hierarchical grouping: Store (Route) -> Transaction Type
  interface TypeGroup {
    transtype: number;
    typeLabel: string;
    transactions: typeof data.transactions;
    totalWeight: number;
    totalAmount: number;
  }

  interface StoreGroup {
    route: string;
    routeName: string;
    typeGroups: Map<number, TypeGroup>;
  }

  const storeGroupsMap = new Map<string, StoreGroup>();

  for (const tx of data.transactions) {
    const route = tx.route || 'OTHER';
    const routeName = tx.route_name || route;
    const transtype = tx.transtype || 1;
    const typeLabel = tx.transTypeLabel || (transtype === 2 ? 'SELL' : transtype === 3 ? 'AI' : 'BUY');

    if (!storeGroupsMap.has(route)) {
      storeGroupsMap.set(route, { route, routeName, typeGroups: new Map() });
    }
    const sg = storeGroupsMap.get(route)!;

    if (!sg.typeGroups.has(transtype)) {
      sg.typeGroups.set(transtype, { transtype, typeLabel, transactions: [], totalWeight: 0, totalAmount: 0 });
    }
    const tg = sg.typeGroups.get(transtype)!;
    tg.transactions.push(tx);
    tg.totalWeight += tx.weight;
    tg.totalAmount += Number(tx.amount || 0);
  }

  // Convert to array and sort stores
  const storeGroups = Array.from(storeGroupsMap.values()).sort((a, b) => {
    // v2.12.21: Prioritize active route to match on-screen Z report order
    if (data.activeRouteCode) {
      if (a.route === data.activeRouteCode) return -1;
      if (b.route === data.activeRouteCode) return 1;
    }
    return a.routeName.localeCompare(b.routeName);
  });

  // Helper: build a left/right justified line within W chars
  const lr = (left: string, right: string): string => {
    const space = Math.max(1, W - left.length - right.length);
    return left + ' '.repeat(space) + right;
  };

  const isStore = data.reportType === 'store';
  let receipt = '';

  // Header — Company Name (centered, intentional)
  receipt += centerText(data.companyName, W) + '\n';
  if (isStore) {
    receipt += centerText('STORE Z REPORT', W) + '\n';
  } else {
    receipt += centerText('Z REPORT', W) + '\n';
  }
  receipt += sep + '\n';

  // Metadata block — store mode emits only DATE + CENTER, no produce fields.
  const milkSessionId = data.milkSessionId && String(data.milkSessionId).trim().length === 10 ? data.milkSessionId : null;
  if (!isStore) {
    receipt += `* ${data.produceLabel.toUpperCase()} SUMMARY\n`;
    receipt += `* ${data.periodLabel.toUpperCase()}: ${data.seasonName}\n`;
    if (milkSessionId) {
      receipt += `* SESSION ID: ${milkSessionId}\n`;
    }
  }
  receipt += `* DATE: ${formattedDate}\n`;

  // v2.12.21: If exactly one store group exists, show its name in the header.
  // This ensures the "Center: MOUNTKENYA" line appears even if the caller
  // didn't explicitly resolve a single factoryName.
  const displayFactoryName = storeGroups.length === 1
    ? storeGroups[0].routeName
    : (data.factoryName || '');

  if (storeGroups.length === 1 && displayFactoryName) {
    receipt += `* ${routeLabel}: ${displayFactoryName.trim()}\n`;
  }

  if (!isStore && data.produceName) {
    receipt += `* PRODUCE: ${data.produceName}\n`;
  }
  receipt += sep + '\n';

  // Column width helpers
  const padL = (s: string, w: number) => (s ?? '').padEnd(w).substring(0, w);
  const padR = (s: string, w: number) => (s ?? '').padStart(w).substring(0, w);

  // Store sections
  storeGroups.forEach((sg, sIdx) => {
    if (sIdx > 0) {
      receipt += '\n' + '-'.repeat(W) + '\n'; // Separate stores with a divider
    }

    // Store Name Header (Inverted-style or just bold/centered)
    receipt += centerText(`== ${sg.routeName.toUpperCase()} ==`, W) + '\n';
    receipt += '\n';

    // Sort types within store (BUY first, then SELL, AI)
    const sortedTypeGroups = Array.from(sg.typeGroups.values()).sort((a, b) => a.transtype - b.transtype);

    sortedTypeGroups.forEach((typeGroup, tIdx) => {
      if (tIdx > 0) receipt += '\n';

      const transtype = typeGroup.transtype;
      const showMoney = transtype !== 1;

      receipt += `== ${typeGroup.typeLabel} ==\n`;

      if (showMoney) {
        receipt += `${padL('MNO',7)} ${padL('REF',5)} ${padR('QTY',4)} ${padR('KSh',7)} ${padR('TIME',5)}\n`;
      } else {
        receipt += `${padL('MNO',9)} ${padL('REF',6)} ${padR('AMOUNT',8)} ${padR('TIME',6)}\n`;
      }
      receipt += '-'.repeat(W) + '\n';

      const sortedTxs = [...typeGroup.transactions].sort((a, b) =>
        (a.product_code || '').localeCompare(b.product_code || '')
      );

      const distinctProducts = new Set(sortedTxs.map(t => t.product_code || '')).size;
      const showProductDividers = distinctProducts > 1;

      let prevProductCode: string | undefined;
      let sellAiItemCount = 0;

      for (const tx of sortedTxs) {
        const currentProduct = tx.product_code || '';
        if (showProductDividers && prevProductCode !== currentProduct) {
          const produceName = (tx.product_name || tx.product_code || 'OTHER').trim();
          if (isStore) {
            receipt += produceName + '\n';
          } else {
            receipt += centerText(`-- ${produceName} --`, W) + '\n';
          }
        }
        prevProductCode = currentProduct;

        const shortRef = (tx.refno || '').slice(-6);
        const time = tx.time.substring(0, 5);

        if (showMoney) {
          const rawQty = Number(tx.weight || 0);
          const qtyStr = (Math.floor(rawQty * 10) / 10).toFixed(1);
          sellAiItemCount += rawQty; // Accumulate raw value for accurate total
          const mno = padL(tx.farmer_id || '', 7);
          const ref = padL(shortRef, 6);
          const qty = padR(qtyStr, 4);
          const ksh = padR(Number(tx.amount || 0).toFixed(0), 7);
          const tim = padR(time, 5);
          receipt += `${mno} ${ref} ${qty} ${ksh} ${tim}\n`;
        } else {
          const mno = padL(tx.farmer_id || '', 9);
          const ref = padL(shortRef, 6);
          const qty = padR((Math.floor(tx.weight * 10) / 10).toFixed(1), 8);
          const tim = padR(time, 6);
          receipt += `${mno} ${ref} ${qty} ${tim}\n`;
        }
      }

      const isProduceGroup = !isStore && (transtype === 1 || typeGroup.transactions.every(t => isProduceTx(t)));
      if (showMoney) {
        const qtyStr = (Math.floor(sellAiItemCount * 10) / 10).toFixed(1);
        const unitLabel = isProduceGroup ? weightUnit : (sellAiItemCount === 1 ? 'item' : 'items');
        const right = `${qtyStr} ${unitLabel}  KSh ${typeGroup.totalAmount.toFixed(0)}`;
        receipt += lr(`${typeGroup.typeLabel} TOTAL`, right) + '\n';
      } else {
        receipt += lr(`${typeGroup.typeLabel} TOTAL`, `${(Math.floor(typeGroup.totalWeight * 10) / 10).toFixed(1)} ${weightUnit}`) + '\n';
      }
    });
  });

  receipt += '\n';
  receipt += sep + '\n';

  // Grand totals — split by what each transtype represents:
  //   TOTAL BUY <kg> KGS          → BUY produce (weight)
  //   TOTAL SELL PRODUCE <kg> KGS  → SELL produce (weight)
  //   TOTAL STORE ITEMS <n> items  → Store merchandise
  //   TOTAL VALUE KSh n            → Monetary amount
  let buyWeight = 0;
  let sellProduceWeight = 0;
  let storeItemsCount = 0;
  let sellAiAmount = 0;

  for (const tx of data.transactions) {
    const tt = tx.transtype || 1;
    if (tt === 1) {
      buyWeight += tx.weight;
    } else {
      sellAiAmount += Number(tx.amount || 0);
      if (isProduceTx(tx)) {
        sellProduceWeight += tx.weight;
      } else {
        storeItemsCount += Math.max(0, Math.round(tx.weight || 0));
      }
    }
  }

  if (!isStore && buyWeight > 0) {
    receipt += lr('TOTAL BUY', `${(Math.floor(buyWeight * 10) / 10).toFixed(1)} ${weightUnit}`) + '\n';
  }
  if (!isStore && sellProduceWeight > 0) {
    receipt += lr('TOTAL SELL PRODUCE', `${(Math.floor(sellProduceWeight * 10) / 10).toFixed(1)} ${weightUnit}`) + '\n';
  }
  if (storeItemsCount > 0) {
    const qtyStr = (Math.floor(storeItemsCount * 10) / 10).toFixed(1);
    const itemsLabel = storeItemsCount === 1 ? 'item' : 'items';
    receipt += lr('TOTAL STORE ITEMS', `${qtyStr} ${itemsLabel}`) + '\n';
  }
  if (sellAiAmount > 0) {
    receipt += lr('TOTAL VALUE', `KSh ${sellAiAmount.toFixed(0)}`) + '\n';
  }
  receipt += sep + '\n';

  // Footer
  receipt += lr('CLERK', data.clerkName.toUpperCase()) + '\n';
  receipt += lr(printDate, printTime) + '\n';
  receipt += lr('DEV', data.deviceCode) + '\n';
  receipt += '\n\n'; // Feed paper

  console.log('[ZREPORT] Sending Z Report to printer...');
  console.log('[ZREPORT] Data:', {
    transactions: data.transactions.length,
    total: data.totalWeight,
    totalAmount: sellAiAmount,
    totalItems: sellAiItems,
    device: data.deviceCode,
    typeGroups: Array.from(foundTypes)
  });

  // Try Classic Bluetooth printer first
  if (isClassicPrinterConnected()) {
    console.log('[ZREPORT] Using Classic Bluetooth printer');
    return printToClassicPrinter(receipt);
  }

  // Fall back to BLE printer
  return printToBluetoothPrinter(receipt);
};

// Member Produce Statement print function (for Periodic Report)
// v2.10.55: added optional centerName, top paper feed, wider date column,
//           and produceName whitespace trim for symmetric centering.
export const printMemberProduceStatement = async (data: {
  companyName: string;
  farmerId: string;
  farmerName: string;
  produceName: string;      // e.g., "CHERRY", "MILK"
  startDate: string;        // YYYY-MM-DD
  endDate: string;          // YYYY-MM-DD
  gender?: string;          // v2.12.51: for group report logic
  transactions: Array<{
    date: string;           // YYYY-MM-DD
    rec_no: string;         // Reference number (last 5 chars)
    quantity: number;       // Weight in Kgs
    // v2.10.77: optional product grouping
    icode?: string;
    productName?: string;
    deliveredby?: string;   // v2.12.51: for group report logic
  }>;
  totalWeight: number;
  centerName?: string;      // v2.10.55: route/center descript shown under company header
  allFarmers?: Farmer[];    // v2.12.51: for deliverer name resolution
}): Promise<{ success: boolean; error?: string }> => {
  // 58mm thermal paper = 32 characters per line
  const W = 32;
  const dotLine = '.'.repeat(W);
  const dashLine = '-'.repeat(W);
  
  const formatDate = (dateStr: string) => {
    // v2.12.7: accepts 'YYYY-MM-DD' or a full ISO timestamp; the ISO time part
    // must never reach printed output.
    const ymd = String(dateStr || '').trim().split('T')[0].split(' ')[0];
    const [year, month, day] = ymd.split('-');
    if (!year || !month || !day) return ymd;
    return `${day}/${month}/${year}`;
  };
  
  const now = new Date();
  const printedOn = now.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  let receipt = '';

  // v2.10.79: Use ESC/POS native alignment so the header is centered relative
  // to the printer's actual paper width (not our 32-col space padding) and
  // tighten inter-section spacing.
  const ESC_CENTER = String.fromCharCode(0x1B, 0x61, 0x01);
  const ESC_LEFT = String.fromCharCode(0x1B, 0x61, 0x00);

  // Top paper feed so the company name doesn't print on the tear edge
  receipt += '\n\n';

  // Company Header — printer-centered
  receipt += ESC_CENTER;
  receipt += data.companyName.toUpperCase().trim() + '\n';

  const centerNameClean = (data.centerName || '').trim();
  if (centerNameClean) {
    receipt += `CENTER: ${centerNameClean.toUpperCase()}\n`;
  }
  receipt += ESC_LEFT;
  receipt += dashLine + '\n';

  // Title — also printer-centered
  receipt += ESC_CENTER;
  receipt += 'MEMBER PRODUCE STATEMENT\n';
  receipt += `From ${formatDate(data.startDate)} - To ${formatDate(data.endDate)}\n`;
  receipt += ESC_LEFT;
  receipt += dashLine + '\n';

  // Member Info — compact: single dotted separator after the pair
  receipt += `MEMBER NO: ${data.farmerId}\n`;
  receipt += `MEMBER NAME: ${data.farmerName.substring(0, W - 13)}\n`;
  receipt += dotLine + '\n';

  // v2.12.51: Group Number Report Logic (Printer) - Case-insensitive check
  if (data.gender?.toLowerCase() === 'group') {
    receipt += centerText('DELIVERY BREAKDOWN BY DATE', W) + '\n';
    receipt += dashLine + '\n';

    // v2.12.58: Detailed breakdown showing REC NO, Deliverer name, and Quantity
    const recColW = 12; // XXXX-XXXXXX
    const qtyColW = 6;  // 123.4
    const nameColW = W - recColW - qtyColW - 1; // 13 chars

    const formatRecNo = (ref?: string) => {
      if (!ref || ref.length < 9) return '------------';
      return `${ref.slice(0, 4)}-${ref.slice(-6)}`;
    };

    // Group by date
    const dateGroups = new Map<string, typeof data.transactions>();
    data.transactions.forEach(tx => {
      const dateKey = formatDate(tx.date);
      if (!dateGroups.has(dateKey)) dateGroups.set(dateKey, []);
      dateGroups.get(dateKey)!.push(tx);
    });

    for (const [date, transactions] of dateGroups.entries()) {
      receipt += `[${date}]\n`;
      // Column Header per date group
      receipt += 'REC NO'.padEnd(recColW) + ' ' + 'DELIVERER'.padEnd(nameColW) + 'QTY'.padStart(qtyColW) + '\n';

      for (const tx of transactions) {
        const rec = formatRecNo(tx.rec_no);
        const resolved = resolveMemberName(tx.deliveredby || 'owner', data.allFarmers || []);
        // Extract just the ID part if it's "ID - Name" to show Member No
        const idOnly = resolved.includes(' - ') ? resolved.split(' - ')[0] : resolved;
        const qty = (Math.floor((Number(tx.quantity) || 0) * 10) / 10).toFixed(1);

        receipt += rec.padEnd(recColW) + ' ' + idOnly.substring(0, nameColW).padEnd(nameColW) + qty.padStart(qtyColW) + '\n';
      }
    }

    receipt += dotLine + '\n';
    receipt += centerText('DELIVERER SUMMARY (PERIOD)', W) + '\n';
    receipt += dashLine + '\n';

    const totals = new Map<string, number>();
    data.transactions.forEach(tx => {
      const key = tx.deliveredby || 'owner';
      totals.set(key, (totals.get(key) || 0) + (Number(tx.quantity) || 0));
    });

    const sortedTotals = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    for (const [deliverer, total] of sortedTotals) {
      const resolved = resolveMemberName(deliverer, data.allFarmers || []);
      receipt += formatLine(resolved.substring(0, 20), (Math.floor(total * 10) / 10).toFixed(1), W) + '\n';
    }
  } else {
    // v2.10.77: Group transactions by icode so each product gets its own
    // labeled section and subtotal. Falls back to a single section using
    // the legacy produceName when no per-row icode is present.
    // v2.10.82: REC NO now shows DEVCODE-LAST5 (e.g. BB01-00002) instead of just last 5.
    // Widen REC NO column from 7 → 11; date stays 11 (DD/MM/YYYY + space); QUANTITY = 10.
    const dateColW = 11;
    const recColW = 12;
    const qtyColW = W - dateColW - recColW;
    const formatRecNo = (ref?: string) => {
      if (!ref || ref.length < 9) return '------------';
      return `${ref.slice(0, 4)}-${ref.slice(-6)}`;
    };

    type Group = { label: string; rows: typeof data.transactions; subtotal: number };
    const groups = new Map<string, Group>();
    for (const tx of data.transactions) {
      const key = (tx.icode || data.produceName || 'PRODUCE').toString().trim().toUpperCase() || 'PRODUCE';
      const label = (tx.productName || tx.icode || data.produceName || 'PRODUCE').toString().trim().toUpperCase();
      if (!groups.has(key)) groups.set(key, { label, rows: [], subtotal: 0 });
      const g = groups.get(key)!;
      g.rows.push(tx);
      g.subtotal += Number(tx.quantity) || 0;
    }
    const groupArr = Array.from(groups.entries());
    const showCode = groupArr.length > 1;

    if (groupArr.length === 0) {
      // No transactions — keep the original layout for empty case
      const produceLabel = `${data.produceName.toUpperCase().trim()} RECORD`;
      receipt += centerText(produceLabel, W) + '\n';
      receipt += dashLine + '\n';
    } else {
      groupArr.forEach(([icode, g], idx) => {
        if (idx > 0) receipt += dotLine + '\n';
        const codeSuffix = showCode && icode !== g.label ? ` (${icode})` : '';
        const sectionLabel = `${g.label}${codeSuffix} RECORD`;
        receipt += centerText(sectionLabel, W) + '\n';
        receipt += 'DATE'.padEnd(dateColW) + 'REC NO'.padEnd(recColW) + 'QUANTITY'.padStart(qtyColW) + '\n';
        receipt += dotLine + '\n';
        g.rows.forEach(tx => {
          const dateStr = formatDate(tx.date);
          const refNo = formatRecNo(tx.rec_no);
          const qty = (Math.floor((Number(tx.quantity) || 0) * 10) / 10).toFixed(1);
          receipt += dateStr.padEnd(dateColW) + refNo.padEnd(recColW) + qty.padStart(qtyColW) + '\n';
        });
        receipt += dotLine + '\n';
        const subLabel = 'SUBTOTAL:';
        const subVal = `${(Math.floor(g.subtotal * 10) / 10).toFixed(1)} Kgs`;
        receipt += subLabel + subVal.padStart(W - subLabel.length) + '\n';
      });
    }
  }

  receipt += dashLine + '\n';

  // Total
  const totalLabel = 'TOTAL:';
  const totalVal = `${(Math.floor(data.totalWeight * 10) / 10).toFixed(1)} Kgs`;
  receipt += totalLabel + totalVal.padStart(W - totalLabel.length) + '\n';
  receipt += dashLine + '\n';
  
  // Footer
  receipt += `Report printed on ${printedOn}\n`;
  receipt += '\n\n\n';

  // Try Classic Bluetooth printer first
  if (isClassicPrinterConnected()) {
    console.log('[PERIODIC] Using Classic Bluetooth printer');
    return printToClassicPrinter(receipt);
  }
  
  // Fall back to BLE printer
  return printToBluetoothPrinter(receipt);
};
