import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import { 
  Bluetooth, 
  BluetoothSearching, 
  Wifi, 
  RefreshCw, 
  AlertCircle,
  CheckCircle2,
  HelpCircle
} from 'lucide-react';
import { 
  connectBluetoothScale, 
  type ScaleType 
} from '@/services/bluetooth';
import {
  isClassicBluetoothAvailable,
  getPairedDevices,
  connectClassicScale,
  type ClassicBluetoothDevice,
  isLikelyClassicDevice,
} from '@/services/bluetoothClassic';

export type BluetoothConnectionType = 'ble' | 'classic';

interface BluetoothConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: (type: 'ble' | 'classic-spp', scaleType: ScaleType) => void;
  onWeightUpdate: (weight: number, scaleType?: ScaleType) => void;
}

interface DeviceWithResolvedName extends ClassicBluetoothDevice {
  resolvedName?: string;
  isResolving?: boolean;
}

export const BluetoothConnectionDialog = ({
  open,
  onOpenChange,
  onConnected,
  onWeightUpdate,
}: BluetoothConnectionDialogProps) => {
  const [connectionType, setConnectionType] = useState<BluetoothConnectionType>('ble');
  const [classicAvailable, setClassicAvailable] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<DeviceWithResolvedName[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<DeviceWithResolvedName | null>(null);
  
  const isNative = Capacitor.isNativePlatform();

  // Check Classic BT availability on mount
  useEffect(() => {
    if (open && isNative) {
      isClassicBluetoothAvailable().then(setClassicAvailable);
    }
  }, [open, isNative]);

  // Load paired devices when Classic is selected
  useEffect(() => {
    if (open && connectionType === 'classic' && isNative) {
      loadPairedDevices();
    }
  }, [open, connectionType, isNative]);

  /**
   * Load all paired devices (not just scales) for Classic BT
   * This allows connecting to unnamed/unknown devices
   */
  const loadPairedDevices = async () => {
    setIsLoadingDevices(true);
    try {
      // Get ALL paired devices, not just known scales
      const devices = await getPairedDevices();
      console.log(`📱 Loaded ${devices.length} paired devices (including unnamed)`);
      
      // Enhance devices with resolved names
      const enhancedDevices: DeviceWithResolvedName[] = devices.map(device => ({
        ...device,
        resolvedName: device.name || undefined,
        isResolving: !device.name, // Mark unnamed for resolution attempt
      }));
      
      // Log raw device data for debugging
      enhancedDevices.forEach(d => {
        console.log(`📋 Device: "${d.name || 'UNNAMED'}" MAC: ${d.address} Bonded: ${d.bonded}`);
      });
      
      setPairedDevices(enhancedDevices);
      
      // Attempt name resolution for unnamed devices
      resolveUnknownDeviceNames(enhancedDevices);
      
    } catch (error) {
      console.error('Error loading paired devices:', error);
      toast.error('Failed to load paired devices');
    }
    setIsLoadingDevices(false);
  };

  /**
   * Attempt to resolve names for unnamed devices
   * Uses various strategies including GATT device info when possible
   */
  const resolveUnknownDeviceNames = async (devices: DeviceWithResolvedName[]) => {
    const unknownDevices = devices.filter(d => !d.name);
    if (unknownDevices.length === 0) return;
    
    console.log(`🔍 Attempting name resolution for ${unknownDevices.length} unnamed devices`);
    
    // For now, generate friendly names based on MAC address
    // In future, could attempt BLE GATT connection to read device info
    const updatedDevices = devices.map(device => {
      if (!device.name) {
        // Generate a friendly identifier from MAC address
        const shortMac = device.address.split(':').slice(-2).join('');
        const friendlyName = `Unknown Device (${shortMac})`;
        return {
          ...device,
          resolvedName: friendlyName,
          isResolving: false,
        };
      }
      return { ...device, isResolving: false };
    });
    
    setPairedDevices(updatedDevices);
  };

  /**
   * Handle BLE scan and connect
   */
  const handleBleScan = async () => {
    setIsScanning(true);
    setIsConnecting(true);
    
    try {
      console.log('🔍 Starting BLE scan for scales...');
      
      const result = await connectBluetoothScale((weight, scaleType) => {
        // Log raw incoming BLE data
        console.log(`📡 BLE Raw Weight Update: ${weight} kg from ${scaleType}`);
        onWeightUpdate(weight, scaleType);
      });

      if (result.success) {
        console.log(`✅ BLE connected: ${result.type}`);
        toast.success(`Scale connected via BLE: ${result.type}`);
        onConnected('ble', result.type);
        onOpenChange(false);
      } else {
        const errorMsg = result.error || 'Failed to connect';
        if (errorMsg.includes('notification') || errorMsg.includes('CCCD')) {
          toast.error('BLE notification failed. Try Classic Bluetooth.', { duration: 5000 });
        } else if (!errorMsg.includes('cancelled')) {
          toast.error(errorMsg);
        }
      }
    } catch (error: any) {
      console.error('BLE scan error:', error);
      if (!error?.message?.includes('cancelled')) {
        toast.error('BLE connection failed');
      }
    }
    
    setIsScanning(false);
    setIsConnecting(false);
  };

  /**
   * Handle Classic Bluetooth connection to selected device
   */
  const handleClassicConnect = async (device: DeviceWithResolvedName) => {
    setIsConnecting(true);
    setSelectedDevice(device);
    
    const displayName = device.name || device.resolvedName || device.address;
    console.log(`🔗 Connecting to Classic BT: ${displayName} (${device.address})`);
    
    try {
      const result = await connectClassicScale(device, (weight) => {
        // Log raw incoming Classic BT data
        console.log(`📡 Classic BT Raw Weight Update: ${weight} kg`);
        onWeightUpdate(weight, 'Classic-SPP');
      });

      if (result.success) {
        console.log(`✅ Classic BT connected: ${displayName}`);
        toast.success(`Connected to ${displayName}`);
        onConnected('classic-spp', 'Classic-SPP');
        onOpenChange(false);
      } else {
        toast.error(result.error || 'Failed to connect');
      }
    } catch (error) {
      console.error('Classic BT connection error:', error);
      toast.error('Classic BT connection failed');
    }
    
    setIsConnecting(false);
    setSelectedDevice(null);
  };

  /**
   * Get display name for device
   */
  const getDeviceDisplayName = (device: DeviceWithResolvedName): string => {
    if (device.name) return device.name;
    if (device.resolvedName) return device.resolvedName;
    return `Device ${device.address}`;
  };

  /**
   * Check if device is a recognized scale type
   */
  const isKnownScaleType = (device: DeviceWithResolvedName): boolean => {
    return isLikelyClassicDevice(device.name || '');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bluetooth className="h-5 w-5 text-primary" />
            Connect Bluetooth Scale
          </DialogTitle>
          <DialogDescription>
            Choose connection type and select your scale device
          </DialogDescription>
        </DialogHeader>

        {/* Connection Type Selector */}
        <div className="space-y-4">
          <div className="bg-muted/50 p-4 rounded-lg">
            <Label className="text-sm font-semibold mb-3 block">Connection Type</Label>
            <RadioGroup
              value={connectionType}
              onValueChange={(value) => setConnectionType(value as BluetoothConnectionType)}
              className="space-y-2"
            >
              <div className="flex items-center space-x-3 p-2 rounded-md hover:bg-muted/80 transition-colors">
                <RadioGroupItem value="ble" id="ble" />
                <Label htmlFor="ble" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Wifi className="h-4 w-4 text-primary" />
                    <span className="font-medium">Bluetooth Low Energy (BLE)</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Modern scales: DR Series, BTM modules, HM-10
                  </p>
                </Label>
              </div>

              <div className={`flex items-center space-x-3 p-2 rounded-md hover:bg-muted/80 transition-colors ${
                !classicAvailable && isNative ? 'opacity-50' : ''
              }`}>
                <RadioGroupItem 
                  value="classic" 
                  id="classic" 
                  disabled={!classicAvailable && isNative}
                />
                <Label htmlFor="classic" className="flex-1 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Bluetooth className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">Classic Bluetooth (SPP)</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Legacy scales: HC-05, HC-06, paired SPP devices
                  </p>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* BLE Scan Section */}
          {connectionType === 'ble' && (
            <div className="space-y-3">
              <Button 
                onClick={handleBleScan}
                disabled={isScanning || isConnecting}
                className="w-full"
                size="lg"
              >
                <BluetoothSearching className={`h-5 w-5 mr-2 ${isScanning ? 'animate-pulse' : ''}`} />
                {isScanning ? 'Scanning for Devices...' : 'Scan for BLE Scales'}
              </Button>
              
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 p-2 rounded-md">
                <HelpCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p>
                  A device picker will appear. Select your scale from the list. 
                  Device names and advertised names will be shown when available.
                </p>
              </div>
            </div>
          )}

          {/* Classic Paired Devices Section */}
          {connectionType === 'classic' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Paired Devices</Label>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={loadPairedDevices}
                  disabled={isLoadingDevices}
                >
                  <RefreshCw className={`h-4 w-4 ${isLoadingDevices ? 'animate-spin' : ''}`} />
                </Button>
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2 border rounded-lg p-2">
                {isLoadingDevices ? (
                  <div className="text-center py-4 text-muted-foreground">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading paired devices...
                  </div>
                ) : pairedDevices.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground">
                    <AlertCircle className="h-5 w-5 mx-auto mb-2" />
                    <p>No paired devices found</p>
                    <p className="text-xs mt-1">Pair your scale in Android Settings first</p>
                  </div>
                ) : (
                  pairedDevices.map((device) => (
                    <button
                      key={device.address}
                      onClick={() => handleClassicConnect(device)}
                      disabled={isConnecting}
                      className={`w-full p-3 text-left border rounded-lg transition-colors ${
                        selectedDevice?.address === device.address
                          ? 'bg-primary/10 border-primary'
                          : 'hover:bg-muted/50'
                      } ${isConnecting && selectedDevice?.address !== device.address ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className={`font-medium ${!device.name ? 'text-muted-foreground' : ''}`}>
                              {getDeviceDisplayName(device)}
                            </p>
                            {isKnownScaleType(device) && (
                              <CheckCircle2 className="h-4 w-4 text-accent-foreground" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {device.address}
                            {device.isResolving && ' • Resolving name...'}
                          </p>
                        </div>
                        {selectedDevice?.address === device.address && isConnecting && (
                          <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>

              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 p-2 rounded-md">
                <HelpCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <p>
                  All paired Bluetooth devices are shown, including unnamed ones. 
                  Recognized scale devices are marked with a ✓.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Raw Data Logging Info */}
        <div className="mt-2 text-xs text-center text-muted-foreground">
          Raw data logging enabled • Check console for 📡 prefixed logs
        </div>
      </DialogContent>
    </Dialog>
  );
};
