/**
 * Permission request utilities for Bluetooth and Camera
 * Ensures permissions are requested before use
 */

import { Capacitor } from '@capacitor/core';
import { toast } from 'sonner';
import { requestClassicBluetoothPermissions } from '@/services/bluetoothClassic';

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
