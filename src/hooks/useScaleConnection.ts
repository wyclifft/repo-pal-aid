/**
 * Hook for managing Bluetooth scale connections and live weight readings
 * Used by BuyProduceScreen and SellProduceScreen for inline weight display
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { 
  connectBluetoothScale, 
  quickReconnect, 
  getStoredDeviceInfo,
  isScaleConnected,
  type ScaleType 
} from '@/services/bluetooth';
import {
  isClassicBluetoothAvailable,
  getPairedScales,
  connectClassicScale,
  quickReconnectClassicScale,
  requestClassicBluetoothPermissions,
  type ClassicBluetoothDevice,
} from '@/services/bluetoothClassic';
import { useAppSettings } from '@/hooks/useAppSettings';

// Stable reading configuration
const STABLE_READING_THRESHOLD = 0.1; // Max variance in kg
const STABLE_READING_COUNT = 3; // Number of consecutive readings required
const STABLE_READING_TIMEOUT = 5000; // Max wait time in ms

interface UseScaleConnectionOptions {
  onWeightChange: (weight: number) => void;
  onEntryTypeChange: (entryType: 'scale' | 'manual') => void;
}

export const useScaleConnection = ({ onWeightChange, onEntryTypeChange }: UseScaleConnectionOptions) => {
  const [scaleConnected, setScaleConnected] = useState(() => isScaleConnected());
  const [scaleType, setScaleType] = useState<ScaleType>('Unknown');
  const [connectionType, setConnectionType] = useState<'ble' | 'classic-spp'>('ble');
  const [isConnecting, setIsConnecting] = useState(false);
  const [liveWeight, setLiveWeight] = useState(0);
  
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
  const { requireStableReading } = appSettings;
  
  // Check Classic BT availability on mount
  useEffect(() => {
    const checkClassicBt = async () => {
      const available = await isClassicBluetoothAvailable();
      setClassicBtAvailable(available);
    };
    checkClassicBt();
  }, []);
  
  // Listen for connection state changes
  useEffect(() => {
    const handleScaleChange = (e: CustomEvent<{ connected: boolean }>) => {
      setScaleConnected(e.detail.connected);
      if (!e.detail.connected) {
        setLiveWeight(0);
      }
    };
    
    window.addEventListener('scaleConnectionChange', handleScaleChange as EventListener);
    
    return () => {
      window.removeEventListener('scaleConnectionChange', handleScaleChange as EventListener);
    };
  }, []);

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
    setLiveWeight(newWeight);
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
      onEntryTypeChange('scale');
    }
  }, [requireStableReading, areReadingsStable, onWeightChange, onEntryTypeChange]);

  // Handle Classic BT weight update (without type parameter)
  const handleClassicWeightUpdate = useCallback((newWeight: number) => {
    handleScaleReading(newWeight, 'Classic-SPP');
  }, [handleScaleReading]);

  // Request Bluetooth permissions
  const requestPermissions = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return true;
    
    try {
      const granted = await requestClassicBluetoothPermissions();
      if (!granted) {
        toast.error('Bluetooth permissions required to connect to scale');
        return false;
      }
      return true;
    } catch (error) {
      console.warn('Permission request error:', error);
      return true; // Continue anyway on web
    }
  }, []);

  // Connect via BLE (scan for devices)
  const connectBLE = useCallback(async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;
    
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
      toast.error(result.error || 'Failed to connect scale');
    }
    setIsConnecting(false);
  }, [handleScaleReading, requireStableReading, isWaitingForStable, requestPermissions]);

  // Show paired devices dialog for Classic BT
  const showPairedDevicesDialog = useCallback(async () => {
    const hasPermission = await requestPermissions();
    if (!hasPermission) return;
    
    setIsLoadingPaired(true);
    setShowPairedDevices(true);
    
    try {
      const scales = await getPairedScales();
      setPairedDevices(scales);
      
      if (scales.length === 0) {
        toast.info('No paired scale devices found. Pair your scale in Android Bluetooth settings first.');
      }
    } catch (error) {
      console.error('Error getting paired devices:', error);
      toast.error('Failed to get paired devices');
    }
    
    setIsLoadingPaired(false);
  }, [requestPermissions]);

  // Connect to a specific Classic BT device
  const connectClassicDevice = useCallback(async (device: ClassicBluetoothDevice) => {
    setShowPairedDevices(false);
    setIsConnecting(true);
    stableReadingsRef.current = [];
    setStableReadingProgress(0);

    const result = await connectClassicScale(device, handleClassicWeightUpdate);

    if (result.success) {
      setScaleConnected(true);
      setScaleType('Classic-SPP');
      setConnectionType('classic-spp');
      toast.success(`Scale Connected via Classic BT: ${device.name} ✅`);
      
      if (requireStableReading) {
        stableTimeoutRef.current = setTimeout(() => {
          if (isWaitingForStable) {
            toast.warning('Scale reading unstable. Try keeping the container still.');
          }
        }, STABLE_READING_TIMEOUT);
      }
    } else {
      toast.error(result.error || 'Failed to connect to scale');
    }
    
    setIsConnecting(false);
  }, [handleClassicWeightUpdate, requireStableReading, isWaitingForStable]);

  // Quick reconnect to last used device
  const autoReconnect = useCallback(async () => {
    const storedDevice = getStoredDeviceInfo();
    if (storedDevice && !scaleConnected) {
      setIsConnecting(true);
      const result = await quickReconnect(storedDevice.deviceId, handleScaleReading);
      setIsConnecting(false);
      
      if (result.success) {
        setScaleConnected(true);
        setScaleType(result.type);
        setConnectionType('ble');
        toast.success(`Reconnected to ${storedDevice.deviceName}`);
      }
    }
  }, [handleScaleReading, scaleConnected]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (stableTimeoutRef.current) {
        clearTimeout(stableTimeoutRef.current);
      }
    };
  }, []);

  return {
    // Connection state
    scaleConnected,
    scaleType,
    connectionType,
    isConnecting,
    liveWeight,
    
    // Classic BT state
    classicBtAvailable,
    showPairedDevices,
    setShowPairedDevices,
    pairedDevices,
    isLoadingPaired,
    
    // Stable reading state
    isWaitingForStable,
    stableReadingProgress,
    lastRawWeight,
    requireStableReading,
    
    // Actions
    connectBLE,
    showPairedDevicesDialog,
    connectClassicDevice,
    autoReconnect,
    requestPermissions,
  };
};
