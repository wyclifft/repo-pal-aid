/**
 * Classic Bluetooth SPP (Serial Port Profile) Service
 * Capacitor 7–compatible native plugin for industrial scales using RFCOMM/Serial connections
 * 
 * IMPLEMENTATION:
 * - Native Android plugin: android/.../bluetooth/BluetoothClassicPlugin.kt
 * - Uses standard SPP UUID: 00001101-0000-1000-8000-00805F9B34FB
 * - Thread-safe I/O with buffered continuous reading
 * - Supports Android 8-14 with proper permission handling
 * 
 * For scales that support both BLE and Classic SPP (like many BTM/DR series),
 * BLE is preferred. This module provides Classic SPP for devices
 * that ONLY support Classic Bluetooth or have more reliable SPP connections.
 */

import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';
import { broadcastScaleWeightUpdate, broadcastScaleConnectionChange } from './bluetooth';

// ============================================================================
// NATIVE PLUGIN INTERFACE - Capacitor 7 Compatible
// ============================================================================

/**
 * Native Classic Bluetooth SPP Plugin Interface
 * Implemented in Kotlin at: android/.../bluetooth/BluetoothClassicPlugin.kt
 */
export interface BluetoothClassicPlugin {
  /** Check if Classic Bluetooth is available on this device */
  isAvailable(): Promise<{ available: boolean }>;

  /** Request required Bluetooth permissions (handles Android 12+ automatically) */
  requestBluetoothPermissions(): Promise<{ granted: boolean }>;

  /** Get list of paired/bonded Bluetooth devices */
  getPairedDevices(): Promise<{ devices: ClassicBluetoothDevice[] }>;

  /** Connect to a Classic Bluetooth device via SPP/RFCOMM */
  connect(options: { address: string; role?: 'scale' | 'printer' }): Promise<{ connected: boolean }>;

  /** Role-specific scale connection, supported by v2.11.17+ native plugin */
  connectScale?(options: { address: string }): Promise<{ connected: boolean }>;

  /** Role-specific printer connection, supported by v2.11.17+ native plugin */
  connectPrinter?(options: { address: string }): Promise<{ connected: boolean }>;

  /** Connect using insecure method (bypasses standard pairing) */
  connectInsecure(options: { address: string; role?: 'scale' | 'printer' }): Promise<{ connected: boolean }>;

  /** Role-specific insecure printer connection, supported by v2.11.17+ native plugin */
  connectPrinterInsecure?(options: { address: string }): Promise<{ connected: boolean }>;

  /** Disconnect from currently connected device */
  disconnect(options?: { role?: 'scale' | 'printer' }): Promise<void>;

  /** Check if currently connected */
  isConnected(options?: { role?: 'scale' | 'printer' }): Promise<{ connected: boolean }>;

  /** Write data to the connected device */
  write(options: { data: string; role?: 'scale' | 'printer' }): Promise<void>;

  /** Role-specific printer write, supported by v2.11.17+ native plugin */
  writePrinter?(options: { data: string }): Promise<void>;

  /** Role-specific scale write, supported by v2.11.17+ native plugin */
  writeScale?(options: { data: string }): Promise<void>;

  /** Add listener for incoming data from the scale */
  addListener(
    eventName: 'dataReceived',
    listenerFunc: (data: { value: string }) => void
  ): Promise<PluginListenerHandle>;

  /** Add listener for connection state changes */
  addListener(
    eventName: 'connectionStateChanged',
    listenerFunc: (state: { connected: boolean }) => void
  ): Promise<PluginListenerHandle>;

  /** Remove all listeners */
  removeAllListeners(): Promise<void>;
}

// Register the plugin - uses native implementation on Android, web fallback elsewhere.
// v2.11.20: Wrapped with an Android WebView JS-interface fallback for CS10/WebView 51
// where Capacitor can expose the JS proxy but omit native method headers.
const CapacitorBluetoothClassic = registerPlugin<BluetoothClassicPlugin>('BluetoothClassic', {
  web: () => import('./bluetoothClassicWeb').then(m => new m.BluetoothClassicWeb()),
});

type AndroidClassicBridge = {
  isAvailable(): string;
  requestBluetoothPermissions(): string;
  getPairedDevices(): string;
  connect(payload: string): string;
  disconnect(payload: string): string;
  isConnected(payload: string): string;
  write(payload: string): string;
};

const androidClassicBridge = (): AndroidClassicBridge | undefined => (window as any).BluetoothClassicAndroid;

// v2.11.27: legacy Cs10PrinterAndroid JS bridge retired. Internal printer
// access flows through the new PosApi Capacitor plugin (see src/plugins/pos-api).
import { PosApi } from '@/plugins/pos-api';

const parseAndroidClassicResult = <T,>(action: string, raw: string): T => {
  const parsed = JSON.parse(raw || '{}');
  if (parsed?.error) {
    throw new Error(`[BT][JS-FALLBACK] ${action} failed: ${parsed.error}`);
  }
  return parsed as T;
};

