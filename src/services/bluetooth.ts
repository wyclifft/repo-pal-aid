import { BleClient, BleDevice, numberToUUID } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { logConnectionTips } from '@/utils/bluetoothDiagnostics';

export type ScaleType = 'HC-05' | 'HM-10' | 'Unknown';

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
}

let scale: BluetoothScale = {
  device: null,
  deviceId: null,
  serviceUuid: null,
  characteristic: null,
  type: 'Unknown',
  isConnected: false,
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

// Store device info for quick reconnect
interface StoredDeviceInfo {
  deviceId: string;
  deviceName: string;
  scaleType: ScaleType;
  timestamp: number;
}

const STORAGE_KEY = 'lastConnectedScale';
const PRINTER_STORAGE_KEY = 'lastConnectedPrinter';

interface StoredPrinterInfo {
  deviceId: string;
  deviceName: string;
  timestamp: number;
}

// Debounce mechanism for BLE verification to prevent Android Bluetooth stack issues
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

const saveDeviceInfo = (deviceId: string, deviceName: string, scaleType: ScaleType) => {
  const info: StoredDeviceInfo = {
    deviceId,
    deviceName,
    scaleType,
    timestamp: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
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

// Expanded list of known scale service UUIDs for broader compatibility
// Including T-Scale DR, ACS, and other common digital scale modules
const GENERIC_SCALE_SERVICES = [
  // Standard HC-05 / HM-10 modules
  numberToUUID(0xffe0),
  numberToUUID(0xfee7),
  // Generic Access / Device Info (for discovery)
  numberToUUID(0x1800),
  numberToUUID(0x180a),
  // Common scale services
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000fff1-0000-1000-8000-00805f9b34fb',
  '0000fff2-0000-1000-8000-00805f9b34fb',
  '0000fff3-0000-1000-8000-00805f9b34fb',
  '0000fff4-0000-1000-8000-00805f9b34fb',
  // ISSC/Microchip Transparent UART
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  // Nordic UART Service (NUS) - used by many BLE scales
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  // T-Scale / DR Series common services
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
  '0000ffe2-0000-1000-8000-00805f9b34fb',
  '0000ffe5-0000-1000-8000-00805f9b34fb',
  // Weight Scale Service (official Bluetooth SIG)
  numberToUUID(0x181d),
  // Xiaomi / Huami scales
  '00001530-0000-3512-2118-0009af100700',
  // Generic SPP-like services
  '00001101-0000-1000-8000-00805f9b34fb',
];

// Clear scale state and broadcast disconnection
const clearScaleState = () => {
  scale = {
    device: null,
    deviceId: null,
    serviceUuid: null,
    characteristic: null,
    type: 'Unknown',
    isConnected: false,
  };
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
  console.log(`📡 Broadcasting scale connection: ${connected}`);
  window.dispatchEvent(new CustomEvent('scaleConnectionChange', { detail: { connected } }));
};

export const broadcastPrinterConnectionChange = (connected: boolean) => {
  console.log(`📡 Broadcasting printer connection: ${connected}`);
  window.dispatchEvent(new CustomEvent('printerConnectionChange', { detail: { connected } }));
};

// Verify if scale is actually connected by checking BLE state
// Uses debouncing to prevent Android Bluetooth stack issues from frequent calls
export const verifyScaleConnection = async (): Promise<boolean> => {
  if (!scale.deviceId || !scale.isConnected) {
    return false;
  }
  
  // Skip verification if called too frequently (return cached state)
  if (!canVerifyConnection()) {
    return scale.isConnected;
  }
  
  if (Capacitor.isNativePlatform()) {
    try {
      // Try to get services - this will fail if disconnected
      // Use a timeout to prevent hanging on some Android devices
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('BLE verification timeout')), 3000)
      );
      await Promise.race([BleClient.getServices(scale.deviceId), timeoutPromise]);
      return true;
    } catch (error) {
      console.warn('⚠️ Scale connection verification failed:', error);
      clearScaleState();
      return false;
    }
  }
  
  // For web, check gatt connection
  if (scale.device?.gatt?.connected) {
    return true;
  }
  
  clearScaleState();
  return false;
};

