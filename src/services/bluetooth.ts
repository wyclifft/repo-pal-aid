import { BleClient, BleDevice, numbersToDataView, numberToUUID } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

export type ScaleType = 'HC-05' | 'HM-10' | 'Unknown';

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

export const connectBluetoothScale = async (
  onWeightUpdate: (weight: number, scaleType: ScaleType) => void
): Promise<{ success: boolean; type: ScaleType; error?: string }> => {
  try {
    // Use native Capacitor Bluetooth on mobile, Web Bluetooth on web
    if (Capacitor.isNativePlatform()) {
      await BleClient.initialize();

      const device = await BleClient.requestDevice({
        optionalServices: [SERVICE_UUID_HC05, SERVICE_UUID_HM10],
      });

      await BleClient.connect(device.deviceId);

      let scaleType: ScaleType = 'Unknown';
      let serviceUuid = '';
      let characteristicUuid = '';

      // Try HC-05 first
      try {
        const services = await BleClient.getServices(device.deviceId);
        const hc05Service = services.find(s => s.uuid.toLowerCase().includes(SERVICE_UUID_HC05));
        if (hc05Service && hc05Service.characteristics.length > 0) {
          serviceUuid = hc05Service.uuid;
          characteristicUuid = hc05Service.characteristics[0].uuid;
          scaleType = 'HC-05';
        }
      } catch (e) {
        console.log('Not HC-05, trying HM-10');
      }

      // Try HM-10 if HC-05 failed
      if (!serviceUuid) {
        try {
          const services = await BleClient.getServices(device.deviceId);
          const hm10Service = services.find(s => s.uuid.toLowerCase().includes(SERVICE_UUID_HM10));
          if (hm10Service && hm10Service.characteristics.length > 0) {
            serviceUuid = hm10Service.uuid;
            characteristicUuid = hm10Service.characteristics[0].uuid;
            scaleType = 'HM-10';
          }
        } catch (e) {
          console.error('Failed to find HM-10 service:', e);
        }
      }

      if (!serviceUuid || !characteristicUuid) {
        throw new Error('Could not find compatible Bluetooth scale service');
      }

      await BleClient.startNotifications(
        device.deviceId,
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

      scale = { device, characteristic: characteristicUuid, type: scaleType };
      
      // Save device info for quick reconnect
      saveDeviceInfo(device.deviceId, device.name || 'Unknown Scale', scaleType);
      
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
    console.error('Bluetooth connection error:', err);
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
    } else {
      return { success: false, type: 'Unknown', error: 'Quick reconnect only available on mobile' };
    }
  } catch (error: any) {
    console.error('Failed to reconnect to scale:', error);
    return { success: false, type: 'Unknown', error: error.message || 'Failed to reconnect' };
  }
};

// Printer-specific UUID - common thermal printer service
const PRINTER_SERVICE_UUID = numberToUUID(0x18f0);

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
    } else {
      return { success: false, error: 'Quick reconnect only available on mobile' };
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
