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
  isInternalPosPrinter,
  connectDirectToAddress,
  INTERNAL_PRINTER_ADDRESSES,
} from '@/services/bluetoothClassic';

export type PrinterConnectionType = 'ble' | 'classic' | 'direct';

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
  const [directAddress, setDirectAddress] = useState(INTERNAL_PRINTER_ADDRESSES[0]);

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

  const handleDirectConnect = async (address: string) => {
    setIsConnecting(true);
    try {
      const result = await connectDirectToAddress(address);
      if (result.success) {
        toast.success("Directly Connected: " + address);
        onConnected("Internal Printer (" + address.slice(-5) + ")", 'classic');
        onOpenChange(false);
      } else {
        toast.error(result.error || 'Direct connect failed');
      }
    } catch (error) {
      toast.error('Direct connect failed');
    }
    setIsConnecting(false);
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
              className={"flex-1 py-2 text-xs font-bold " + (connectionType === 'ble' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600')}
            >
              BLE
            </button>
            <button
              onClick={function() { setConnectionType('classic'); }}
              disabled={!classicAvailable && isNative}
              className={"flex-1 py-2 text-xs font-bold " + (connectionType === 'classic' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600')}
            >
              CLASSIC
            </button>
            <button
              onClick={function() { setConnectionType('direct'); }}
              disabled={!isNative}
              className={"flex-1 py-2 text-xs font-bold " + (connectionType === 'direct' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600')}
            >
              DIRECT
            </button>
          </div>

          {connectionType === 'ble' ? (
            <div className="py-4 text-center">
              <Button onClick={handleBleScan} disabled={isScanning || isConnecting} className="w-full h-12">
                {isScanning ? "Scanning..." : "Scan for BLE Printer"}
              </Button>
            </div>
          ) : connectionType === 'classic' ? (
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
                      className={"w-full text-left p-3 border rounded-md transition-colors " +
                        (selectedDevice?.address === device.address ? "border-primary bg-primary/5 " : "border-gray-200 ") +
                        (isInternalPosPrinter(device.name || '') ? "bg-green-50/50 border-green-200 " : "")
                      }
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-bold text-sm flex items-center gap-1">
                            {device.name || device.resolvedName}
                            {isInternalPosPrinter(device.name || '') ? (
                              <span className="text-[10px] bg-green-500 text-white px-1.5 py-0.5 rounded-full font-normal">Internal</span>
                            ) : isLikelyPrinter(device.name || '') && (
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                            )}
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
          ) : (
            <div className="space-y-4 py-2">
              <div className="bg-amber-50 border border-amber-200 p-2 rounded text-[10px] text-amber-800 flex gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <p>Use this if your internal printer doesn't show up in the paired list. This forces a direct insecure connection to a specific address.</p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500">MANUAL MAC ADDRESS</label>
                <input
                  type="text"
                  value={directAddress}
                  onChange={(e) => setDirectAddress(e.target.value)}
                  className="w-full border p-2 rounded text-sm font-mono"
                  placeholder="00:00:00:00:00:00"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase">Presets</label>
                <div className="grid grid-cols-2 gap-2">
                  {INTERNAL_PRINTER_ADDRESSES.map((addr) => (
                    <button
                      key={addr}
                      onClick={() => setDirectAddress(addr)}
                      className={"p-2 text-[10px] border rounded transition-colors " + (directAddress === addr ? "bg-primary text-white border-primary" : "bg-gray-50 hover:bg-gray-100")}
                    >
                      {addr}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                onClick={() => handleDirectConnect(directAddress)}
                disabled={isConnecting}
                className="w-full h-12 bg-green-600 hover:bg-green-700"
              >
                {isConnecting ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Wifi className="h-4 w-4 mr-2" />}
                Force Connect Internal
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
