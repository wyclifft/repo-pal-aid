import { BleClient, BleDevice, numbersToDataView, numberToUUID } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { logConnectionTips } from '@/utils/bluetoothDiagnostics';

export type ScaleType = 'HC-05' | 'HM-10' | 'Unknown';

// Log helpful tips when this module loads
if (typeof window !== 'undefined') {
  logConnectionTips();
}

interface BluetoothScale {
  device: BleDevice | any | null;
  characteristic: string | any | null;
  type: ScaleType;
}

let scale: BluetoothScale = {
  device: null,
  characteristic: null,
  type: 'Unknown',
};

interface BluetoothPrinter {
  device: BleDevice | any | null;
  characteristic: string | any | null;
}

let printer: BluetoothPrinter = {
  device: null,
  characteristic: null,
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
// Additional common scale service UUIDs
const GENERIC_SCALE_SERVICES = [
  numberToUUID(0xffe0), // HC-05
  numberToUUID(0xfee7), // HM-10
  numberToUUID(0x1800), // Generic Access
  numberToUUID(0x180a), // Device Information
  '0000fff0-0000-1000-8000-00805f9b34fb', // Common custom service
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip Transparent UART
];

export const connectBluetoothScale = async (
  onWeightUpdate: (weight: number, scaleType: ScaleType) => void
): Promise<{ success: boolean; type: ScaleType; error?: string }> => {
  try {
    // Use native Capacitor Bluetooth on mobile, Web Bluetooth on web
    if (Capacitor.isNativePlatform()) {
      await BleClient.initialize();
      
      console.log('🔍 Requesting Bluetooth scale device...');

      const device = await BleClient.requestDevice({
        optionalServices: GENERIC_SCALE_SERVICES,
      });

      console.log(`📱 Device selected: ${device.name || 'Unknown'} (ID: ${device.deviceId})`);
      
      await BleClient.connect(device.deviceId);
      console.log('✅ Connected to device');

      let scaleType: ScaleType = 'Unknown';
      let serviceUuid = '';
      let characteristicUuid = '';

      // Get all services and log them for diagnostics
      const services = await BleClient.getServices(device.deviceId);
      console.log(`📋 Found ${services.length} services:`);
      services.forEach((service, index) => {
        console.log(`  Service ${index + 1}: ${service.uuid}`);
        console.log(`    Characteristics: ${service.characteristics.length}`);
        service.characteristics.forEach((char, charIndex) => {
          console.log(`      Char ${charIndex + 1}: ${char.uuid}`);
          console.log(`        Properties: read=${char.properties.read}, write=${char.properties.write}, notify=${char.properties.notify}`);
        });
      });

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

      // Try any service with notify characteristic (for generic scales like ACS-SB1)
      if (!serviceUuid) {
        console.log('⚠️ Standard services not found, trying generic discovery...');
        for (const service of services) {
          // Skip standard Bluetooth services
          if (service.uuid.toLowerCase().includes('1800') || 
              service.uuid.toLowerCase().includes('1801') ||
              service.uuid.toLowerCase().includes('180a')) {
            continue;
          }
          
          const notifyChar = service.characteristics.find(c => c.properties.notify);
          if (notifyChar) {
            serviceUuid = service.uuid;
            characteristicUuid = notifyChar.uuid;
            scaleType = 'Unknown';
            console.log(`✅ Found generic scale service: ${service.uuid}`);
            console.log(`   Using characteristic: ${characteristicUuid}`);
            break;
          }
        }
      }

      if (!serviceUuid || !characteristicUuid) {
        console.error('❌ Could not find any compatible scale service');
        console.error('Available services:', services.map(s => s.uuid).join(', '));
        throw new Error('Could not find compatible Bluetooth scale service. Check console for available services.');
      }

      console.log(`📡 Starting notifications on ${serviceUuid}/${characteristicUuid}`);

      await BleClient.startNotifications(
        device.deviceId,
        serviceUuid,
        characteristicUuid,
        (value) => {
          const text = new TextDecoder().decode(value);
          console.log(`📊 Raw scale data: "${text}" (${value.byteLength} bytes)`);
          
          // Try multiple parsing strategies
          let parsed: number | null = null;
          
          // Strategy 1: Look for decimal number (e.g., "12.34")
          const decimalMatch = text.match(/(\d+\.\d+)/);
          if (decimalMatch) {
            parsed = parseFloat(decimalMatch[1]);
          }
          
          // Strategy 2: Look for integer number (e.g., "1234" -> 12.34)
          if (!parsed || isNaN(parsed)) {
            const intMatch = text.match(/(\d+)/);
            if (intMatch) {
              const intValue = parseInt(intMatch[1]);
              // Many scales send weight in grams, convert to kg
              parsed = intValue > 1000 ? intValue / 1000 : intValue;
            }
          }
          
          if (parsed && !isNaN(parsed) && parsed > 0) {
            console.log(`✅ Parsed weight: ${parsed} kg`);
            onWeightUpdate(parsed, scaleType);
          } else {
            console.warn(`⚠️ Could not parse weight from: "${text}"`);
          }
        }
      );

      scale = { device, characteristic: characteristicUuid, type: scaleType };
      
      // Save device info for quick reconnect
      saveDeviceInfo(device.deviceId, device.name || 'Unknown Scale', scaleType);
      
      console.log('✅ Scale connection successful');
      return { success: true, type: scaleType };
    } else {
      // Web Bluetooth fallback for browser
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

      const handleScaleData = (event: Event) => {
        const target = event.target as any;
        const text = new TextDecoder().decode(target.value);
        const match = text.match(/(\d+\.\d+)/);
        if (match) {
          const parsed = parseFloat(match[1]);
          if (!isNaN(parsed)) {
            onWeightUpdate(parsed, scaleType);
          }
        }
      };

      characteristic.addEventListener('characteristicvaluechanged', handleScaleData);
      await characteristic.startNotifications();

      scale = { device, characteristic, type: scaleType };
      return { success: true, type: scaleType };
    }
  } catch (err) {
    console.error('❌ Bluetooth connection error:', err);
    console.error('Error details:', {
      name: err instanceof Error ? err.name : 'Unknown',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    });
    
    return {
      success: false,
      type: 'Unknown',
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
};

export const disconnectBluetoothScale = async (clearSaved: boolean = false): Promise<void> => {
  try {
    if (scale.device) {
      if (Capacitor.isNativePlatform()) {
        await BleClient.disconnect(scale.device.deviceId);
      } else if ('bluetooth' in navigator) {
        if (scale.device.gatt?.connected) {
          scale.device.gatt.disconnect();
        }
      }
      scale = { device: null, characteristic: null, type: 'Unknown' };
      
      if (clearSaved) {
        clearStoredDevice();
      }
    }
  } catch (error) {
    console.error('Failed to disconnect from scale:', error);
    throw error;
  }
};

export const quickReconnect = async (
  deviceId: string,
  onWeightUpdate: (weight: number, scaleType: ScaleType) => void
): Promise<{ success: boolean; type: ScaleType; error?: string }> => {
  try {
    if (Capacitor.isNativePlatform()) {
      await BleClient.initialize();
      await BleClient.connect(deviceId);
      
      const storedInfo = getStoredDeviceInfo();
      if (!storedInfo) {
        return { success: false, type: 'Unknown', error: 'No stored device info' };
      }

      let serviceUuid = '';
      let characteristicUuid = '';
      const scaleType = storedInfo.scaleType;

      const services = await BleClient.getServices(deviceId);
      const targetServiceUuid = scaleType === 'HC-05' ? SERVICE_UUID_HC05 : SERVICE_UUID_HM10;
      const service = services.find(s => s.uuid.toLowerCase().includes(targetServiceUuid));
      
      if (!service || service.characteristics.length === 0) {
        return { success: false, type: 'Unknown', error: 'Service not found' };
      }

      serviceUuid = service.uuid;
      characteristicUuid = service.characteristics[0].uuid;

      await BleClient.startNotifications(
        deviceId,
        serviceUuid,
        characteristicUuid,
        (value) => {
          const text = new TextDecoder().decode(value);
          const match = text.match(/(\d+\.\d+)/);
          if (match) {
            const parsed = parseFloat(match[1]);
            if (!isNaN(parsed)) {
              onWeightUpdate(parsed, scaleType);
            }
          }
        }
      );

      const device = { deviceId } as BleDevice;
      scale = { device, characteristic: characteristicUuid, type: scaleType };
      
      return { success: true, type: scaleType };
    } else if ('bluetooth' in navigator) {
      // Web Bluetooth API support for PWA on mobile browsers
      const storedInfo = getStoredDeviceInfo();
      if (!storedInfo) {
        return { success: false, type: 'Unknown', error: 'No stored device info' };
      }

      const scaleType = storedInfo.scaleType;
      const serviceUuid = scaleType === 'HC-05' ? SERVICE_UUID_HC05 : SERVICE_UUID_HM10;

      // Request device with saved ID
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [{ services: [serviceUuid] }],
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(serviceUuid);
      
      // Get the first characteristic that supports notifications
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

      scale = { device, characteristic: notifyCharacteristic.uuid, type: scaleType };
      return { success: true, type: scaleType };
    } else {
      return { success: false, type: 'Unknown', error: 'Bluetooth not available on this device' };
    }
  } catch (error: any) {
    console.error('Failed to reconnect to scale:', error);
    return { success: false, type: 'Unknown', error: error.message || 'Failed to reconnect' };
  }
};

// Printer-specific UUIDs - common thermal printer service
const PRINTER_SERVICE_UUID = numberToUUID(0x18f0);
const PRINTER_WRITE_CHARACTERISTIC_UUID = numberToUUID(0x2af1); // Common write characteristic

export const connectBluetoothPrinter = async (): Promise<{ 
  success: boolean; 
  deviceName?: string;
  error?: string 
}> => {
  try {
    if (Capacitor.isNativePlatform()) {
      await BleClient.initialize();

      const device = await BleClient.requestDevice({
        optionalServices: [PRINTER_SERVICE_UUID],
      });

      await BleClient.connect(device.deviceId);

      printer = { device, characteristic: null };
      savePrinterInfo(device.deviceId, device.name || 'Bluetooth Printer');

      return { success: true, deviceName: device.name || 'Bluetooth Printer' };
    } else if ('bluetooth' in navigator) {
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [PRINTER_SERVICE_UUID],
      });

      const server = await device.gatt.connect();
      printer = { device, characteristic: null };
      savePrinterInfo(device.id, device.name || 'Bluetooth Printer');

      return { success: true, deviceName: device.name || 'Bluetooth Printer' };
    } else {
      return { success: false, error: 'Bluetooth not available' };
    }
  } catch (error: any) {
    console.error('Failed to connect to printer:', error);
    return { success: false, error: error.message || 'Failed to connect' };
  }
};

export const quickReconnectPrinter = async (deviceId: string): Promise<{ 
  success: boolean; 
  error?: string 
}> => {
  try {
    if (Capacitor.isNativePlatform()) {
      await BleClient.initialize();
      await BleClient.connect(deviceId);
      
      const device = { deviceId } as BleDevice;
      printer = { device, characteristic: null };
      
      return { success: true };
    } else if ('bluetooth' in navigator) {
      // Web Bluetooth API support for PWA on mobile browsers
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [PRINTER_SERVICE_UUID],
      });

      const server = await device.gatt.connect();
      printer = { device, characteristic: null };
      
      return { success: true };
    } else {
      return { success: false, error: 'Bluetooth not available on this device' };
    }
  } catch (error: any) {
    console.error('Failed to reconnect to printer:', error);
    return { success: false, error: error.message || 'Failed to reconnect' };
  }
};

