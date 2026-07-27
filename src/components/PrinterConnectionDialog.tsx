import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import {
  Printer,
  Wifi,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Bluetooth
} from 'lucide-react';
import {
  connectBluetoothPrinter,
} from '@/services/bluetooth';
import {
  isClassicBluetoothAvailable,
  getPairedDevices,
  connectClassicPrinter,
  type ClassicBluetoothDevice,
} from '@/services/bluetoothClassic';

export type PrinterConnectionType = 'ble' | 'classic';

interface PrinterConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: (name: string, type: 'ble' | 'classic') => void;
}

interface DeviceWithResolvedName extends ClassicBluetoothDevice {
  resolvedName?: string;
}

export const PrinterConnectionDialog = ({
  open,
  onOpenChange,
  onConnected,
}: PrinterConnectionDialogProps) => {
  const [connectionType, setConnectionType] = useState<PrinterConnectionType>(
    Capacitor.isNativePlatform() ? 'classic' : 'ble'
  );
  const [classicAvailable, setClassicAvailable] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<DeviceWithResolvedName[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DeviceWithResolvedName | null>(null);

  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (open && isNative) {
      isClassicBluetoothAvailable().then(function(avail) {
        setClassicAvailable(avail);
      });
    }
  }, [open, isNative]);

  useEffect(() => {
    if (open && connectionType === 'classic' && isNative) {
      loadPairedDevices();
    }
  }, [open, connectionType, isNative]);

  const loadPairedDevices = async () => {
    setIsLoadingDevices(true);
    try {
      const devices = await getPairedDevices();
      setPairedDevices(devices.map(function(d) {
        return {
          ...d,
          resolvedName: d.name || "Device " + d.address.slice(-5)
        };
      }));
    } catch (error) {
      toast.error('Failed to load devices');
    }
    setIsLoadingDevices(false);
  };

  const handleBleScan = async () => {
    setIsScanning(true);
    setIsConnecting(true);
    try {
      const result = await connectBluetoothPrinter();
      if (result.success) {
        const name = result.deviceName || "Bluetooth Printer";
        toast.success("Connected: " + name);
        onConnected(name, 'ble');
        onOpenChange(false);
      } else {
        toast.error(result.error || 'Connection failed');
      }
    } catch (error) {
      toast.error('BLE connection failed');
    }
    setIsScanning(false);
    setIsConnecting(false);
  };

  const handleClassicConnect = async (device: DeviceWithResolvedName) => {
    setIsConnecting(true);
    setSelectedDevice(device);
    const displayName = device.name || device.resolvedName || device.address;
    try {
      const result = await connectClassicPrinter(device);
      if (result.success) {
        toast.success("Connected: " + displayName);
        onConnected(displayName, 'classic');
        onOpenChange(false);
      } else {
        toast.error(result.error || 'Failed to connect');
      }
    } catch (error) {
      toast.error('Classic BT failed');
    }
    setIsConnecting(false);
    setSelectedDevice(null);
  };

  const isLikelyPrinter = (name: string) => {
    const patterns = ['PRINT', 'POS', 'THERMAL', 'RECEIPT', 'CS10', 'SUNMI'];
    const u = name.toUpperCase();
    return patterns.some(function(p) { return u.indexOf(p) !== -1; });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white border-2 p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Printer className="h-5 w-5 text-primary" />
            Printer Selector
          </DialogTitle>
          <DialogDescription>Choose your printer type</DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          {/* ES5-friendly manual tab switcher */}
          <div className="flex border rounded-md overflow-hidden">
            <button
              onClick={function() { setConnectionType('ble'); }}
              className={"flex-1 py-3 font-bold " + (connectionType === 'ble' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600')}
            >
              BLE
            </button>
            <button
              onClick={function() { setConnectionType('classic'); }}
              disabled={!classicAvailable && isNative}
              className={"flex-1 py-3 font-bold " + (connectionType === 'classic' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600')}
            >
              CLASSIC
            </button>
          </div>

          {connectionType === 'ble' ? (
            <div className="py-4 text-center">
              <Button onClick={handleBleScan} disabled={isScanning || isConnecting} className="w-full h-12">
                {isScanning ? "Scanning..." : "Scan for BLE Printer"}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center px-1">
                <span className="text-sm font-bold">Paired Devices</span>
                <RefreshCw className={"h-4 w-4 " + (isLoadingDevices ? "animate-spin" : "")} onClick={loadPairedDevices} />
              </div>
              <div className="max-h-60 overflow-y-auto border rounded-md p-1 space-y-2">
                {pairedDevices.length === 0 && !isLoadingDevices && (
                  <div className="py-8 text-center text-gray-400 text-xs">No paired devices found</div>
                )}
                {pairedDevices.map(function(device) {
                  return (
                    <button
                      key={device.address}
                      onClick={function() { handleClassicConnect(device); }}
                      className={"w-full text-left p-3 border rounded-md " + (selectedDevice?.address === device.address ? "border-primary bg-primary/5" : "border-gray-200")}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-bold text-sm flex items-center gap-1">
                            {device.name || device.resolvedName}
                            {isLikelyPrinter(device.name || '') && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                          </div>
                          <div className="text-[10px] text-gray-400">{device.address}</div>
                        </div>
                        {selectedDevice?.address === device.address && isConnecting && <RefreshCw className="h-4 w-4 animate-spin" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
