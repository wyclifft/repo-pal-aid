/**
 * Permission request utilities for Bluetooth and Camera
 * Ensures permissions are requested before use
 */

import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { requestClassicBluetoothPermissions } from '@/services/bluetoothClassic';

// Lazy load Capacitor Camera to avoid issues on web
const loadCapacitorCamera = async () => {
  if (Capacitor.isNativePlatform()) {
    const { Camera } = await import('@capacitor/camera');
    return Camera;
  }
  return null;
};

/**
 * Request all required permissions upfront
 * Call this on app startup or when entering features that need these permissions
 */
export const requestAllPermissions = async (): Promise<{
  bluetooth: boolean;
  camera: boolean;
}> => {
  const results = {
    bluetooth: false,
    camera: false,
  };

  // Request Bluetooth permissions (native only)
  if (Capacitor.isNativePlatform()) {
    try {
      results.bluetooth = await requestClassicBluetoothPermissions();
      if (!results.bluetooth) {
        console.log('ℹ️ Bluetooth permissions not granted - scale features may be limited');
      }
    } catch (error) {
      console.warn('⚠️ Bluetooth permission request failed:', error);
    }
  } else {
    // On web, Web Bluetooth API handles permissions on-demand
    results.bluetooth = true;
  }

  // Request Camera permissions
  if (Capacitor.isNativePlatform()) {
    // Use Capacitor Camera plugin for native
    try {
      const Camera = await loadCapacitorCamera();
      if (Camera) {
        const permStatus = await Camera.requestPermissions({ permissions: ['camera'] });
        console.log('📷 Camera permission status:', permStatus);
        results.camera = permStatus.camera === 'granted' || permStatus.camera === 'limited';
        if (!results.camera) {
          console.log('ℹ️ Camera permission not granted');
        }
      }
    } catch (error) {
      console.warn('⚠️ Native camera permission request failed:', error);
    }
  } else {
    // Web - use getUserMedia
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      // Immediately stop the stream - we just needed to trigger the permission prompt
      stream.getTracks().forEach(track => track.stop());
      results.camera = true;
    } catch (error: any) {
      if (error.name === 'NotAllowedError') {
        console.log('ℹ️ Camera permission denied');
      } else if (error.name === 'NotFoundError') {
        console.log('ℹ️ No camera found on device');
        results.camera = true; // Not an error, just no camera
      } else {
        console.warn('⚠️ Camera permission request failed:', error);
      }
    }
  }

  return results;
};

/**
 * Request Bluetooth permissions only
 */
export const requestBluetoothPermission = async (): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) {
    return true; // Web handles permissions on-demand
  }

  try {
    const granted = await requestClassicBluetoothPermissions();
    if (!granted) {
      toast.error('Bluetooth permission required to connect to scale');
      return false;
    }
    return true;
  } catch (error) {
    console.warn('⚠️ Bluetooth permission request failed:', error);
    return false;
  }
};

/**
 * Request Camera permissions only
 */
export const requestCameraPermission = async (): Promise<boolean> => {
  if (Capacitor.isNativePlatform()) {
    // Use Capacitor Camera plugin for native
    try {
      const Camera = await loadCapacitorCamera();
      if (Camera) {
        const permStatus = await Camera.requestPermissions({ permissions: ['camera'] });
        const granted = permStatus.camera === 'granted' || permStatus.camera === 'limited';
        if (!granted) {
          toast.error('Camera permission required for photo capture. Please enable it in device settings.');
        }
        return granted;
      }
    } catch (error) {
      console.warn('⚠️ Native camera permission request failed:', error);
      return false;
    }
  }
  
  // Web fallback
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (error: any) {
    if (error.name === 'NotAllowedError') {
      toast.error('Camera permission required for photo capture');
      return false;
    } else if (error.name === 'NotFoundError') {
      toast.warning('No camera found on this device');
      return true; // Not a permission issue
    }
    console.warn('⚠️ Camera permission request failed:', error);
    return false;
  }
};

/**
 * Check if running on a native platform that needs explicit permissions
 */
export const needsExplicitPermissions = (): boolean => {
  return Capacitor.isNativePlatform();
};