export const disconnectBluetoothPrinter = async (clearSaved: boolean = false): Promise<void> => {
  try {
    if (printer.device) {
      if (Capacitor.isNativePlatform()) {
        await BleClient.disconnect(printer.device.deviceId);
      } else if ('bluetooth' in navigator) {
        if (printer.device.gatt?.connected) {
          printer.device.gatt.disconnect();
        }
      }
      printer = { device: null, characteristic: null };
      
      if (clearSaved) {
        clearStoredPrinter();
      }
    }
  } catch (error) {
    console.error('Failed to disconnect from printer:', error);
    throw error;
  }
};

// ESC/POS Commands for thermal printers
const ESC = 0x1B;
const GS = 0x1D;

const COMMANDS = {
  INIT: [ESC, 0x40], // Initialize printer
  LINE_FEED: [0x0A], // Line feed
  CUT_PAPER: [GS, 0x56, 0x00], // Cut paper
  BOLD_ON: [ESC, 0x45, 0x01], // Bold on
  BOLD_OFF: [ESC, 0x45, 0x00], // Bold off
  ALIGN_LEFT: [ESC, 0x61, 0x00], // Align left
  ALIGN_CENTER: [ESC, 0x61, 0x01], // Align center
  ALIGN_RIGHT: [ESC, 0x61, 0x02], // Align right
};