const androidFallbackBluetoothClassic: BluetoothClassicPlugin = {
  async isAvailable() {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    return parseAndroidClassicResult('isAvailable', bridge.isAvailable());
  },
  async requestBluetoothPermissions() {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    return parseAndroidClassicResult('requestBluetoothPermissions', bridge.requestBluetoothPermissions());
  },
  async getPairedDevices() {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    return parseAndroidClassicResult('getPairedDevices', bridge.getPairedDevices());
  },
  async connect(options: { address: string; role?: 'scale' | 'printer' }) {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    return parseAndroidClassicResult('connect', bridge.connect(JSON.stringify(options)));
  },
  async connectScale(options: { address: string }) {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    return parseAndroidClassicResult('connectScale', bridge.connect(JSON.stringify({ ...options, role: 'scale' })));
  },
  async connectPrinter(options: { address: string }) {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    return parseAndroidClassicResult('connectPrinter', bridge.connect(JSON.stringify({ ...options, role: 'printer' })));
  },
  async connectInsecure(options: { address: string; role?: 'scale' | 'printer' }) {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    return parseAndroidClassicResult('connectInsecure', bridge.connect(JSON.stringify({ ...options, insecure: true })));
  },
  async connectPrinterInsecure(options: { address: string }) {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    return parseAndroidClassicResult('connectPrinterInsecure', bridge.connect(JSON.stringify({ ...options, role: 'printer', insecure: true })));
  },
  async disconnect(options?: { role?: 'scale' | 'printer' }) {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    parseAndroidClassicResult('disconnect', bridge.disconnect(JSON.stringify(options || {})));
  },
  async isConnected(options?: { role?: 'scale' | 'printer' }) {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    return parseAndroidClassicResult('isConnected', bridge.isConnected(JSON.stringify(options || {})));
  },
  async write(options: { data: string; role?: 'scale' | 'printer' }) {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    parseAndroidClassicResult('write', bridge.write(JSON.stringify(options)));
  },
  async writePrinter(options: { data: string }) {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    parseAndroidClassicResult('writePrinter', bridge.write(JSON.stringify({ ...options, role: 'printer' })));
  },
  async writeScale(options: { data: string }) {
    const bridge = androidClassicBridge();
    if (!bridge) throw new Error('BluetoothClassicAndroid bridge unavailable');
    parseAndroidClassicResult('writeScale', bridge.write(JSON.stringify({ ...options, role: 'scale' })));
  },
  async addListener(eventName: 'dataReceived' | 'connectionStateChanged', listenerFunc: (data: any) => void) {
    const mappedEvent = `BluetoothClassic:${eventName}`;
    const handler = (event: Event) => listenerFunc((event as CustomEvent).detail || {});
    window.addEventListener(mappedEvent, handler as EventListener);
    return {
      remove: async () => window.removeEventListener(mappedEvent, handler as EventListener),
    };
  },
  async removeAllListeners() {
    // Listener handles remove themselves; no global registry needed for fallback.
  },
};

let useAndroidClassicFallback = false;

const resolveBluetoothClassic = (): BluetoothClassicPlugin => {
  // v2.11.22: On CS10/WebView 51 the Capacitor proxy can exist but still
  // dispatch every method as UNIMPLEMENTED. If our direct bridge is present,
  // use it first so paired devices come from Android's bonded-device list.
  if (Capacitor.isNativePlatform() && androidClassicBridge()) {
    useAndroidClassicFallback = true;
    return androidFallbackBluetoothClassic;
  }
  return CapacitorBluetoothClassic;
};

const BluetoothClassic = new Proxy({} as BluetoothClassicPlugin, {
  get(_target, prop: keyof BluetoothClassicPlugin) {
    const plugin = resolveBluetoothClassic() as any;
    const value = plugin[prop];
    return typeof value === 'function' ? value.bind(plugin) : value;
  },
});

// ============================================================================
// TYPES
// ============================================================================

export interface ClassicBluetoothDevice {
  address: string;
  name: string;
  bonded: boolean;
  deviceClass?: number;
}

export interface InternalPrinterStatus {
  available: boolean;
  reason?: string;
  /** Stage that failed inside the native probe (loadLibrary|classForName|getInstance|printInit|printCheckStatus|printStart|printStr|startProbeService|parseProbeResult|bridge). */
  stage?: string;
  /** Native exception class (e.g. java.lang.UnsatisfiedLinkError). */
  exception?: string;
  /** Raw exception message from the native probe. */
  message?: string;
  /** Missing .so file name if the failure was a dlopen failure. */
  missingLibrary?: string;
  /** Filtered logcat tail captured when the probe failed. */
  logcatTail?: string;
  initStatus?: number | null;
  checkStatus?: number | null;
  model?: string;
  manufacturer?: string;
  device?: string;
  fingerprint?: string;
  sdk?: number;
}

export interface ClassicScaleConnection {
  device: ClassicBluetoothDevice | null;
  address: string | null;
  isConnected: boolean;
  connectionType: 'classic-spp';
}

// ============================================================================
// STATE
// ============================================================================

let classicScale: ClassicScaleConnection = {
  device: null,
  address: null,
  isConnected: false,
  connectionType: 'classic-spp',
};

let dataListenerHandle: PluginListenerHandle | null = null;
let connectionListenerHandle: PluginListenerHandle | null = null;
let printerConnectionListenerHandle: PluginListenerHandle | null = null;

// Storage keys
const CLASSIC_DEVICE_KEY = 'lastClassicBluetoothDevice';

// ============================================================================
// DEVICE DETECTION PATTERNS
// ============================================================================

// DR Series and BTM Series patterns for detection
const CLASSIC_SCALE_PATTERNS = [
  'DR', 'DR 10', 'DR10', 'DR-10', 'DR 20', 'DR20', 'DR-20',
  'DR 30', 'DR30', 'DR-30', 'DR 40', 'DR40', 'DR-40',
  'DR 50', 'DR50', 'DR-50', 'DR 60', 'DR60', 'DR-60',
  'DR 70', 'DR70', 'DR-70', 'DR 80', 'DR80', 'DR-80',
  'DR 90', 'DR90', 'DR-90', 'DR 100', 'DR100', 'DR-100',
  'DR 150', 'DR150', 'DR-150',
  'T SCALE', 'T-SCALE', 'TSCALE', 'SCALE DR', 'SCALE-DR',
  'BTM', 'BTM03', 'BTM04', 'BTM05', 'BTM0304', 'BTM0404',
  // v2.10.99: HC-04 SPP port (used by HC-04/HC-04BLE dual-mode modules) added
  // so it surfaces in the Classic BT paired list. The BLE companion (HC-04BLE)
  // is explicitly excluded below.
  'HC-04', 'HC-05', 'HC-06', 'HM-10', 'JDY', 'CC41', 'BT-', 'BT_',
  'SCALE', 'WEIGHT', 'BALANCE',
];

/**
 * v2.10.99: BLE companion port of dual-mode modules (e.g. HC-04BLE, HC-05BLE).
 * This port advertises over BLE GATT but does NOT stream weight data and must
 * never be offered as a Classic SPP scale option.
 */
const isBleHalfOfDualModeScale = (deviceName: string | undefined): boolean => {
  if (!deviceName) return false;
  const upper = deviceName.trim().toUpperCase();
  if (!/BLE$/.test(upper)) return false;
  const base = upper.replace(/[-_ ]?BLE$/, '');
  return /^(HC-?\d+|HM-?\d+|BTM|JDY|CC41|BT[-_])/.test(base);
};

