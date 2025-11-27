import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

export interface DiagnosticResult {
  timestamp: string;
  platform: string;
  bluetoothAvailable: boolean;
  devices?: {
    name: string;
    id: string;
    services?: {
      uuid: string;
      characteristics: {
        uuid: string;
        properties: {
          read: boolean;
          write: boolean;
          notify: boolean;
        };
      }[];
    }[];
  }[];
  error?: string;
}

/**
 * Run comprehensive Bluetooth diagnostics
 * Useful for troubleshooting scale connection issues
 */
export const runBluetoothDiagnostics = async (): Promise<DiagnosticResult> => {
  const result: DiagnosticResult = {
    timestamp: new Date().toISOString(),
    platform: Capacitor.getPlatform(),
    bluetoothAvailable: false,
  };

  try {
    if (Capacitor.isNativePlatform()) {
      // Native platform diagnostics
      await BleClient.initialize();
      result.bluetoothAvailable = true;

      console.log('🔍 Running Bluetooth diagnostics...');
      console.log(`📱 Platform: ${result.platform}`);
      console.log('✅ Bluetooth LE is available');

      // Note: We can't scan without user permission, so we'll just log this info
      console.log('ℹ️ To diagnose your scale:');
      console.log('1. Tap "Connect Scale"');
      console.log('2. Select your scale from the list');
      console.log('3. Check this console for detailed connection logs');
      console.log('4. Look for "📋 Found X services:" to see available services');

    } else if ('bluetooth' in navigator) {
      // Web Bluetooth diagnostics
      result.bluetoothAvailable = true;
      console.log('🔍 Running Bluetooth diagnostics...');
      console.log('🌐 Platform: Web Browser');
      console.log('✅ Web Bluetooth API is available');
      console.log('ℹ️ To diagnose your scale, connect it and check the console logs');
    } else {
      result.bluetoothAvailable = false;
      result.error = 'Bluetooth not available on this platform';
      console.error('❌ Bluetooth not available');
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    console.error('❌ Diagnostic error:', error);
  }

  return result;
};

/**
 * Export diagnostic data as JSON for sharing with support
 */
export const exportDiagnosticData = (result: DiagnosticResult): string => {
  return JSON.stringify(result, null, 2);
};

/**
 * Copy diagnostic data to clipboard
 */
export const copyDiagnosticsToClipboard = async (result: DiagnosticResult): Promise<boolean> => {
  try {
    const data = exportDiagnosticData(result);
    await navigator.clipboard.writeText(data);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
};

/**
 * Log helpful connection tips to console
 */
export const logConnectionTips = () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('📖 SCALE CONNECTION TROUBLESHOOTING TIPS');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('✓ Make sure scale is powered on and Bluetooth enabled');
  console.log('✓ Put scale in pairing mode (usually hold BT button)');
  console.log('✓ Keep phone within 5 meters of scale');
  console.log('✓ Enable Location permission (Android requirement)');
  console.log('✓ Clear previous Bluetooth pairings if having issues');
  console.log('');
  console.log('📋 When connecting, look for these log messages:');
  console.log('   🔍 = Searching for devices');
  console.log('   📱 = Device selected');
  console.log('   ✅ = Connection successful');
  console.log('   📋 = Services discovered');
  console.log('   📊 = Weight data received');
  console.log('   ❌ = Error occurred');
  console.log('');
  console.log('🔧 For ACS-SB1 or other scales not connecting:');
  console.log('   1. Connect to the scale');
  console.log('   2. Note the Service UUIDs shown in logs');
  console.log('   3. Share the UUIDs with support for assistance');
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
};