// Convert string to byte array
const stringToBytes = (str: string): number[] => {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    bytes.push(str.charCodeAt(i));
  }
  return bytes;
};

export const printToBluetoothPrinter = async (content: string): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!printer.device) {
      return { success: false, error: 'No printer connected' };
    }

    // Build the print data
    const printData: number[] = [
      ...COMMANDS.INIT,
      ...COMMANDS.ALIGN_CENTER,
      ...stringToBytes(content),
      ...COMMANDS.LINE_FEED,
      ...COMMANDS.LINE_FEED,
      ...COMMANDS.LINE_FEED,
      ...COMMANDS.CUT_PAPER,
    ];

    const dataView = new Uint8Array(printData);

    if (Capacitor.isNativePlatform()) {
      // For native platforms, we need to find the write characteristic first
      const services = await BleClient.getServices(printer.device.deviceId);
      
      // Try to find a writable characteristic
      let writeChar: string | null = null;
      for (const service of services) {
        for (const char of service.characteristics) {
          // Look for write or write without response properties
          if (char.properties.write || char.properties.writeWithoutResponse) {
            writeChar = char.uuid;
            break;
          }
        }
        if (writeChar) break;
      }

      if (!writeChar) {
        return { success: false, error: 'No writable characteristic found' };
      }

      // Write data in chunks (some printers have MTU limitations)
      const chunkSize = 20;
      for (let i = 0; i < dataView.length; i += chunkSize) {
        const chunk = dataView.slice(i, Math.min(i + chunkSize, dataView.length));
        const dataViewChunk = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        await BleClient.write(
          printer.device.deviceId,
          services[0].uuid,
          writeChar,
          dataViewChunk
        );
      }

      return { success: true };
    } else if ('bluetooth' in navigator && printer.device.gatt?.connected) {
      // For web Bluetooth
      const service = await printer.device.gatt.getPrimaryService(PRINTER_SERVICE_UUID);
      const characteristics = await service.getCharacteristics();
      
      // Find writable characteristic
      let writeChar: BluetoothRemoteGATTCharacteristic | null = null;
      for (const char of characteristics) {
        if (char.properties.write || char.properties.writeWithoutResponse) {
          writeChar = char;
          break;
        }
      }

      if (!writeChar) {
        return { success: false, error: 'No writable characteristic found' };
      }

      // Write data in chunks
      const chunkSize = 20;
      for (let i = 0; i < dataView.length; i += chunkSize) {
        const chunk = dataView.slice(i, Math.min(i + chunkSize, dataView.length));
        await writeChar.writeValue(chunk);
      }

      return { success: true };
    } else {
      return { success: false, error: 'Bluetooth not available' };
    }
  } catch (error: any) {
    console.error('Failed to print:', error);
    return { success: false, error: error.message || 'Failed to print' };
  }
};