/**
 * Check if device name suggests Classic Bluetooth (industrial scale)
 */
export const isLikelyClassicDevice = (deviceName: string | undefined): boolean => {
  if (!deviceName) return false;
  // Exclude BLE companion ports of dual-mode modules — they cannot stream weight.
  if (isBleHalfOfDualModeScale(deviceName)) return false;
  const upperName = deviceName.toUpperCase();
  return CLASSIC_SCALE_PATTERNS.some(pattern => upperName.includes(pattern.toUpperCase()));
};

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Check if Classic Bluetooth SPP is available
 * Returns true if native plugin is implemented and Bluetooth is available
 */
export const isClassicBluetoothAvailable = async (): Promise<boolean> => {
  // Only available on native platforms
  if (!Capacitor.isNativePlatform()) {
    console.log('ℹ️ Classic Bluetooth: Not available on web platform');
    return false;
  }

  if (androidClassicBridge()) {
    useAndroidClassicFallback = true;
    try {
      const fallbackResult = await androidFallbackBluetoothClassic.isAvailable();
      console.log(`ℹ️ Classic Bluetooth direct bridge available check: ${JSON.stringify(fallbackResult)}`);
      return !!fallbackResult.available;
    } catch (fallbackError) {
      console.error('❌ Classic Bluetooth direct bridge availability failed:', fallbackError);
    }
  }

  // v2.11.21: bounded retry — on WebView 51 the Capacitor bridge occasionally
  // publishes its plugin map a few hundred ms after the first JS call. Wait up
  // to 4s (in 250ms slices) for BluetoothClassic to appear before failing.
  const waitForBridge = async (maxMs = 4000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const plugins = (window as any).Capacitor?.Plugins;
      if (plugins?.BluetoothClassic) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };
  const ready = await waitForBridge();
  const plugins = (window as any).Capacitor?.Plugins;
  if (!ready) {
    console.warn('⚠️ [BRIDGE] BluetoothClassic not published after 4s wait');
    if (plugins) console.log('Available plugins:', Object.keys(plugins).join(', '));
  } else {
    console.log('✅ [BRIDGE] BluetoothClassic plugin found in bridge');
  }

  try {
    const result = await BluetoothClassic.isAvailable();
    console.log(`ℹ️ Classic Bluetooth available check: ${JSON.stringify(result)}`);
    return !!result.available;
  } catch (error: any) {
    // Native plugin not implemented yet or bridge failure
    const code = error?.code;
    const msg = error?.message || String(error);
    const stack = error?.stack;
    console.error(`❌ Classic Bluetooth availability check FAILED: code=${code} msg=${msg}`);
    if (stack) console.error(`   stack: ${stack}`);
    if (msg.includes('not implemented') || msg.includes('plugin') || !ready) {
      console.log('💡 Bridge issue detected: Plugin registration failed or race condition on WebView 51.');
      if (androidClassicBridge()) {
        useAndroidClassicFallback = true;
        console.log('✅ [BT][JS-FALLBACK] Using BluetoothClassicAndroid direct bridge');
        try {
          const fallbackResult = await androidFallbackBluetoothClassic.isAvailable();
          console.log(`ℹ️ Classic Bluetooth fallback available check: ${JSON.stringify(fallbackResult)}`);
          return !!fallbackResult.available;
        } catch (fallbackError) {
          console.error('❌ Classic Bluetooth JS fallback availability failed:', fallbackError);
        }
      } else {
        console.warn('⚠️ [BT][JS-FALLBACK] BluetoothClassicAndroid bridge not present');
      }
    }
    return false;
  }

};


/**
 * Request Bluetooth permissions for Classic Bluetooth
 */
export const requestClassicBluetoothPermissions = async (): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    const result = await BluetoothClassic.requestBluetoothPermissions();
    return result.granted;
  } catch (error) {
    console.warn('⚠️ Failed to request Classic Bluetooth permissions:', error);
    return false;
  }
};

/**
 * Get list of paired/bonded Bluetooth devices
 */
export const getPairedDevices = async (): Promise<ClassicBluetoothDevice[]> => {
  if (!Capacitor.isNativePlatform()) {
    console.log('ℹ️ Classic Bluetooth: Paired devices only available on native');
    return [];
  }

  if (androidClassicBridge()) {
    useAndroidClassicFallback = true;
    try {
      const result = await androidFallbackBluetoothClassic.getPairedDevices();
      console.log(`📱 Found ${result.devices.length} paired devices via direct Android bridge`);
      return result.devices;
    } catch (fallbackError) {
      console.error('❌ Classic Bluetooth direct bridge getPairedDevices failed:', fallbackError);
    }
  }

  try {
    const result = await BluetoothClassic.getPairedDevices();
    console.log(`📱 Found ${result.devices.length} paired devices`);
    return result.devices;
  } catch (error: any) {
    const code = error?.code;
    const msg = error?.message || String(error);
    console.log(`ℹ️ Classic Bluetooth: getPairedDevices failed code=${code} msg=${msg}`);
    if ((msg.includes('not implemented') || msg.includes('plugin')) && androidClassicBridge()) {
      useAndroidClassicFallback = true;
      try {
        const result = await androidFallbackBluetoothClassic.getPairedDevices();
        console.log(`📱 Found ${result.devices.length} paired devices via JS fallback`);
        return result.devices;
      } catch (fallbackError) {
        console.error('❌ Classic Bluetooth JS fallback getPairedDevices failed:', fallbackError);
      }
    }
    console.log('💡 Tip: DR/BTM series scales often work via BLE with FFE0/FFE1 services');
    return [];
  }

};

/**
 * Get paired devices that are likely scales
 */
export const getPairedScales = async (): Promise<ClassicBluetoothDevice[]> => {
  const devices = await getPairedDevices();
  return devices.filter(d => isLikelyClassicDevice(d.name));
};

/**
 * Get ALL paired devices (including unnamed/unknown ones)
 * Useful for connecting to devices that don't have recognizable names
 */
export const getAllPairedDevices = async (): Promise<ClassicBluetoothDevice[]> => {
  return getPairedDevices();
};

