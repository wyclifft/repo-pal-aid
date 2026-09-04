/**
 * Hook for managing Bluetooth scale connections and live weight readings
 * Used by BuyProduceScreen and SellProduceScreen for inline weight display
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { BleClient, BleDevice, numberToUUID } from '@capacitor-community/bluetooth-le';
import { toast } from 'sonner';
import { 
  connectBluetoothScale, 
  quickReconnect, 
  getStoredDeviceInfo,
  clearStoredDevice,
  isBleHalfOfDualModeScale,
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
  isClassicPrinterConnected,
  getCurrentClassicPrinterInfo,
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

// Request Bluetooth permissions
export const requestPermissions = async (): Promise<boolean> => {
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
};

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

  // v2.12.56: Logic-level stable reading state (prevents React render race conditions)
  const isWaitingForStableRef = useRef(false);
  const [isWaitingForStable, setIsWaitingForStable] = useState(false);

  // Sync state and ref
  const updateWaitingState = useCallback((waiting: boolean) => {
    isWaitingForStableRef.current = waiting;
    setIsWaitingForStable(waiting);
  }, []);

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
  const [stableReadingProgress, setStableReadingProgress] = useState(0);
  const [lastRawWeight, setLastRawWeight] = useState(0);
  const stableReadingsRef = useRef<number[]>([]);
  const lastStableWeightRef = useRef<number | null>(null);
  const stableTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
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
      const { weight: newWeight, scaleType: type } = e.detail;
      console.log(`🎯 useScaleConnection received scaleWeightUpdate event: ${newWeight} kg from ${type}`);

      if (!isScaleConnected()) {
        console.log('🚫 Ignoring scaleWeightUpdate — no scale currently connected (likely printer cross-talk)');
        return;
      }

      // Use the stabilized reading logic
      handleScaleReading(newWeight, type);
    };
    
    window.addEventListener('scaleWeightUpdate', handleWeightUpdate as EventListener);
    console.log('📡 useScaleConnection: Now listening for scaleWeightUpdate events');
    
    return () => {
      console.log('📡 useScaleConnection: Removed scaleWeightUpdate listener');
      window.removeEventListener('scaleWeightUpdate', handleWeightUpdate as EventListener);
    };
  }, [handleScaleReading]);

  // Check if readings are stable (within threshold)
  const areReadingsStable = useCallback((readings: number[]): boolean => {
    if (readings.length < STABLE_READING_COUNT) return false;
    const recentReadings = readings.slice(-STABLE_READING_COUNT);
    const min = Math.min(...recentReadings);
    const max = Math.max(...recentReadings);
    return (max - min) <= STABLE_READING_THRESHOLD && min >= -50;
  }, []);

  // Handle weight reading from scale (BLE or Classic)
  // Uses refs to avoid stale closures
  const handleScaleReading = useCallback((newWeight: number, type?: ScaleType) => {
    const isWaiting = isWaitingForStableRef.current;
    console.log(`🎯 handleScaleReading: ${newWeight} kg, type: ${type}, waitingForStable: ${isWaiting}`);
    setLastRawWeight(newWeight);
    setLiveWeight(newWeight);
    if (type) setScaleType(type);
    
    // Always update for 0 weight to show empty scale state
    if (newWeight === 0) {
      onWeightChangeRef.current(0);
      onEntryTypeChangeRef.current('scale');
      updateWaitingState(false);
      setStableReadingProgress(0);
      stableReadingsRef.current = [];
      lastStableWeightRef.current = 0;

      // Broadcast that we have reached stability (0 is stable)
      window.dispatchEvent(new CustomEvent('scaleStabilityChange', { detail: { isStable: true, weight: 0 } }));
      return;
    }
    
    if (requireStableReading && newWeight !== 0) {
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
        
        // v2.12.61: Use consistent rounding
        const finalWeight = Math.round(stableWeight * 10) / 10;
        
        // Only update and broadcast if it's the first stable reading OR weight changed significantly
        if (lastStableWeightRef.current === null || Math.abs(finalWeight - lastStableWeightRef.current) > 0.01) {
          console.log(`⚖️ Stability reached: ${finalWeight} kg`);
          onWeightChangeRef.current(finalWeight);
          onEntryTypeChangeRef.current('scale');
          updateWaitingState(false);
          setStableReadingProgress(100);
          lastStableWeightRef.current = finalWeight;

          // Clear timeout
          if (stableTimeoutRef.current) {
            clearTimeout(stableTimeoutRef.current);
            stableTimeoutRef.current = null;
          }

          // Broadcast that we have reached stability
          window.dispatchEvent(new CustomEvent('scaleStabilityChange', { detail: { isStable: true, weight: finalWeight } }));
        } else {
          // Weight is already stable and hasn't changed enough to re-broadcast
          updateWaitingState(false);
          setStableReadingProgress(100);
        }
      } else {
        // Readings are not stable - check if we were previously stable
        const isSignificantlyDifferent = lastStableWeightRef.current === null ||
          Math.abs(newWeight - lastStableWeightRef.current) > STABLE_READING_THRESHOLD;

        if (isSignificantlyDifferent) {
          if (!isWaiting) {
            console.log(`⚖️ Weight fluctuating: ${newWeight} kg (last stable: ${lastStableWeightRef.current})`);
            updateWaitingState(true);
            // Reset buffer and last stable weight so we can re-evaluate
            stableReadingsRef.current = [newWeight]; // Keep current as first new reading
            lastStableWeightRef.current = null;
            // Broadcast that we are now fluctuating
            window.dispatchEvent(new CustomEvent('scaleStabilityChange', { detail: { isStable: false, weight: newWeight } }));
          }
        }
      }
    } else {
      // No stable reading required OR weight is <= 0 - use weight directly
      // v2.12.61: Propagate negative values for display (e.g. tared scale with container removed)
      onWeightChangeRef.current(newWeight);
      onEntryTypeChangeRef.current('scale');

      // If weight is <= 0, we are definitely not waiting for a stable capture reading
      if (newWeight <= 0) {
        updateWaitingState(false);
        setStableReadingProgress(0);
        stableReadingsRef.current = [];
        lastStableWeightRef.current = newWeight;
      }
    }
  }, [requireStableReading, areReadingsStable, updateWaitingState]);

  // Handle Classic BT weight update (without type parameter)
  const handleClassicWeightUpdate = useCallback((newWeight: number) => {
    handleScaleReading(newWeight, 'Classic-SPP');
  }, [handleScaleReading]);

  // Request Bluetooth permissions (local wrapper for hook consistency)
  const handleRequestPermissions = useCallback(async () => {
    return await requestPermissions();
  }, []);

  // Ensure Bluetooth is enabled
  const ensureBluetoothEnabled = useCallback(async (): Promise<boolean> => {
    if (!Capacitor.isNativePlatform()) return true;
    
    try {
      await BleClient.initialize();
      // Check if Bluetooth is enabled
      const isEnabled = await BleClient.isEnabled();
      if (!isEnabled) {
        console.log('📡 Bluetooth is disabled, prompting to enable...');
        // On Android, this will show a system prompt
        await BleClient.enable();
        // Wait a bit for it to actually turn on
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await BleClient.isEnabled();
      }
      return true;
    } catch (error) {
      console.warn('⚠️ Failed to enable Bluetooth:', error);
      return false;
    }
  }, []);

  // Connect via BLE (scan for devices)
  const connectBLE = useCallback(async () => {
    // 1. Ensure BT is enabled
    const btEnabled = await ensureBluetoothEnabled();
    if (!btEnabled) {
      toast.error('Please turn on Bluetooth to connect to the scale');
      return;
    }

    const hasPermission = await handleRequestPermissions();
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
  }, [handleScaleReading, requireStableReading, isWaitingForStable, handleRequestPermissions]);

  // Show paired devices dialog for Classic BT
  const showPairedDevicesDialog = useCallback(async () => {
    const hasPermission = await handleRequestPermissions();
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
  }, [handleRequestPermissions]);

  // Connect to a specific Classic BT device
  const connectClassicDevice = useCallback(async (device: ClassicBluetoothDevice) => {
    // 1. Ensure BT is enabled
    const btEnabled = await ensureBluetoothEnabled();
    if (!btEnabled) {
      toast.error('Please turn on Bluetooth to connect to the scale');
      return;
    }

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
    if (!storedDevice || scaleConnected) return;

    // v2.10.99: Never reconnect to the BLE half of a dual-mode scale
    // (e.g. HC-04BLE). That port silently pairs but never streams weight.
    // Clear it once so the manager stops retrying every 2-4 seconds.
    if (isBleHalfOfDualModeScale(storedDevice.deviceName)) {
      console.warn(`🚫 [v2.10.99] Skipping autoReconnect — "${storedDevice.deviceName}" is the BLE half of a dual-mode scale. Pair the SPP port via Settings → Classic BT.`);
      clearStoredDevice();
      return;
    }

    // Ensure Bluetooth is enabled before attempting auto-reconnect
    // Note: We don't toast error here to avoid annoying the user on every mount,
    // but we check the state so it doesn't fail silently with a cryptic GATT error.
    if (Capacitor.isNativePlatform()) {
      const isEnabled = await BleClient.isEnabled();
      if (!isEnabled) {
        console.log('📡 autoReconnect skipped: Bluetooth is disabled');
        return;
      }
    }


    // v2.10.69: Guard for integrated POS hardware. If a Classic printer is
    // currently connected and its address matches the stored "scale" device id
    // (which can happen when the same controller exposes both roles), do NOT
    // attempt to reopen the socket as a scale — that would fire
    // scaleConnectionChange(true) and turn the Dashboard scale indicator green
    // even though no real scale is paired.
    if (isClassicPrinterConnected()) {
      const printerInfo = getCurrentClassicPrinterInfo();
      const storedId = (storedDevice.deviceId || '').toUpperCase();
      const printerAddr = (printerInfo?.address || '').toUpperCase();
      if (printerInfo && storedId && printerAddr && storedId === printerAddr) {
        console.warn(
          `🚫 [v2.10.69] Skipping scale autoReconnect — stored scale id (${storedId}) matches connected printer (${printerAddr}).`
        );
        return;
      }
    }

    setIsConnecting(true);
    const result = await quickReconnect(storedDevice.deviceId, handleScaleReading);
    setIsConnecting(false);

    if (result.success) {
      setScaleConnected(true);
      setScaleType(result.type);
      setConnectionType('ble');
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
    requestPermissions: handleRequestPermissions,
  };
};
