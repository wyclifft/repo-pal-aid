export type ScaleType = 'HC-05' | 'HM-10' | 'Unknown';

interface BluetoothScale {
  device: any | null;
  characteristic: any | null;
  type: ScaleType;
}

let scale: BluetoothScale = {
  device: null,
  characteristic: null,
  type: 'Unknown',
};

export const connectBluetoothScale = async (
  onWeightUpdate: (weight: number, scaleType: ScaleType) => void
): Promise<{ success: boolean; type: ScaleType; error?: string }> => {
  try {
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
  if (scale.device && scale.device.gatt?.connected) {
    await scale.device.gatt.disconnect();
  }
  scale = { device: null, characteristic: null, type: 'Unknown' };
};