// ============================================================================
// WEIGHT PARSING
// ============================================================================

/**
 * Parse weight data from raw serial data
 * Supports multiple formats used by DR/BTM series scales
 * Enhanced with detailed raw data logging
 */
export const parseSerialWeightData = (data: string): number | null => {
  // Log raw hex bytes for debugging
  const hexBytes = Array.from(data).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
  console.log(`📊 Raw Classic BT data: "${data}" (${data.length} chars)`);
  console.log(`📊 Raw hex bytes: [${hexBytes}]`);
  
  // Clean the data
  const cleanData = data.trim().replace(/[\x00-\x1F\x7F]/g, '');
  console.log(`📊 Cleaned data: "${cleanData}"`);

  // v2.10.68: Belt-and-braces noise guard — real scale frames always carry either
  // a decimal point or an explicit unit token (kg/g/lb/oz). Printer ACK/status
  // bytes (e.g. \x06, \x10, short numeric flags) never do, so reject them up
  // front instead of letting the permissive integer-grams strategy below match.
  const hasDecimal = /\d\.\d/.test(cleanData);
  const hasUnit = /\b(kg|g|lb|oz)\b/i.test(cleanData);
  if (!hasDecimal && !hasUnit) {
    // Allow only the explicit "all zeros" sentinel through; everything else is noise.
    if (!/^[+\-]?0+$/.test(cleanData)) {
      console.log(`⚠️ Ignoring noise frame (no decimal, no unit): "${cleanData}"`);
      return null;
    }
  }
  
  // Check for negative values - return 0
  const negativeMatch = cleanData.match(/-\s*(\d+\.?\d*)/);
  if (negativeMatch) {
    console.log(`⚠️ Negative weight detected (-${negativeMatch[1]}), returning 0`);
    return 0;
  }
  
  // Check for zero first
  const zeroMatch = cleanData.match(/^\s*\+?\s*0+\.?0*\s*(kg|g|lb|oz)?\s*$/i);
  if (zeroMatch) {
    console.log(`✅ Parsed weight (zero): 0 kg`);
    return 0;
  }
  
  // Strategy 1: Standard weight format like "ST,GS,+  12.345kg" or "12.345 kg"
  const standardMatch = cleanData.match(/[+-]?\s*(\d+\.?\d*)\s*(kg|g|lb|oz)?/i);
  if (standardMatch) {
    let weight = parseFloat(standardMatch[1]);
    const unit = standardMatch[2]?.toLowerCase();
    
    if (unit === 'g') weight = weight / 1000;
    else if (unit === 'lb') weight = weight * 0.453592;
    else if (unit === 'oz') weight = weight * 0.0283495;
    
    if (weight >= 0 && weight < 1000) {
      console.log(`✅ Parsed weight (standard): ${weight.toFixed(3)} kg`);
      return weight;
    }
  }
  
  // Strategy 2: Just decimal number
  const decimalMatch = cleanData.match(/(\d+\.\d{1,4})/);
  if (decimalMatch) {
    const weight = parseFloat(decimalMatch[1]);
    if (weight >= 0 && weight < 500) {
      console.log(`✅ Parsed weight (decimal): ${weight.toFixed(3)} kg`);
      return weight;
    }
  }
  
  // Strategy 3: Integer representing grams
  const intMatch = cleanData.replace(/[^0-9]/g, '');
  if (intMatch.length >= 3) {
    const intValue = parseInt(intMatch);
    if (intValue >= 0 && intValue < 500000) {
      const weight = intValue / 1000;
      console.log(`✅ Parsed weight (grams): ${weight.toFixed(3)} kg`);
      return weight;
    }
  }
  
  console.log(`⚠️ Could not parse weight from: "${cleanData}"`);
  return null;
};

// ============================================================================
// CONNECTION MANAGEMENT
// ============================================================================

/**
 * Connect to a Classic Bluetooth scale via SPP/RFCOMM
 */
