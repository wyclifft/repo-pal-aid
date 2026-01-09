import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  connectBluetoothScale, 
  type ScaleType, 
  type ConnectionType,
} from '@/services/bluetooth';
import {
  isClassicBluetoothAvailable,
  getPairedScales,
  connectClassicScale,
  type ClassicBluetoothDevice,
} from '@/services/bluetoothClassic';
import { useAppSettings } from '@/hooks/useAppSettings';
import { toast } from 'sonner';
import { Scale, CheckCircle2, AlertCircle, Bluetooth, BluetoothSearching, List } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface WeightInputProps {
  weight: number;
  onWeightChange: (weight: number) => void;
  currentUserRole: string;
  onEntryTypeChange: (entryType: 'scale' | 'manual') => void;
  lastSavedWeight: number;
  lastEntryType: 'scale' | 'manual';
}

// Stable reading configuration
const STABLE_READING_THRESHOLD = 0.1; // Max variance in kg
const STABLE_READING_COUNT = 3; // Number of consecutive readings required
const STABLE_READING_TIMEOUT = 5000; // Max wait time in ms

export const WeightInput = ({ weight, onWeightChange, currentUserRole, onEntryTypeChange, lastSavedWeight, lastEntryType }: WeightInputProps) => {
  const [manualWeight, setManualWeight] = useState('');
  const [scaleConnected, setScaleConnected] = useState(false);
  const [scaleType, setScaleType] = useState<ScaleType>('Unknown');
  const [connectionType, setConnectionType] = useState<ConnectionType>('ble');
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Classic Bluetooth state
  const [classicBtAvailable, setClassicBtAvailable] = useState(false);
  const [showPairedDevices, setShowPairedDevices] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<ClassicBluetoothDevice[]>([]);
  const [isLoadingPaired, setIsLoadingPaired] = useState(false);
  
  // Stable reading state
  const [isWaitingForStable, setIsWaitingForStable] = useState(false);
  const [stableReadingProgress, setStableReadingProgress] = useState(0);
  const [lastRawWeight, setLastRawWeight] = useState(0);
  const stableReadingsRef = useRef<number[]>([]);
  const stableTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get settings
  const appSettings = useAppSettings();
  const { requireStableReading, autoWeightOnly, produceLabel } = appSettings;
  
  // Check Classic BT availability on mount
  useEffect(() => {
    const checkClassicBt = async () => {
      const available = await isClassicBluetoothAvailable();
      setClassicBtAvailable(available);
    };
    checkClassicBt();
  }, []);
  
  // Log when settings change for debugging
  useEffect(() => {
    console.log('📱 WeightInput - autoWeightOnly:', autoWeightOnly, 'requireStableReading:', requireStableReading);
  }, [autoWeightOnly, requireStableReading]);

  // Check if readings are stable (within threshold)
  const areReadingsStable = useCallback((readings: number[]): boolean => {
    if (readings.length < STABLE_READING_COUNT) return false;
    const recentReadings = readings.slice(-STABLE_READING_COUNT);
    const min = Math.min(...recentReadings);
    const max = Math.max(...recentReadings);
    return (max - min) <= STABLE_READING_THRESHOLD && min > 0;
  }, []);

  // Handle weight reading from scale (BLE or Classic)
  const handleScaleReading = useCallback((newWeight: number, type?: ScaleType) => {
    setLastRawWeight(newWeight);
    if (type) setScaleType(type);
    
    if (requireStableReading && newWeight > 0) {
      // Add to readings buffer
      stableReadingsRef.current.push(newWeight);
      
      // Keep only recent readings
      if (stableReadingsRef.current.length > STABLE_READING_COUNT * 2) {
        stableReadingsRef.current = stableReadingsRef.current.slice(-STABLE_READING_COUNT);
      }
      
      // Update progress
      const progress = Math.min(100, (stableReadingsRef.current.length / STABLE_READING_COUNT) * 100);
      setStableReadingProgress(progress);
      
      // Check if stable
      if (areReadingsStable(stableReadingsRef.current)) {
        const stableWeight = stableReadingsRef.current.slice(-STABLE_READING_COUNT)
          .reduce((a, b) => a + b, 0) / STABLE_READING_COUNT;
        
        onWeightChange(parseFloat(stableWeight.toFixed(1)));
        setManualWeight(stableWeight.toFixed(1));
        onEntryTypeChange('scale');
        setIsWaitingForStable(false);
        setStableReadingProgress(100);
        stableReadingsRef.current = [];
        
        // Clear timeout
        if (stableTimeoutRef.current) {
          clearTimeout(stableTimeoutRef.current);
          stableTimeoutRef.current = null;
        }
        
        // Silent - no toast notification for stable reading
      } else {
        setIsWaitingForStable(true);
      }
    } else {
      // No stable reading required - use weight directly
      onWeightChange(newWeight);
      setManualWeight(newWeight.toFixed(1));
      onEntryTypeChange('scale');
    }
  }, [requireStableReading, areReadingsStable, onWeightChange, onEntryTypeChange]);

  // Handle Classic BT weight update (without type parameter)
  const handleClassicWeightUpdate = useCallback((newWeight: number) => {
    handleScaleReading(newWeight, 'Classic-SPP');
  }, [handleScaleReading]);

  // Connect via BLE (scan for devices)
  const handleConnectBLE = async () => {
    setIsConnecting(true);
    stableReadingsRef.current = [];
    setStableReadingProgress(0);
    
    const result = await connectBluetoothScale(handleScaleReading);

    if (result.success) {
      setScaleConnected(true);
      setScaleType(result.type);
      setConnectionType('ble');
      
      // Start stable reading timeout if enabled
      if (requireStableReading) {
        stableTimeoutRef.current = setTimeout(() => {
          if (isWaitingForStable) {
            // Silent - no toast notification
          }
        }, STABLE_READING_TIMEOUT);
      }
    }
    setIsConnecting(false);
  };

  // Show paired devices dialog for Classic BT
  const handleShowPairedDevices = async () => {
    setIsLoadingPaired(true);
    setShowPairedDevices(true);
    
    try {
      const scales = await getPairedScales();
      setPairedDevices(scales);
      
      // Silent - no toast notification for empty device list
    } catch (error) {
      console.error('Error getting paired devices:', error);
    }
    
    setIsLoadingPaired(false);
  };

  // Connect to a specific Classic BT device
  const handleConnectClassicDevice = async (device: ClassicBluetoothDevice) => {
    setShowPairedDevices(false);
    setIsConnecting(true);
    stableReadingsRef.current = [];
    setStableReadingProgress(0);

    const result = await connectClassicScale(device, handleClassicWeightUpdate);

    if (result.success) {
      setScaleConnected(true);
      setScaleType('Classic-SPP');
      setConnectionType('classic-spp');
      
      if (requireStableReading) {
        stableTimeoutRef.current = setTimeout(() => {
          if (isWaitingForStable) {
            // Silent - no toast notification
          }
        }, STABLE_READING_TIMEOUT);
      }
    }
    
    setIsConnecting(false);
  };

  const handleManualWeight = () => {
    if (autoWeightOnly) {
      toast.error('Manual weight entry is disabled. Please use the digital scale.');
      return;
    }
    
    const manual = parseFloat(manualWeight);
    if (!isNaN(manual) && manual > 0) {
      onWeightChange(manual);
      onEntryTypeChange('manual');
      // Silent - no toast notification for manual weight
    } else {
      toast.error('Enter valid weight');
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (stableTimeoutRef.current) {
        clearTimeout(stableTimeoutRef.current);
      }
    };
  }, []);

  // Check if Bluetooth is available (Web Bluetooth or Capacitor native)
  const isBluetoothAvailable = Capacitor.isNativePlatform() || ('bluetooth' in navigator);
  const isNative = Capacitor.isNativePlatform();

  // Determine scale status for visual feedback
  const isScaleReady = weight === 0 && lastSavedWeight > 0;
  const showScaleStatus = lastSavedWeight > 0;

  return (
    <div className="bg-white rounded-xl p-6 shadow-lg">
      <h3 className="text-xl font-bold mb-4 text-[#667eea] flex items-center gap-2">
        <Scale className="h-6 w-6" />
        {produceLabel} Weight
      </h3>

      {/* Scale Status Indicator */}
      {showScaleStatus && (
        <div className={`mb-4 p-3 rounded-lg border-2 ${
          isScaleReady 
            ? 'bg-green-50 border-green-500' 
            : 'bg-amber-50 border-amber-500'
        }`}>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              isScaleReady ? 'bg-green-500 animate-pulse' : 'bg-amber-500'
            }`} />
            <p className={`font-semibold ${
              isScaleReady ? 'text-green-700' : 'text-amber-700'
            }`}>
              {isScaleReady ? '✓ Scale Ready - Clear for Next Collection' : '⚠ Scale Not Ready - Remove Container'}
            </p>
          </div>
        </div>
      )}

      {/* Stable Reading Progress (when stableopt=1) */}
      {requireStableReading && isWaitingForStable && (
        <div className="mb-4 p-3 rounded-lg border-2 bg-blue-50 border-blue-500">
          <div className="flex items-center gap-2 mb-2">
            {stableReadingProgress < 100 ? (
              <AlertCircle className="h-5 w-5 text-blue-600 animate-pulse" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            )}
            <p className="font-semibold text-blue-700">
              {stableReadingProgress < 100 ? 'Waiting for stable reading...' : 'Reading stable!'}
            </p>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${stableReadingProgress}%` }}
            />
          </div>
          <p className="text-xs text-blue-600 mt-1">
            Raw: {lastRawWeight.toFixed(1)} Kg • Keep container still
          </p>
        </div>
      )}

      <div className="mb-6">
        <p className="text-3xl font-bold text-[#667eea] mb-4">
          Weight: {weight.toFixed(1)} Kg
        </p>
        
        {isBluetoothAvailable && (
          <div className="space-y-2">
            {/* BLE Connection Button */}
            <button
              onClick={handleConnectBLE}
              disabled={isConnecting}
              className="w-full py-3 bg-[#667eea] text-white rounded-lg font-semibold hover:bg-[#5568d3] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <BluetoothSearching className="h-5 w-5" />
              {isConnecting ? 'Connecting...' : 'Connect via BLE (Scan)'}
            </button>
            
            {/* Classic BT Button - Only show on native with availability */}
            {isNative && (
              <button
                onClick={handleShowPairedDevices}
                disabled={isConnecting || isLoadingPaired}
                className="w-full py-3 bg-gray-700 text-white rounded-lg font-semibold hover:bg-gray-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <List className="h-5 w-5" />
                {isLoadingPaired ? 'Loading...' : 'Connect via Classic BT (Paired)'}
              </button>
            )}
            
            {/* Connection Status */}
            <div className="text-sm text-gray-600 text-center space-y-1">
              <p>
                Scale: {scaleConnected ? (
                  <span className="text-green-600 font-medium">
                    Connected ({scaleType}) via {connectionType === 'ble' ? 'BLE' : 'Classic BT'} ✅
                  </span>
                ) : (
                  'Not Connected'
                )}
              </p>
              {requireStableReading && <p className="text-xs">• Stable reading required</p>}
              {isNative && (
                <p className="text-xs text-gray-500">
                  💡 BLE: DR Series, BTM modules | Classic BT: Paired SPP devices
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className={`mb-6 p-4 rounded-lg ${autoWeightOnly ? 'bg-gray-100 opacity-60' : 'bg-gray-50'}`}>
        <p className="text-sm font-semibold text-gray-700 mb-2">
          Manual Weight Entry
          {autoWeightOnly && <span className="text-red-500 ml-2">(Disabled)</span>}
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            pattern="[0-9]*\.?[0-9]*"
            placeholder="Manual Weight (Kg)"
            step="0.1"
            value={manualWeight}
            onChange={(e) => setManualWeight(e.target.value)}
            disabled={autoWeightOnly}
            className={`flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-[#667eea] ${
              autoWeightOnly ? 'bg-gray-200 cursor-not-allowed' : ''
            }`}
          />
          <button
            onClick={handleManualWeight}
            disabled={autoWeightOnly}
            className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
              autoWeightOnly 
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
            }`}
          >
            Apply
          </button>
        </div>
        {autoWeightOnly && (
          <p className="text-xs text-red-500 mt-2">
            Manual entry is disabled. Use the digital scale.
          </p>
        )}
      </div>

      {/* Paired Devices Dialog */}
      <Dialog open={showPairedDevices} onOpenChange={setShowPairedDevices}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bluetooth className="h-5 w-5" />
              Paired Scale Devices
            </DialogTitle>
            <DialogDescription>
              Select a paired Bluetooth scale to connect via Classic SPP
            </DialogDescription>
          </DialogHeader>
          
          <div className="max-h-80 overflow-y-auto">
            {isLoadingPaired ? (
              <div className="text-center py-8 text-gray-500">
                Loading paired devices...
              </div>
            ) : pairedDevices.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No paired scale devices found.</p>
                <p className="text-sm mt-2">
                  Pair your scale in Android Bluetooth settings first.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {pairedDevices.map((device) => (
                  <button
                    key={device.address}
                    onClick={() => handleConnectClassicDevice(device)}
                    className="w-full p-3 text-left border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <p className="font-medium">{device.name || 'Unknown Device'}</p>
                    <p className="text-xs text-gray-500">{device.address}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