// Verify if printer is actually connected
// Uses debouncing to prevent Android Bluetooth stack issues from frequent calls
export const verifyPrinterConnection = async (): Promise<boolean> => {
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
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('BLE verification timeout')), 3000)
      );
      await Promise.race([BleClient.getServices(printer.deviceId), timeoutPromise]);
      return true;
    } catch (error) {
      console.warn('⚠️ Printer connection verification failed:', error);
      clearPrinterState();
      return false;
    }
  }
  
  if (printer.device?.gatt?.connected) {
    return true;
  }
  
  clearPrinterState();
  return false;
};

export const connectBluetoothScale = async (
  onWeightUpdate: (weight: number, scaleType: ScaleType) => void
): Promise<{ success: boolean; type: ScaleType; error?: string }> => {
  try {
    // Disconnect existing connection first
    if (scale.isConnected && scale.deviceId) {
      try {
        await disconnectBluetoothScale(false);
      } catch (e) {
        console.warn('Failed to disconnect existing scale:', e);
      }
    }

    if (Capacitor.isNativePlatform()) {
      await BleClient.initialize();
      
      console.log('🔍 Requesting Bluetooth scale device...');

      const device = await BleClient.requestDevice({
        optionalServices: GENERIC_SCALE_SERVICES,
      });

      console.log(`📱 Device selected: ${device.name || 'Unknown'} (ID: ${device.deviceId})`);
      
      // Connect with disconnect callback
      await BleClient.connect(device.deviceId, (disconnectedDeviceId) => {
        console.log(`⚠️ Scale ${disconnectedDeviceId} disconnected unexpectedly`);
        clearScaleState();
      });
      console.log('✅ Connected to device');

      let scaleType: ScaleType = 'Unknown';
      let serviceUuid = '';
      let characteristicUuid = '';

      const services = await BleClient.getServices(device.deviceId);
      console.log(`📋 Found ${services.length} services`);

      // Try HC-05 first
      const hc05Service = services.find(s => 
        s.uuid.toLowerCase().includes(SERVICE_UUID_HC05.toLowerCase()) ||
        s.uuid.toLowerCase().includes('ffe0')
      );
      if (hc05Service && hc05Service.characteristics.length > 0) {
        const notifyChar = hc05Service.characteristics.find(c => c.properties.notify);
        if (notifyChar) {
          serviceUuid = hc05Service.uuid;
          characteristicUuid = notifyChar.uuid;
          scaleType = 'HC-05';
          console.log('✅ Detected HC-05 scale');
        }
      }

      // Try HM-10 if HC-05 not found
      if (!serviceUuid) {
        const hm10Service = services.find(s => 
          s.uuid.toLowerCase().includes(SERVICE_UUID_HM10.toLowerCase()) ||
          s.uuid.toLowerCase().includes('fee7')
        );
        if (hm10Service && hm10Service.characteristics.length > 0) {
          const notifyChar = hm10Service.characteristics.find(c => c.properties.notify);
          if (notifyChar) {
            serviceUuid = hm10Service.uuid;
            characteristicUuid = notifyChar.uuid;
            scaleType = 'HM-10';
            console.log('✅ Detected HM-10 scale');
          }
        }
      }

      // Try generic discovery
      if (!serviceUuid) {
        console.log('⚠️ Standard services not found, trying generic discovery...');
        for (const service of services) {
          if (service.uuid.toLowerCase().includes('1800') || 
              service.uuid.toLowerCase().includes('1801') ||
              service.uuid.toLowerCase().includes('180a')) {
            continue;
          }
          
          const notifyChar = service.characteristics.find((c: any) => c.properties.notify);
          if (notifyChar) {
            serviceUuid = service.uuid;
            characteristicUuid = notifyChar.uuid;
            scaleType = 'Unknown';
            console.log(`✅ Found generic scale service: ${service.uuid}`);
            break;
          }
        }
      }

      // Also try finding a characteristic with indicate if notify not found
      if (!serviceUuid) {
        console.log('⚠️ No notify characteristic, trying indicate...');
        for (const service of services) {
          if (service.uuid.toLowerCase().includes('1800') || 
              service.uuid.toLowerCase().includes('1801') ||
              service.uuid.toLowerCase().includes('180a')) {
            continue;
          }
          
          const indicateChar = service.characteristics.find((c: any) => c.properties.indicate);
          if (indicateChar) {
            serviceUuid = service.uuid;
            characteristicUuid = indicateChar.uuid;
            scaleType = 'Unknown';
            console.log(`✅ Found scale service with indicate: ${service.uuid}`);
            break;
          }
        }
      }

      if (!serviceUuid || !characteristicUuid) {
        // Log all discovered services for debugging
        console.log('📋 All discovered services for debugging:');
        for (const service of services) {
          console.log(`  Service: ${service.uuid}`);
          for (const char of service.characteristics) {
            console.log(`    Char: ${char.uuid} - notify:${char.properties.notify}, indicate:${char.properties.indicate}, read:${char.properties.read}, write:${char.properties.write}`);
          }
        }
        console.error('❌ Could not find any compatible scale service');
        await BleClient.disconnect(device.deviceId);
        throw new Error('Could not find compatible Bluetooth scale service. Check console for discovered services.');
      }

      console.log(`📡 Starting notifications on ${serviceUuid}/${characteristicUuid}`);

      await BleClient.startNotifications(
        device.deviceId,
        serviceUuid,
        characteristicUuid,
        (value) => {
          const rawBytes = new Uint8Array(value.buffer);
          const text = new TextDecoder().decode(value);
          console.log(`📊 Raw scale data: "${text}" (${rawBytes.length} bytes) [${Array.from(rawBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`);
          
          let parsed: number | null = null;
          
          // Strategy 1: Standard decimal format "12.34" or "12.34 kg"
          const decimalMatch = text.match(/(\d+\.\d+)/);
          if (decimalMatch) {
            parsed = parseFloat(decimalMatch[1]);
          }
          
          // Strategy 2: Integer format (grams) - convert to kg
          if (!parsed || isNaN(parsed)) {
            const intMatch = text.match(/(\d+)/);
            if (intMatch) {
              const intValue = parseInt(intMatch[1]);
              // If value > 100, assume grams and convert to kg
              parsed = intValue > 100 ? intValue / 1000 : intValue;
            }
          }
          
          // Strategy 3: T-Scale DR format - may send binary with weight in specific bytes
          if (!parsed || isNaN(parsed)) {
            if (rawBytes.length >= 6) {
              // Some scales send weight as 2-byte integer at offset 4-5 (big endian)
              const weightInt = (rawBytes[4] << 8) | rawBytes[5];
              if (weightInt > 0 && weightInt < 50000) {
                parsed = weightInt / 100; // Assume centgrams
                console.log(`📊 Parsed from binary format: ${parsed} kg`);
              }
            }
          }
          
          // Strategy 4: Try parsing from hex representation (some Chinese scales)
          if (!parsed || isNaN(parsed)) {
            const hexWeight = text.replace(/[^0-9A-Fa-f]/g, '');
            if (hexWeight.length >= 4) {
              const hexValue = parseInt(hexWeight.slice(0, 4), 16);
              if (hexValue > 0 && hexValue < 50000) {
                parsed = hexValue / 100;
                console.log(`📊 Parsed from hex format: ${parsed} kg`);
              }
            }
          }
          
          if (parsed && !isNaN(parsed) && parsed > 0 && parsed < 1000) {
            console.log(`✅ Parsed weight: ${parsed} kg`);
            onWeightUpdate(parsed, scaleType);
          }
        }
      );

      // Update scale state
      scale = { 
        device, 
        deviceId: device.deviceId,
        serviceUuid,
        characteristic: characteristicUuid, 
        type: scaleType,
        isConnected: true,
      };
      
      saveDeviceInfo(device.deviceId, device.name || 'Unknown Scale', scaleType);
      broadcastScaleConnectionChange(true);
      
      console.log('✅ Scale connection successful');
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
        const match = text.match(/(\d+\.\d+)/);
        if (match) {
          const parsed = parseFloat(match[1]);
          if (!isNaN(parsed)) {
            onWeightUpdate(parsed, scaleType);
          }
        }
      });
      await characteristic.startNotifications();

      // Handle disconnect for web
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
      };
      
      broadcastScaleConnectionChange(true);
      return { success: true, type: scaleType };
    }
  } catch (err) {
    console.error('❌ Bluetooth connection error:', err);
    clearScaleState();
    return {
      success: false,
      type: 'Unknown',
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
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
  let lastError: any = null;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (Capacitor.isNativePlatform()) {
        await BleClient.initialize();
        
        console.log(`🔄 Quick reconnecting to scale: ${deviceId} (attempt ${attempt}/${retries})`);
        
        // Disconnect any stale connection
        try {
          await BleClient.disconnect(deviceId);
          console.log('🔌 Disconnected stale scale connection');
        } catch {
          // Ignore - device may not be connected
        }
        
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
        
        await BleClient.connect(deviceId, (disconnectedDeviceId) => {
          console.log(`⚠️ Scale ${disconnectedDeviceId} disconnected unexpectedly`);
          clearScaleState();
        });
        
        const storedInfo = getStoredDeviceInfo();
        if (!storedInfo) {
          return { success: false, type: 'Unknown', error: 'No stored device info' };
        }

        let serviceUuid = '';
        let characteristicUuid = '';
        const scaleType = storedInfo.scaleType;

        const services = await BleClient.getServices(deviceId);
        console.log(`📋 Scale has ${services.length} services`);
        
        const targetServiceUuid = scaleType === 'HC-05' ? SERVICE_UUID_HC05 : SERVICE_UUID_HM10;
        let service = services.find(s => s.uuid.toLowerCase().includes(targetServiceUuid.toLowerCase()));
        
        if (!service) {
          for (const svc of services) {
            if (svc.uuid.toLowerCase().includes('1800') || 
                svc.uuid.toLowerCase().includes('1801') ||
                svc.uuid.toLowerCase().includes('180a')) {
              continue;
            }
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
        const notifyChar = service.characteristics.find(c => c.properties.notify);
        characteristicUuid = notifyChar?.uuid || service.characteristics[0].uuid;

        await BleClient.startNotifications(
          deviceId,
          serviceUuid,
          characteristicUuid,
          (value) => {
            const text = new TextDecoder().decode(value);
            let parsed: number | null = null;
            
            const decimalMatch = text.match(/(\d+\.\d+)/);
            if (decimalMatch) {
              parsed = parseFloat(decimalMatch[1]);
            }
            
            if (!parsed || isNaN(parsed)) {
              const intMatch = text.match(/(\d+)/);
              if (intMatch) {
                const intValue = parseInt(intMatch[1]);
                parsed = intValue > 1000 ? intValue / 1000 : intValue;
              }
            }
            
            if (parsed && !isNaN(parsed) && parsed > 0) {
              onWeightUpdate(parsed, scaleType);
            }
          }
        );

        scale = { 
          device: { deviceId } as BleDevice, 
          deviceId,
          serviceUuid,
          characteristic: characteristicUuid, 
          type: scaleType,
          isConnected: true,
        };
        
        broadcastScaleConnectionChange(true);
        console.log('✅ Reconnected to scale successfully');
        return { success: true, type: scaleType };
      } else if ('bluetooth' in navigator) {
        const storedInfo = getStoredDeviceInfo();
        if (!storedInfo) {
          return { success: false, type: 'Unknown', error: 'No stored device info' };
        }

        const scaleType = storedInfo.scaleType;
        const serviceUuid = scaleType === 'HC-05' ? SERVICE_UUID_HC05 : SERVICE_UUID_HM10;

        const device = await (navigator as any).bluetooth.requestDevice({
          filters: [{ services: [serviceUuid] }],
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(serviceUuid);
        const characteristics = await service.getCharacteristics();
        const notifyCharacteristic = characteristics.find((c: any) => c.properties.notify);
        
        if (!notifyCharacteristic) {
          return { success: false, type: 'Unknown', error: 'No notify characteristic found' };
        }

        await notifyCharacteristic.startNotifications();
        notifyCharacteristic.addEventListener('characteristicvaluechanged', (event: any) => {
          const value = event.target.value;
          const text = new TextDecoder().decode(value);
          const match = text.match(/(\d+\.\d+)/);
          if (match) {
            const parsed = parseFloat(match[1]);
            if (!isNaN(parsed)) {
              onWeightUpdate(parsed, scaleType);
            }
          }
        });

        device.addEventListener('gattserverdisconnected', () => {
          console.log('⚠️ Scale disconnected (Web Bluetooth)');
          clearScaleState();
        });

        scale = { 
          device, 
          deviceId: device.id,
          serviceUuid: null,
          characteristic: notifyCharacteristic.uuid, 
          type: scaleType,
          isConnected: true,
        };
        
        broadcastScaleConnectionChange(true);
        return { success: true, type: scaleType };
      } else {
        return { success: false, type: 'Unknown', error: 'Bluetooth not available on this device' };
      }
    } catch (error: any) {
      console.error(`❌ Scale reconnect attempt ${attempt} failed:`, error.message);
      lastError = error;
      
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 800 * attempt));
      }
    }
  }
  
  clearScaleState();
  console.error('❌ All scale reconnect attempts failed');
  return { success: false, type: 'Unknown', error: lastError?.message || 'Failed to reconnect after multiple attempts' };
};