export const printReceipt = async (data: {
  companyName?: string;
  farmerName: string;
  farmerId: string;
  route?: string;
  collectorName: string;
  collections: Array<{
    time: string;
    weight: number;
  }>;
}): Promise<{ success: boolean; error?: string }> => {
  const companyName = data.companyName || 'DAIRY COLLECTION';
  const totalWeight = data.collections.reduce((sum, col) => sum + col.weight, 0);
  const currentDate = new Date().toLocaleDateString('en-GB');

  // 58mm thermal paper = 32 characters per line
  const LINE_WIDTH = 32;
  const separator = '-'.repeat(LINE_WIDTH);

  let collectionsText = '';
  data.collections.forEach((col, index) => {
    const lineNum = String(index + 1).padEnd(3);
    const time = col.time.substring(0, 8).padEnd(9);
    const weight = col.weight.toFixed(1).padStart(6);
    collectionsText += `${lineNum}${time}${weight}\n`;
  });

  const receiptText = `
      ${companyName}
${separator}
Farmer: ${data.farmerId}
${data.farmerName}
${data.route ? `Route: ${data.route}` : ''}
Collector: ${data.collectorName}
Date: ${currentDate}
${separator}
#  TIME     LITERS
${separator}
${collectionsText}${separator}
TOTAL: ${totalWeight.toFixed(1)} L
${separator}
Thank you!
${separator}
`;

  return printToBluetoothPrinter(receiptText);
};