export const connectClassicScale = async (
  device: ClassicBluetoothDevice,
  onWeightUpdate: (weight: number) => void
): Promise<{ success: boolean; error?: string }> => {
  if (!Capacitor.isNativePlatform()) {
    return { 
      success: false, 
      error: 'Classic Bluetooth only available on native platforms' 
    };
  }

  try {
    console.log(`🔗 Connecting to Classic BT device: ${device.name} (${device.address})`);

    // Connect to device
    const result = BluetoothClassic.connectScale
      ? await BluetoothClassic.connectScale({ address: device.address })
      : await BluetoothClassic.connect({ address: device.address, role: 'scale' });
    
    if (!result.connected) {
      return { success: false, error: 'Failed to connect to device' };
    }

    // Set up data listener - uses global broadcast as primary, callback as secondary
    dataListenerHandle = await BluetoothClassic.addListener('dataReceived', (event: any) => {
      if (event.role && event.role !== 'scale') {
        return;
      }
      // v2.10.68: Drop inbound bytes when our scale role is not active.
      // The native plugin shares ONE RFCOMM socket across scale & printer roles,
      // and the dataReceived event has no device-address tag. Without this guard,
      // printer ACK/status bytes (emitted while only a printer is connected) get
      // misparsed as a "weight" by parseSerialWeightData, fire scaleWeightUpdate,
      // and flip the scale indicator green even though no scale is paired.
      if (!classicScale.isConnected || !classicScale.address) {
        return;
      }
      // Native plugin sends { data: "..." }, handle both .data and .value for compatibility
      const rawData = event.data ?? event.value ?? '';
      console.log(`📡 Classic BT dataReceived event keys: ${Object.keys(event).join(', ')}, raw: "${rawData}"`);
      const weight = parseSerialWeightData(rawData);
      if (weight !== null) {
        // Always broadcast globally - this is the app-level persistent mechanism
        broadcastScaleWeightUpdate(weight, 'Classic-SPP');
        
        // Try calling the callback, but wrap in try-catch in case it's stale
        // (e.g., component that passed the callback has unmounted)
        try {
          onWeightUpdate(weight);
        } catch (callbackError) {
          // Stale callback - this is expected when navigating away from Settings
          // Global broadcast already handled the update
          console.log('📡 Classic BT: Callback stale (component unmounted), global broadcast sent');
        }
      }
    });

    // Set up connection state listener
    // v2.10.65: Scope by device address + verify-before-clear gate.
    // The native plugin shares one BluetoothClassic instance across scale & printer,
    // so a printer disconnect event must NOT clear scale state (and vice versa).
    // 1. If event carries an address, ignore it unless it matches THIS scale.
    // 2. If event has no address (older plugin), only act if our role is currently
    //    flagged connected — prevents cross-role clearing.
    // 3. Verify against the native side before actually clearing — guards against
    //    transient false-disconnects emitted by some POS firmwares between writes.
    const scaleAddress = device.address;
    connectionListenerHandle = await BluetoothClassic.addListener('connectionStateChanged', async (state: any) => {
      if (state.role && state.role !== 'scale') return;
      if (state.connected) return;
      const eventAddress: string | undefined = state.address;
      if (eventAddress && eventAddress !== scaleAddress) {
        // Event is for a different device (e.g. the printer) — ignore.
        return;
      }
      if (!classicScale.isConnected) {
        // Already cleared / not our role — ignore.
        return;
      }
      // Verify with native before clearing
      try {
        const check = await BluetoothClassic.isConnected({ role: 'scale' });
        if (check?.connected) {
          console.warn('⚠️ Classic BT scale: spurious disconnect event — native still connected, preserving state');
          return;
        }
      } catch {
        // If verify fails, fall through to clear (safer than leaving stale state)
      }
      console.log('⚠️ Classic BT scale connection lost (verified)');
      clearClassicScaleState();
    });

    // Update state
    classicScale = {
      device,
      address: device.address,
      isConnected: true,
      connectionType: 'classic-spp',
    };

    // Save device for quick reconnect
    saveClassicDeviceInfo(device);

    // v2.10.69: Use the guarded broadcaster (in bluetooth.ts) so the
    // scaleConnectionChange event cannot fire unless a scale role is truly
    // active. Avoids any future code path leaking a printer connect as a
    // scale connect on integrated POS hardware.
    broadcastScaleConnectionChange(true);

    console.log(`✅ Connected to Classic BT scale: ${device.name}`);
    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Check if this is because native plugin isn't implemented
    if (errorMessage.includes('not implemented') || errorMessage.includes('plugin')) {
      console.log('⚠️ Classic Bluetooth SPP requires native plugin implementation');
      console.log('💡 Try using BLE connection instead - most BTM/DR scales support both');
      return { 
        success: false, 
        error: 'Classic Bluetooth plugin not yet implemented. Try BLE connection.' 
      };
    }

    console.error('❌ Classic BT connection error:', error);
    return { success: false, error: errorMessage };
  }
};

/**
 * Disconnect from Classic Bluetooth scale
 */
export const disconnectClassicScale = async (): Promise<void> => {
  try {
    // Remove listeners
    if (dataListenerHandle) {
      await dataListenerHandle.remove();
      dataListenerHandle = null;
    }
    if (connectionListenerHandle) {
      await connectionListenerHandle.remove();
      connectionListenerHandle = null;
    }

    // Disconnect
    await BluetoothClassic.disconnect({ role: 'scale' });
  } catch (error) {
    console.warn('⚠️ Error disconnecting Classic BT:', error);
  }

  clearClassicScaleState();
};

/**
 * Clear Classic scale state
 */
const clearClassicScaleState = () => {
  classicScale = {
    device: null,
    address: null,
    isConnected: false,
    connectionType: 'classic-spp',
  };
  // v2.10.69: route through guarded broadcaster (false is always allowed)
  broadcastScaleConnectionChange(false);
};

// ============================================================================
// DEVICE STORAGE
// ============================================================================

/**
 * Save device info for quick reconnect
 */
const saveClassicDeviceInfo = (device: ClassicBluetoothDevice) => {
  localStorage.setItem(CLASSIC_DEVICE_KEY, JSON.stringify({
    ...device,
    timestamp: Date.now(),
  }));
  // v2.10.100: A successful Classic SPP pairing invalidates any prior BLE
  // record (e.g. stale HC-04BLE) so auto-reconnect doesn't pick the wrong
  // half of a dual-mode scale on restart.
  try {
    localStorage.removeItem('lastConnectedScale');
    console.log('[BT][scale] cleared stale BLE record after Classic SPP pair:', device.name);
  } catch {}
};

/**
 * Get stored device info
 */