// Check if scale is currently connected
export const isScaleConnected = (): boolean => {
  return scale.isConnected && scale.deviceId !== null;
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

export const scanForPrinters = async (scanDuration: number = 5000): Promise<{
  success: boolean;
  printers: DiscoveredPrinter[];
  error?: string;
}> => {
  const discoveredPrinters: DiscoveredPrinter[] = [];
  
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
  }
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

      const server = await device.gatt.connect();
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
        
        // Disconnect stale connection
        try {
          await BleClient.disconnect(deviceId);
          console.log('🔌 Disconnected stale connection');
        } catch {
          // Ignore
        }
        
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
        
        await BleClient.connect(deviceId, (disconnectedDeviceId) => {
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

// Check if printer is currently connected
export const isPrinterConnected = (): boolean => {
  return printer.isConnected && printer.deviceId !== null;
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
    if (!printer.isConnected || !printer.deviceId) {
      return { success: false, error: 'No printer connected' };
    }

    // Verify connection before printing
    const isConnected = await verifyPrinterConnection();
    if (!isConnected) {
      return { success: false, error: 'Printer connection lost. Please reconnect.' };
    }

    console.log('🖨️ Starting print job...');

    const printData: number[] = [
      ...COMMANDS.INIT,
      ...COMMANDS.ALIGN_CENTER,
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
    // Mark printer as disconnected on error
    clearPrinterState();
    return { success: false, error: error.message || 'Failed to print' };
  }
};

// Helper to center text within a given width
const centerText = (text: string, width: number): string => {
  if (text.length >= width) return text.substring(0, width);
  const padding = Math.floor((width - text.length) / 2);
  return ' '.repeat(padding) + text;
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
  uploadRefNo?: string;
  collectorName: string;
  collections: Array<{
    index: number;
    weight: number;
    transrefno?: string;
  }>;
  cumulativeFrequency?: number;
  locationCode?: string;
  locationName?: string;
  collectionDate?: Date;
}): Promise<{ success: boolean; error?: string }> => {
  const companyName = data.companyName || 'DAIRY COLLECTION';
  const totalWeight = data.collections.reduce((sum, col) => sum + col.weight, 0);
  
  const dateObj = data.collectionDate || new Date();
  const formattedDate = dateObj.toLocaleDateString('en-CA');
  const formattedTime = dateObj.toLocaleTimeString('en-GB', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });

  // 58mm thermal paper = 32 characters per line
  const W = 32;
  const sep = '-'.repeat(W);

  // Build collections text
  let collectionsText = '';
  data.collections.forEach((col) => {
    const prefix = `${col.index}: ${col.transrefno || '-'}`;
    const weight = col.weight.toFixed(1);
    const spaces = W - prefix.length - weight.length;
    collectionsText += prefix + ' '.repeat(Math.max(1, spaces)) + weight + '\n';
  });

  let receipt = '';
  
  receipt += centerText(companyName, W) + '\n';
  receipt += centerText('CUSTOMER DELIVERY RECEIPT', W) + '\n';
  receipt += '\n';
  
  receipt += formatLine('Member NO     ', '#' + data.farmerId, W) + '\n';
  receipt += formatLine('Member Name   ', data.farmerName, W) + '\n';
  receipt += formatLine('Reference NO  ', data.uploadRefNo || '', W) + '\n';
  receipt += formatLine('Date          ', formattedDate + ' ' + formattedTime, W) + '\n';
  receipt += '\n';
  
  receipt += collectionsText;
  receipt += '\n';
  
  const totalStr = totalWeight.toFixed(2);
  receipt += formatLine('Total Weight[Kgs]', totalStr, W) + '\n';
  receipt += sep + '\n';
  
  if (data.cumulativeFrequency !== undefined) {
    receipt += formatLine('Cumulative    ', data.cumulativeFrequency.toFixed(1), W) + '\n';
  }
  if (data.locationCode) {
    receipt += formatLine('Location      ', data.locationCode, W) + '\n';
  }
  if (data.locationName) {
    receipt += formatLine('Location Name ', data.locationName, W) + '\n';
  }
  receipt += formatLine('Member Region ', data.route || '', W) + '\n';
  receipt += formatLine('Clerk Name    ', data.collectorName, W) + '\n';
  receipt += formatLine('Session       ', data.session || '', W) + '\n';
  receipt += formatLine('', formattedDate + ' ' + formattedTime, W) + '\n';

  return printToBluetoothPrinter(receipt);
};
