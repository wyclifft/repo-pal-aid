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

export const disconnectBluetoothScale = async () => {
  try {
    if (Capacitor.isNativePlatform() && scale.device) {
      await BleClient.disconnect(scale.device.deviceId);
    } else if (scale.device && scale.device.gatt?.connected) {
      await scale.device.gatt.disconnect();
    }
  } catch (err) {
    console.error('Bluetooth disconnect error:', err);
  }
  scale = { device: null, characteristic: null, type: 'Unknown' };
};