export const getStoredClassicDevice = (): (ClassicBluetoothDevice & { timestamp: number }) | null => {
  try {
    const stored = localStorage.getItem(CLASSIC_DEVICE_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

/**
 * Clear stored device
 */
export const clearStoredClassicDevice = () => {
  localStorage.removeItem(CLASSIC_DEVICE_KEY);
};

// ============================================================================
// RECONNECTION
// ============================================================================

/**
 * Quick reconnect to last used Classic scale
 */
export const quickReconnectClassicScale = async (
  onWeightUpdate: (weight: number) => void
): Promise<{ success: boolean; error?: string }> => {
  const storedDevice = getStoredClassicDevice();
  if (!storedDevice) {
    return { success: false, error: 'No stored Classic device' };
  }

  // Check if device is still valid (within 24 hours)
  const hoursSinceLastConnect = (Date.now() - storedDevice.timestamp) / (1000 * 60 * 60);
  if (hoursSinceLastConnect > 24) {
    clearStoredClassicDevice();
    return { success: false, error: 'Stored device expired' };
  }

  return connectClassicScale(storedDevice, onWeightUpdate);
};

// ============================================================================
// STATUS FUNCTIONS
// ============================================================================

/**
 * Check if Classic scale is connected
 */
export const isClassicScaleConnected = (): boolean => {
  return classicScale.isConnected;
};

/**
 * Get current Classic scale info
 */
export const getCurrentClassicScaleInfo = (): { address: string; name: string } | null => {
  if (!classicScale.device || !classicScale.isConnected) return null;
  return {
    address: classicScale.address!,
    name: classicScale.device.name,
  };
};

// ============================================================================
// SCALE COMMANDS
// ============================================================================

/**
 * Common scale commands for future use with write() function
 */
export const SCALE_COMMANDS = {
  READ_WEIGHT: '\x05',      // ENQ - common request for weight
  TARE: 'T',                // Tare command
  ZERO: 'Z',                // Zero command
  CONTINUOUS: 'C',          // Start continuous output
  STOP: 'S',                // Stop continuous output
  CRLF: '\r\n',             // Line terminator
};

/**
 * Send command to connected scale
 */
export const sendScaleCommand = async (command: string): Promise<boolean> => {
  if (!classicScale.isConnected) {
    console.warn('⚠️ Cannot send command: No Classic BT connection');
    return false;
  }

  try {
    if (BluetoothClassic.writeScale) {
      await BluetoothClassic.writeScale({ data: command });
    } else {
      await BluetoothClassic.write({ data: command, role: 'scale' });
    }
    return true;
  } catch (error) {
    console.error('❌ Failed to send command:', error);
    return false;
  }
};

// ============================================================================
// CLASSIC BLUETOOTH PRINTER SUPPORT
// ============================================================================

let classicPrinter: {
  device: ClassicBluetoothDevice | null;
  address: string | null;
  isConnected: boolean;
  internal?: boolean;
} = {
  device: null,
  address: null,
  isConnected: false,
};

const CLASSIC_PRINTER_KEY = 'lastClassicBluetoothPrinter';
const INTERNAL_PRINTER_ADDRESS = 'CS10-INTERNAL-PRINTER';




/**
 * v2.11.29: WebView 51 logs Error objects as an empty string, which is why the
 * device only ever showed "availability check failed:" with no cause. Every
 * failure path now produces a stringified, human readable reason and carries the
 * native init `state` (ok | pending | failed) through to /debug.
 */
const describeError = (error: unknown): string => {
  if (error == null) return 'unknown error';
  if (typeof error === 'string') return error;
  const anyErr = error as Record<string, unknown>;
  const parts = [anyErr.code, anyErr.errorMessage, anyErr.message]
    .filter((v) => typeof v === 'string' && v.length > 0) as string[];
  if (parts.length) return parts.join(' | ');
  try {
    const json = JSON.stringify(error);
    if (json && json !== '{}') return json;
  } catch { /* ignore */ }
  return String(error);
};

export const getInternalPrinterStatus = async (): Promise<InternalPrinterStatus> => {
  if (!Capacitor.isNativePlatform()) return { available: false, reason: 'not-native' };
  try {
    const ready = await PosApi.isReady();
    if (!ready.ready) {
      const message = ready.error || `Vendor SDK not ready (state=${ready.state || 'unknown'})`;
      console.warn(`🖨️ CS10 internal printer not ready: state=${ready.state || 'unknown'} ${message}`);
      return {
        available: false,
        reason: ready.state === 'pending' ? 'sdk-initializing' : 'sdk-unavailable',
        stage: 'PosApi.isReady',
        message,
      };
    }
    // Probe the printer by opening + initializing. Any hardware/paper/heat/battery
    // error surfaces here so the UI can show a real diagnostic.
    try {
      await PosApi.initializePrinter();
      console.log('🖨️ CS10 internal printer available: true (PosApi)');
      return { available: true, reason: 'ok' };
    } catch (e: any) {
      const code = e?.code || e?.errorMessage || 'init-failed';
      const msg = describeError(e);
      console.warn(`🖨️ CS10 internal printer init failed: ${code} ${msg}`);
      return {
        available: false,
        reason: code,
        stage: 'PosApi.initializePrinter',
        exception: code,
        message: msg,
      };
    }
  } catch (error) {
    const msg = describeError(error);
    console.warn('⚠️ CS10 internal printer availability check failed:', msg);
    return {
      available: false,
      reason: 'status-check-failed',
      message: msg,
      stage: 'PosApi',
    };
  }
};


/**
 * v2.11.27: Re-run the PosApi initialize probe. There is no cached probe on
 * the native side anymore — every call runs against the SDK — so this simply
 * re-invokes getInternalPrinterStatus.
 */
export const retryInternalPrinterProbe = async (): Promise<InternalPrinterStatus> => {
  return getInternalPrinterStatus();
};

export const isInternalPrinterAvailable = async (): Promise<boolean> => {
  const status = await getInternalPrinterStatus();
  return status.available;
};

const formatInternalError = (status: InternalPrinterStatus): string => {
  const parts: string[] = [];
  if (status.stage) parts.push(`stage=${status.stage}`);
  if (status.exception) parts.push(status.exception);
  if (status.missingLibrary) parts.push(`missing=${status.missingLibrary}`);
  if (status.message) parts.push(status.message);
  return parts.length ? `CS10 internal printer init failed (${parts.join(' | ')})` : 'CS10 internal printer unavailable';
};

export const connectInternalPrinter = async (): Promise<{ success: boolean; error?: string; status?: InternalPrinterStatus }> => {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, error: 'Internal printer only available on native' };
  }

  try {
    const status = await getInternalPrinterStatus();
    if (!status.available) {
      return { success: false, error: formatInternalError(status), status };
    }

    const device: ClassicBluetoothDevice = {
      address: INTERNAL_PRINTER_ADDRESS,
      name: 'CS10 Internal Printer',
      bonded: true,
    };

    classicPrinter = {
      device,
      address: INTERNAL_PRINTER_ADDRESS,
      isConnected: true,
      internal: true,
    };

    localStorage.setItem(CLASSIC_PRINTER_KEY, JSON.stringify({
      ...device,
      internal: true,
      timestamp: Date.now(),
    }));
    window.dispatchEvent(new CustomEvent('printerConnectionChange', { detail: { connected: true, type: 'classic', internal: true } }));
    console.log('✅ Connected to CS10 internal printer bridge');
    return { success: true, status };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ CS10 internal printer connection error:', error);
    return { success: false, error: errorMessage };
  }
};

export const printToInternalPrinter = async (content: string): Promise<{ success: boolean; error?: string }> => {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, error: 'Internal printer only available on native' };
  }
  try {
    // Split into lines for the SDK's line-based printer.
    // v2.11.30: geometry is passed explicitly — taller glyphs (32 dots) at the
    // same 24-dot width so the 32-column layout is untouched, tight line
    // spacing, and a real post-print paper feed so the last line clears the
    // tear bar. No leading feed, which removes the blank space at the top.
    // v2.11.32: some CS10 firmwares ignore Lib_PrnStep, so the tail of the
    // receipt stayed inside the print head and got cut off. Pad the buffer
    // with real blank lines AND request a larger post-print feed.
    const lines = (content || '').split('\n');
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', '', '', '', '');
    await PosApi.printReceipt({
      lines,
      fontHeight: 32,
      fontWidth: 24,
      lineSpace: 2,
      feedDots: 160,
    });

    console.log('✅ CS10 internal printer print completed (PosApi)');
    return { success: true };
  } catch (error: any) {
    const code = error?.code || error?.errorMessage;
    const message = error?.message || String(error);
    const detail = code ? `${code}: ${message}` : message;
    console.error('❌ CS10 internal printer print error:', detail);
    // v2.11.25: NEVER auto-fall-back to Bluetooth here — the user explicitly
    // picked Internal. Surface the diagnostic and let them retry or manually
    // switch to CLASSIC.
    return { success: false, error: detail || 'Internal print failed' };
  }
};

