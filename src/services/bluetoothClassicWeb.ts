/**
 * Web fallback implementation for BluetoothClassicPlugin
 * 
 * Classic Bluetooth SPP is NOT available on web browsers.
 * This provides graceful fallback behavior that:
 * 1. Returns appropriate "not available" responses
 * 2. Guides users to use BLE instead
 * 3. Doesn't break the web build
 * 
 * Capacitor 7 Compatible - uses WebPlugin pattern without deprecated registerWebPlugin
 */

import { WebPlugin } from '@capacitor/core';
import type { BluetoothClassicPlugin, ClassicBluetoothDevice } from './bluetoothClassic';

export class BluetoothClassicWeb extends WebPlugin implements BluetoothClassicPlugin {
  
  async isAvailable(): Promise<{ available: boolean }> {
    console.log('ℹ️ Classic Bluetooth SPP is not available on web browsers');
    console.log('💡 Web browsers only support BLE (Bluetooth Low Energy) via Web Bluetooth API');
    return { available: false };
  }

  async requestBluetoothPermissions(): Promise<{ granted: boolean }> {
    console.log('ℹ️ Classic Bluetooth permissions not applicable on web');
    return { granted: false };
  }

  async getPairedDevices(): Promise<{ devices: ClassicBluetoothDevice[] }> {
    console.log('ℹ️ Paired device listing not available on web');
    console.log('💡 Use BLE scanning instead - most modern scales support BLE');
    return { devices: [] };
  }

  async connect(_options: { address: string }): Promise<{ connected: boolean }> {
    console.log('⚠️ Classic Bluetooth SPP connection not available on web');
    console.log('💡 Please use BLE connection or run on Android device');
    return { connected: false };
  }

  async connectScale(_options: { address: string }): Promise<{ connected: boolean }> {
    return this.connect(_options);
  }

  async connectPrinter(_options: { address: string }): Promise<{ connected: boolean }> {
    return this.connect(_options);
  }

  async connectInsecure(_options: { address: string }): Promise<{ connected: boolean }> {
    return this.connect(_options);
  }

  async connectPrinterInsecure(_options: { address: string }): Promise<{ connected: boolean }> {
    return this.connect(_options);
  }

  async disconnect(): Promise<void> {
    // No-op on web
  }

  async isConnected(): Promise<{ connected: boolean }> {
    return { connected: false };
  }

  async write(_options: { data: string }): Promise<void> {
    console.warn('⚠️ Cannot write: Classic Bluetooth not available on web');
  }

  async writePrinter(_options: { data: string }): Promise<void> {
    return this.write(_options);
  }

  async writeScale(_options: { data: string }): Promise<void> {
    return this.write(_options);
  }

  async addListener(
    _eventName: string,
    _listenerFunc: (data: any) => void
  ): Promise<{ remove: () => Promise<void> }> {
    // Return a no-op listener handle
    return {
      remove: async () => {}
    };
  }

  async removeAllListeners(): Promise<void> {
    // No-op on web
  }
}
