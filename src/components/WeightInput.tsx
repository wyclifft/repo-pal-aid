import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  type ScaleType, 
  type ConnectionType,
} from '@/services/bluetooth';
import {
  isClassicBluetoothAvailable,
} from '@/services/bluetoothClassic';
import { useAppSettings } from '@/hooks/useAppSettings';
import { toast } from 'sonner';
import { Scale, CheckCircle2, AlertCircle, Bluetooth, Lightbulb } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { BluetoothConnectionDialog } from '@/components/BluetoothConnectionDialog';

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
  
  // Bluetooth connection dialog state
  const [showConnectionDialog, setShowConnectionDialog] = useState(false);
  const [classicBtAvailable, setClassicBtAvailable] = useState(false);
  
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
    console.log(`📡 WeightInput handleScaleReading: ${newWeight} kg from ${type}`);
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
      } else {
        setIsWaitingForStable(true);
      }
    } else {
      // No stable reading required - use weight directly (including 0)
      onWeightChange(newWeight);
      setManualWeight(newWeight > 0 ? newWeight.toFixed(1) : '');
      onEntryTypeChange('scale');
    }
  }, [requireStableReading, areReadingsStable, onWeightChange, onEntryTypeChange]);

  // Handle connection from dialog
  const handleConnected = useCallback((type: 'ble' | 'classic-spp', sType: ScaleType) => {
    setScaleConnected(true);
    setScaleType(sType);
    setConnectionType(type === 'ble' ? 'ble' : 'classic-spp');
    stableReadingsRef.current = [];
    setStableReadingProgress(0);
    
    // Start stable reading timeout if enabled
    if (requireStableReading) {
      stableTimeoutRef.current = setTimeout(() => {
        if (isWaitingForStable) {
          toast.warning('Waiting for stable reading - keep container still');
        }
      }, STABLE_READING_TIMEOUT);
    }
  }, [requireStableReading, isWaitingForStable]);

  const handleManualWeight = () => {
    if (autoWeightOnly) {
      toast.error('Manual weight entry is disabled. Please use the digital scale.');
      return;
    }
    
    const manual = parseFloat(manualWeight);
    if (!isNaN(manual) && manual > 0) {
      onWeightChange(manual);
      onEntryTypeChange('manual');
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
    <div className="bg-card rounded-xl p-6 shadow-lg">
      <h3 className="text-xl font-bold mb-4 text-primary flex items-center gap-2">
        <Scale className="h-6 w-6" />
        {produceLabel} Weight
      </h3>

      {/* Scale Status Indicator */}
      {showScaleStatus && (
        <div className={`mb-4 p-3 rounded-lg border-2 ${
          isScaleReady 
            ? 'bg-green-50 border-green-500 dark:bg-green-950/30 dark:border-green-600' 
            : 'bg-amber-50 border-amber-500 dark:bg-amber-950/30 dark:border-amber-600'
        }`}>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              isScaleReady ? 'bg-green-500 animate-pulse' : 'bg-amber-500'
            }`} />
            <p className={`font-semibold ${
              isScaleReady ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'
            }`}>
              {isScaleReady ? '✓ Scale Ready - Clear for Next Collection' : '⚠ Scale Not Ready - Remove Container'}
            </p>
          </div>
        </div>
      )}

      {/* Stable Reading Progress (when stableopt=1) */}
      {requireStableReading && isWaitingForStable && (
        <div className="mb-4 p-3 rounded-lg border-2 bg-blue-50 border-blue-500 dark:bg-blue-950/30 dark:border-blue-600">
          <div className="flex items-center gap-2 mb-2">
            {stableReadingProgress < 100 ? (
              <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-pulse" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            )}
            <p className="font-semibold text-blue-700 dark:text-blue-400">
              {stableReadingProgress < 100 ? 'Waiting for stable reading...' : 'Reading stable!'}
            </p>
          </div>
          <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${stableReadingProgress}%` }}
            />
          </div>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            Raw: {lastRawWeight.toFixed(1)} Kg • Keep container still
          </p>
        </div>
      )}

      <div className="mb-6">
        <p className="text-3xl font-bold text-primary mb-4">
          Weight: {weight.toFixed(1)} Kg
        </p>
        
        {isBluetoothAvailable && (
          <div className="space-y-2">
            {/* Single Connect Button - Opens Type Selector Dialog */}
            <button
              onClick={() => setShowConnectionDialog(true)}
              className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <Bluetooth className="h-5 w-5" />
              Connect Bluetooth Scale
            </button>
            
            {/* Connection Status */}
            <div className="text-sm text-muted-foreground text-center space-y-1">
              <p className="flex items-center justify-center gap-1">
                Scale: {scaleConnected ? (
                  <span className="text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                    Connected ({scaleType}) via {connectionType === 'ble' ? 'BLE' : 'Classic BT'}
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                ) : (
                  'Not Connected'
                )}
              </p>
              {requireStableReading && <p className="text-xs">• Stable reading required</p>}
              {isNative && (
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <Lightbulb className="h-3 w-3" />
                  BLE: DR Series, BTM modules | Classic: Paired SPP devices
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className={`mb-6 p-4 rounded-lg ${autoWeightOnly ? 'bg-muted/60 opacity-60' : 'bg-muted/30'}`}>
        <p className="text-sm font-semibold text-foreground mb-2">
          Manual Weight Entry
          {autoWeightOnly && <span className="text-destructive ml-2">(Disabled)</span>}
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
            className={`flex-1 px-4 py-2 border border-input rounded-lg focus:outline-none focus:border-primary bg-background ${
              autoWeightOnly ? 'bg-muted cursor-not-allowed' : ''
            }`}
          />
          <button
            onClick={handleManualWeight}
            disabled={autoWeightOnly}
            className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
              autoWeightOnly 
                ? 'bg-muted text-muted-foreground cursor-not-allowed' 
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            Apply
          </button>
        </div>
        {autoWeightOnly && (
          <p className="text-xs text-destructive mt-2">
            Manual entry is disabled. Use the digital scale.
          </p>
        )}
      </div>

      {/* Bluetooth Connection Dialog with Type Selector */}
      <BluetoothConnectionDialog
        open={showConnectionDialog}
        onOpenChange={setShowConnectionDialog}
        onConnected={handleConnected}
        onWeightUpdate={handleScaleReading}
      />
    </div>
  );
};