/**
 * Connect to a Classic Bluetooth printer (built-in POS printers, SPP printers)
 */
export const connectClassicPrinter = async (
  device: ClassicBluetoothDevice
): Promise<{ success: boolean; error?: string }> => {
  if (!Capacitor.isNativePlatform()) {
    return { 
      success: false, 
      error: 'Classic Bluetooth only available on native platforms' 
    };
  }

  try {
    console.log(`🖨️ Connecting to Classic BT printer: ${device.name} (${device.address})`);

    // Disconnect any existing printer connection first
    if (classicPrinter.isConnected) {
      await disconnectClassicPrinter();
    }

    // Connect to device
    const result = BluetoothClassic.connectPrinter
      ? await BluetoothClassic.connectPrinter({ address: device.address })
      : await BluetoothClassic.connect({ address: device.address, role: 'printer' });
    
    if (!result.connected) {
      return { success: false, error: 'Failed to connect to printer' };
    }

    // Set up connection state listener
    // v2.10.65: Scope by printer address + verify-before-clear gate.
    // Critical fix for the affected user: a connectionStateChanged event fired
    // mid-print (or by the scale role) was clearing printer state and dropping
    // the user back to the "Select Printer" prompt. Now we only clear state
    // when the event genuinely belongs to this printer AND the native socket
    // confirms it is gone.
    const printerAddress = device.address;
    if (printerConnectionListenerHandle) {
      await printerConnectionListenerHandle.remove();
      printerConnectionListenerHandle = null;
    }
    printerConnectionListenerHandle = await BluetoothClassic.addListener('connectionStateChanged', async (state: any) => {
      if (state.role && state.role !== 'printer') return;
      if (state.connected) return;
      const eventAddress: string | undefined = state.address;
      if (eventAddress && eventAddress !== printerAddress) {
        // Event is for a different device (e.g. the scale) — ignore.
        return;
      }
      if (!classicPrinter.isConnected) {
        // Already cleared / not our role — ignore.
        return;
      }
      // Verify with native before clearing — protects against spurious mid-print events
      try {
        const check = await BluetoothClassic.isConnected({ role: 'printer' });
        if (check?.connected) {
          console.warn('⚠️ Classic BT printer: spurious disconnect event — native still connected, preserving state');
          return;
        }
      } catch {
        // If verify fails, fall through to clear (safer than leaving stale state)
      }
      console.log('⚠️ Classic BT printer connection lost (verified)');
      clearClassicPrinterState();
    });

    // Update state
    classicPrinter = {
      device,
      address: device.address,
      isConnected: true,
    };

    // Save device for quick reconnect
    localStorage.setItem(CLASSIC_PRINTER_KEY, JSON.stringify({
      ...device,
      timestamp: Date.now(),
    }));

    // Broadcast connection change
    window.dispatchEvent(new CustomEvent('printerConnectionChange', { detail: { connected: true, type: 'classic' } }));

    console.log(`✅ Connected to Classic BT printer: ${device.name}`);
    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Classic BT printer connection error:', error);
    return { success: false, error: errorMessage };
  }
};

/**
 * Disconnect from Classic Bluetooth printer
 */
export const disconnectClassicPrinter = async (): Promise<void> => {
  try {
    if (!classicPrinter.internal) {
      await BluetoothClassic.disconnect({ role: 'printer' });
    }
  } catch (error) {
    console.warn('⚠️ Error disconnecting Classic BT printer:', error);
  }
  if (printerConnectionListenerHandle) {
    await printerConnectionListenerHandle.remove();
    printerConnectionListenerHandle = null;
  }
  clearClassicPrinterState();
};

const clearClassicPrinterState = () => {
  classicPrinter = {
    device: null,
    address: null,
    isConnected: false,
    internal: false,
  };
  window.dispatchEvent(new CustomEvent('printerConnectionChange', { detail: { connected: false, type: 'classic' } }));
};

/**
 * Check if Classic printer is connected
 */
export const isClassicPrinterConnected = (): boolean => {
  return classicPrinter.isConnected;
};

/**
 * v2.10.69: Get current Classic printer info (address + name).
 * Used by useScaleConnection to detect when a stored "scale" device id
 * actually belongs to the connected printer (integrated POS hardware).
 */
export const getCurrentClassicPrinterInfo = (): { address: string; name: string } | null => {
  if (!classicPrinter.device || !classicPrinter.isConnected || !classicPrinter.address) return null;
  return {
    address: classicPrinter.address,
    name: classicPrinter.device.name,
  };
};

/**
 * Get stored Classic printer device
 */
