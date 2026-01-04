import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  connectBluetoothScale, 
  type ScaleType, 
  type ConnectionType,
  isClassicBluetoothAvailable,
  getPairedScales,
  connectClassicScale,
  isClassicScaleConnected,
  type ClassicBluetoothDevice,
} from '@/services/bluetooth';
import { useAppSettings } from '@/hooks/useAppSettings';
import { toast } from 'sonner';
import { Scale, CheckCircle2, AlertCircle, Bluetooth, Radio, List } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import {
  Dialog,
  DialogContent,
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
  const [showDeviceSelector, setShowDeviceSelector] = useState(false);
  const [pairedDevices, setPairedDevices] = useState<ClassicBluetoothDevice[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [classicBtAvailable, setClassicBtAvailable] = useState(false);
  
  // Stable reading state
  const [isWaitingForStable, setIsWaitingForStable] = useState(false);
  const [stableReadingProgress, setStableReadingProgress] = useState(0);
  const [lastRawWeight, setLastRawWeight] = useState(0);
  const stableReadingsRef = useRef<number[]>([]);
  const stableTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get psettings - these values update automatically when psettings change
  const appSettings = useAppSettings();
  const { requireStableReading, autoWeightOnly, produceLabel } = appSettings;
  
  // Check if Classic Bluetooth is available on mount
  useEffect(() => {
    const checkClassicBt = async () => {
      if (Capacitor.isNativePlatform()) {
        const available = await isClassicBluetoothAvailable();
        setClassicBtAvailable(available);
        console.log('📡 Classic Bluetooth available:', available);
      }
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

  // Handle weight reading from scale (both BLE and Classic)
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
        
        toast.success('Stable reading captured');
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

  // Handle Classic Bluetooth weight reading (no type parameter)
  const handleClassicWeightReading = useCallback((newWeight: number) => {
    handleScaleReading(newWeight, 'Classic-SPP');
  }, [handleScaleReading]);

  // Connect via BLE
  const handleConnectBLE = async () => {
    setIsConnecting(true);
    stableReadingsRef.current = [];
    setStableReadingProgress(0);
    
    const result = await connectBluetoothScale(handleScaleReading);

    if (result.success) {
      setScaleConnected(true);
      setScaleType(result.type);
      setConnectionType('ble');
      toast.success(`Scale Connected via BLE (${result.type}) ✅`);
      
      // Start stable reading timeout if enabled
      if (requireStableReading) {
        stableTimeoutRef.current = setTimeout(() => {
          if (isWaitingForStable) {
            toast.warning('Scale reading unstable. Try keeping the container still.');
          }
        }, STABLE_READING_TIMEOUT);
      }
    } else {
      toast.error(result.error || 'Failed to connect via BLE');
    }
    setIsConnecting(false);
  };

  // Load paired devices for Classic Bluetooth
  const loadPairedDevices = async () => {
    setIsLoadingDevices(true);
    try {
      const devices = await getPairedScales();
      setPairedDevices(devices);
      
      if (devices.length === 0) {
        toast.info('No paired scale devices found. Please pair your scale in Android Bluetooth settings first.');
      }
    } catch (error) {
      console.error('Failed to load paired devices:', error);
      toast.error('Failed to load paired devices');
    }
    setIsLoadingDevices(false);
  };

  // Show device selector for Classic Bluetooth
  const handleShowClassicDevices = async () => {
    await loadPairedDevices();
    setShowDeviceSelector(true);
  };

  // Connect to a Classic Bluetooth device
  const handleConnectClassicDevice = async (device: ClassicBluetoothDevice) => {
    setShowDeviceSelector(false);
    setIsConnecting(true);
    stableReadingsRef.current = [];
    setStableReadingProgress(0);
    
    const result = await connectClassicScale(device, handleClassicWeightReading);

    if (result.success) {
      setScaleConnected(true);
      setScaleType('Classic-SPP');
      setConnectionType('classic-spp');
      toast.success(`Connected to ${device.name} via Classic Bluetooth ✅`);
      
      // Start stable reading timeout if enabled
      if (requireStableReading) {
        stableTimeoutRef.current = setTimeout(() => {
          if (isWaitingForStable) {
            toast.warning('Scale reading unstable. Try keeping the container still.');
          }
        }, STABLE_READING_TIMEOUT);
      }
    } else {
      toast.error(result.error || 'Failed to connect via Classic Bluetooth');
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
      toast.success('Manual weight applied');
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

  // Determine scale status for visual feedback (now applies to both scale and manual)
  const isScaleReady = weight === 0 && lastSavedWeight > 0;
  const isScaleNotReady = weight > 0 && lastSavedWeight > 0;
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
              <Bluetooth className="h-5 w-5" />
              {isConnecting ? 'Connecting...' : 'Connect via BLE (Scan)'}
            </button>
            
            {/* Classic Bluetooth Button (Native only) */}
            {isNative && classicBtAvailable && (
              <button
                onClick={handleShowClassicDevices}
                disabled={isConnecting || isLoadingDevices}
                className="w-full py-3 bg-[#48bb78] text-white rounded-lg font-semibold hover:bg-[#38a169] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Radio className="h-5 w-5" />
                {isLoadingDevices ? 'Loading Devices...' : 'Connect via Classic BT (Paired)'}
              </button>
            )}
            
            {/* Connection Status */}
            <div className="text-sm text-gray-600 text-center space-y-1">
              <p>
                Scale: {scaleConnected ? (
                  <span className="text-green-600 font-medium">
                    Connected ({scaleType}) via {connectionType === 'classic-spp' ? 'Classic BT' : 'BLE'} ✅
                  </span>
                ) : (
                  'Not Connected'
                )}
              </p>
              {requireStableReading && <p className="text-xs">• Stable reading required</p>}
              {isNative && (
                <p className="text-xs text-gray-500">
                  💡 DR Series scales (DR 10-150) work best with Classic Bluetooth
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

      {/* Classic Bluetooth Device Selector Dialog */}
      <Dialog open={showDeviceSelector} onOpenChange={setShowDeviceSelector}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <List className="h-5 w-5" />
              Select Paired Scale
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {pairedDevices.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Radio className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">No paired scale devices found</p>
                <p className="text-sm mt-2">
                  Please pair your DR series scale in Android Bluetooth settings first, then try again.
                </p>
                <button
                  onClick={loadPairedDevices}
                  className="mt-4 px-4 py-2 bg-[#667eea] text-white rounded-lg text-sm"
                >
                  Refresh List
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-3">
                  Found {pairedDevices.length} paired device(s). Tap to connect:
                </p>
                {pairedDevices.map((device) => (
                  <button
                    key={device.address}
                    onClick={() => handleConnectClassicDevice(device)}
                    className="w-full p-4 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-[#667eea] transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <Radio className="h-6 w-6 text-[#48bb78]" />
                      <div>
                        <p className="font-medium text-gray-900">{device.name}</p>
                        <p className="text-xs text-gray-500">{device.address}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
