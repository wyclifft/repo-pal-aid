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
  resubscribeScaleNotifications,
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
  // Initialize from actual bluetooth state - recheck on each render to catch late connections
  const [scaleConnected, setScaleConnected] = useState(() => {
    const connected = isScaleConnected();
    console.log(`🔌 useScaleConnection init: scaleConnected=${connected}`);
    return connected;
  });
  const [scaleType, setScaleType] = useState<ScaleType>('Unknown');
  const [connectionType, setConnectionType] = useState<'ble' | 'classic-spp'>('ble');
  const [isConnecting, setIsConnecting] = useState(false);
  const [liveWeight, setLiveWeight] = useState(0);
  
  // Re-sync connection state on mount in case scale was connected elsewhere
  useEffect(() => {
    const currentlyConnected = isScaleConnected();
    console.log(`🔄 useScaleConnection mount check: scaleConnected=${currentlyConnected}`);
    if (currentlyConnected !== scaleConnected) {
      setScaleConnected(currentlyConnected);
    }
  }, []);
  
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

  // Use refs to avoid stale closures in event handlers
  const onWeightChangeRef = useRef(onWeightChange);
  const onEntryTypeChangeRef = useRef(onEntryTypeChange);
  
  useEffect(() => {
    onWeightChangeRef.current = onWeightChange;
    onEntryTypeChangeRef.current = onEntryTypeChange;
  }, [onWeightChange, onEntryTypeChange]);

  // Listen for global weight updates from any scale connection
  useEffect(() => {
    const handleWeightUpdate = (e: CustomEvent<{ weight: number; scaleType: ScaleType }>) => {
      const { weight, scaleType: type } = e.detail;
      console.log(`🎯 useScaleConnection received scaleWeightUpdate event: ${weight} kg from ${type}`);
      setLiveWeight(weight);
      setScaleType(type);
      setScaleConnected(true);
      
      // Always update parent via callback when scale is connected
      // Use refs to avoid stale closures
      console.log(`🎯 useScaleConnection calling onWeightChangeRef.current(${weight})`);
      onWeightChangeRef.current(weight);
      onEntryTypeChangeRef.current('scale');
    };
    
    window.addEventListener('scaleWeightUpdate', handleWeightUpdate as EventListener);
    console.log('📡 useScaleConnection: Now listening for scaleWeightUpdate events');
    
    return () => {
      console.log('📡 useScaleConnection: Removed scaleWeightUpdate listener');
      window.removeEventListener('scaleWeightUpdate', handleWeightUpdate as EventListener);
    };
  }, []); // Empty deps - handlers use refs

  // Check if readings are stable (within threshold)
  const areReadingsStable = useCallback((readings: number[]): boolean => {
    if (readings.length < STABLE_READING_COUNT) return false;
    const recentReadings = readings.slice(-STABLE_READING_COUNT);
    const min = Math.min(...recentReadings);
    const max = Math.max(...recentReadings);
    return (max - min) <= STABLE_READING_THRESHOLD && min > 0;
  }, []);

  // Handle weight reading from scale (BLE or Classic)
  // Uses refs to avoid stale closures
  const handleScaleReading = useCallback((newWeight: number, type?: ScaleType) => {
    console.log(`🎯 handleScaleReading: ${newWeight} kg, type: ${type}`);
    setLastRawWeight(newWeight);
    setLiveWeight(newWeight);
    if (type) setScaleType(type);
    
    // Always update for 0 weight to show empty scale state
    if (newWeight === 0) {
      onWeightChangeRef.current(0);
      onEntryTypeChangeRef.current('scale');
      setIsWaitingForStable(false);
      setStableReadingProgress(0);
      stableReadingsRef.current = [];
      return;
    }
    
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
        
        onWeightChangeRef.current(parseFloat(stableWeight.toFixed(1)));
        onEntryTypeChangeRef.current('scale');
        setIsWaitingForStable(false);
        setStableReadingProgress(100);
        stableReadingsRef.current = [];
        
        // Clear timeout
        if (stableTimeoutRef.current) {
          clearTimeout(stableTimeoutRef.current);
          stableTimeoutRef.current = null;
        }
        
        // Silent - no toast notification
      } else {
        setIsWaitingForStable(true);
      }
    } else {
      // No stable reading required - use weight directly
      onWeightChangeRef.current(newWeight);
      onEntryTypeChangeRef.current('scale');
    }
  }, [requireStableReading, areReadingsStable]);

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
    
    try {
      const result = await connectBluetoothScale(handleScaleReading);

      if (result.success) {
        setScaleConnected(true);
        setScaleType(result.type);
        setConnectionType('ble');
        toast.success(`Scale connected: ${result.type}`);
        
        // Start stable reading timeout if enabled
        if (requireStableReading) {
          stableTimeoutRef.current = setTimeout(() => {
            if (isWaitingForStable) {
              toast.warning('Waiting for stable reading...');
            }
          }, STABLE_READING_TIMEOUT);
        }
      } else {
        // Provide helpful error message with suggestion
        const errorMsg = result.error || 'Failed to connect to scale';
        if (errorMsg.includes('notification') || errorMsg.includes('CCCD')) {
          toast.error('Scale notification setup failed. Try Classic Bluetooth from Settings.');
        } else {
          toast.error(errorMsg);
        }
      }
    } catch (error: any) {
      console.error('BLE connection error:', error);
      const errorMsg = error?.message || String(error);
      
      // Provide actionable error messages
      if (errorMsg.includes('notification') || errorMsg.includes('CCCD') || errorMsg.includes('Settings')) {
        toast.error('BLE notification failed. Try using Classic Bluetooth connection instead.', {
          duration: 5000,
        });
      } else if (errorMsg.includes('cancelled') || errorMsg.includes('canceled')) {
        // User cancelled - no toast needed
      } else {
        toast.error('Connection failed. Please try again.');
      }
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
      
      // Silent - no toast notification for empty device list
    } catch (error) {
      console.error('Error getting paired devices:', error);
    }
    
    setIsLoadingPaired(false);
  }, [requestPermissions]);

  // Connect to a specific Classic BT device
  const connectClassicDevice = useCallback(async (device: ClassicBluetoothDevice) => {
    setShowPairedDevices(false);
    setIsConnecting(true);
    stableReadingsRef.current = [];
    setStableReadingProgress(0);

    try {
      const result = await connectClassicScale(device, handleClassicWeightUpdate);

      if (result.success) {
        setScaleConnected(true);
        setScaleType('Classic-SPP');
        setConnectionType('classic-spp');
        toast.success(`Connected to ${device.name}`);
        
        if (requireStableReading) {
          stableTimeoutRef.current = setTimeout(() => {
            if (isWaitingForStable) {
              toast.warning('Waiting for stable reading...');
            }
          }, STABLE_READING_TIMEOUT);
        }
      } else {
        toast.error(result.error || 'Failed to connect');
      }
    } catch (error) {
      console.error('Classic BT connection error:', error);
      toast.error('Classic BT connection failed');
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
      }
    }
  }, [handleScaleReading, scaleConnected]);

  // Force re-subscribe to BLE notifications (when weight stops flowing)
  const forceResubscribe = useCallback(async () => {
    if (!scaleConnected || connectionType !== 'ble') {
      toast.error('No BLE scale connected');
      return;
    }
    
    setIsConnecting(true);
    toast.info('Re-subscribing to scale notifications...');
    
    const result = await resubscribeScaleNotifications(handleScaleReading);
    
    setIsConnecting(false);
    
    if (result.success) {
      toast.success('Notifications restored');
    } else {
      toast.error(result.error || 'Resubscribe failed');
    }
  }, [scaleConnected, connectionType, handleScaleReading]);

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
    forceResubscribe,
    requestPermissions,
  };
};