export const getStoredClassicPrinter = (): (ClassicBluetoothDevice & { timestamp: number }) | null => {
  try {
    const stored = localStorage.getItem(CLASSIC_PRINTER_KEY);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

/**
 * Quick reconnect to last used Classic printer
 */
export const quickReconnectClassicPrinter = async (): Promise<{ success: boolean; error?: string }> => {
  const storedDevice = getStoredClassicPrinter();
  if (!storedDevice) {
    return { success: false, error: 'No stored Classic printer' };
  }

  // Check if device is still valid (within 24 hours)
  const hoursSinceLastConnect = (Date.now() - storedDevice.timestamp) / (1000 * 60 * 60);
  if (hoursSinceLastConnect > 24) {
    localStorage.removeItem(CLASSIC_PRINTER_KEY);
    return { success: false, error: 'Stored printer expired' };
  }

  if ((storedDevice as any).internal || storedDevice.address === INTERNAL_PRINTER_ADDRESS) {
    return connectInternalPrinter();
  }

  return connectClassicPrinter(storedDevice);
};

/**
 * Print data to Classic Bluetooth printer using SPP
 */
export const printToClassicPrinter = async (content: string): Promise<{ success: boolean; error?: string }> => {
  if (!classicPrinter.isConnected) {
    return { success: false, error: 'No Classic printer connected' };
  }

  if (classicPrinter.internal || classicPrinter.address === INTERNAL_PRINTER_ADDRESS) {
    console.log('🖨️ Printing via CS10 internal printer bridge...');
    return printToInternalPrinter(content);
  }

  const printerDevice = classicPrinter.device && classicPrinter.address ? {
    ...classicPrinter.device,
    address: classicPrinter.address,
  } : null;

  const isRecoverablePrinterSocketError = (message: string): boolean => {
    const lower = message.toLowerCase();
    return lower.includes('broken pipe') ||
      lower.includes('socket closed') ||
      lower.includes('not connected') ||
      lower.includes('write failed');
  };

  // ESC/POS commands
  const ESC = '\x1B';
  const GS = '\x1D';

  // Build print data with ESC/POS commands. Receipt text/content is unchanged.
  const printData =
    ESC + '@' +           // Initialize printer
    ESC + 'a\x01' +       // Center alignment
    content +
    '\n\n\n\n\n' +        // Line feeds
    GS + 'V\x00';         // Cut paper

  const sendPrintData = async () => {
    const chunkSize = 200;
    for (let i = 0; i < printData.length; i += chunkSize) {
      const chunk = printData.slice(i, i + chunkSize);
      if (BluetoothClassic.writePrinter) {
        await BluetoothClassic.writePrinter({ data: chunk });
      } else {
        await BluetoothClassic.write({ data: chunk, role: 'printer' });
      }
      if (i + chunkSize < printData.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      console.log(attempt === 0 ? '🖨️ Printing via Classic Bluetooth SPP...' : '🖨️ Retrying Classic Bluetooth print after reconnect...');
      await sendPrintData();
      console.log('✅ Classic BT print completed');
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Print failed';
      console.error('❌ Classic BT print error:', error);
      if (attempt === 0 && printerDevice && isRecoverablePrinterSocketError(errorMessage)) {
        console.warn('[BT][printer] Socket dropped during print, reconnecting once and restarting receipt print');
        await disconnectClassicPrinter();
        await new Promise(resolve => setTimeout(resolve, 300));
        const reconnect = await connectClassicPrinter(printerDevice);
        if (reconnect.success) {
          continue;
        }
        return { success: false, error: reconnect.error || 'Printer connection lost. Reconnect the Bluetooth printer and retry.' };
      }
      return {
        success: false,
        error: isRecoverablePrinterSocketError(errorMessage)
          ? 'Printer connection lost. Reconnect the Bluetooth printer and retry.'
          : errorMessage,
      };
    }
  }

  return { success: false, error: 'Printer connection lost. Reconnect the Bluetooth printer and retry.' };
};

/**
 * Get paired devices that are likely printers
 */
export const getPairedPrinters = async (): Promise<ClassicBluetoothDevice[]> => {
  const devices = await getPairedDevices();
  const printerPatterns = [
    'PRINT', 'POS', 'THERMAL', 'RECEIPT', 'EPSON', 'STAR', 
    'BIXOLON', 'ZEBRA', 'TSP', 'TM-', 'CS10', 'SUNMI', 'IMIN',
    'PP-', 'RPP', 'PT-', 'MPT-', 'MP-', 'Q2', 'V2', 'INNER',
  ];
  
  return devices.filter(d => {
    if (!d.name) return false;
    const upperName = d.name.toUpperCase();
    return printerPatterns.some(pattern => upperName.includes(pattern));
  });
};

/**
 * Check if a device name matches known internal POS printer patterns (CS10, etc.)
 */
export const isInternalPosPrinter = (name: string | undefined): boolean => {
  if (!name) return false;
  const upper = name.toUpperCase();
  return ['CS10', 'SUNMI', 'IMIN', 'INNER', 'Q2', 'V2', 'TP2'].some(p => upper.includes(p));
};

/**
 * Common internal POS printer MAC addresses
 */
export const INTERNAL_PRINTER_ADDRESSES: string[] = [];

/**
 * Connect directly to a specific MAC address (manual entry)
 */
export const connectDirectToAddress = async (
  address: string,
  name: string = 'Internal Printer'
): Promise<{ success: boolean; error?: string }> => {
  if (!Capacitor.isNativePlatform()) {
    return { success: false, error: 'Direct connect only available on native' };
  }

  // Validate MAC address format
  if (!/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(address)) {
    return { success: false, error: 'Invalid MAC address format' };
  }

  try {
    console.log(`🔌 Direct connecting to address: ${address}`);

    // Disconnect any existing printer connection first
    if (classicPrinter.isConnected) {
      await disconnectClassicPrinter();
    }

    // Attempt insecure connect first for direct addresses
    const result = BluetoothClassic.connectPrinterInsecure
      ? await BluetoothClassic.connectPrinterInsecure({ address })
      : await BluetoothClassic.connectInsecure({ address, role: 'printer' });

    if (!result.connected) {
      return { success: false, error: 'Failed to connect directly' };
    }

    // Update state
    const device: ClassicBluetoothDevice = {
      address,
      name,
      bonded: false, // We connected directly, might not be bonded
    };

    classicPrinter = {
      device,
      address,
      isConnected: true,
    };

    // Save device for quick reconnect
    localStorage.setItem(CLASSIC_PRINTER_KEY, JSON.stringify({
      ...device,
      timestamp: Date.now(),
    }));

    // Broadcast connection change
    window.dispatchEvent(new CustomEvent('printerConnectionChange', { detail: { connected: true, type: 'classic' } }));

    console.log(`✅ Directly connected to: ${name} (${address})`);
    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Direct connection error:', error);
    return { success: false, error: errorMessage };
  }
};
