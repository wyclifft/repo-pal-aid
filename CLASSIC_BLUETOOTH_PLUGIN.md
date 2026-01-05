# Classic Bluetooth SPP Plugin for Capacitor 7

A production-ready custom native Android plugin for Classic Bluetooth SPP (RFCOMM) support, designed for industrial weighing scales.

## Features

- **Capacitor 7 Compatible**: Written in Kotlin with proper plugin registration
- **Android 8-14 Support**: Handles both legacy and new Bluetooth permissions
- **RFCOMM/SPP**: Uses standard Serial Port Profile UUID (00001101-0000-1000-8000-00805F9B34FB)
- **Thread-Safe I/O**: Background threads for socket operations with proper lifecycle management
- **Continuous Reading**: Buffered stream reading with event emission for real-time weight data
- **Fallback Connection**: Alternative connection method for stubborn industrial devices
- **Web Build Safe**: Web fallback returns graceful "not available" responses

## Architecture

```
src/services/
├── bluetoothClassic.ts      # TypeScript interface & service logic
├── bluetoothClassicWeb.ts   # Web fallback (graceful no-ops)

android/app/src/main/java/app/lovable/.../
├── MainActivity.kt          # Registers BluetoothClassicPlugin
└── bluetooth/
    └── BluetoothClassicPlugin.kt  # Native Kotlin implementation
```

## JavaScript API

```typescript
import { 
  isClassicBluetoothAvailable,
  getPairedScales,
  connectClassicScale,
  disconnectClassicScale 
} from '@/services/bluetoothClassic';

// Check availability
const available = await isClassicBluetoothAvailable();

// Get paired scale devices
const scales = await getPairedScales();

// Connect to a scale
const result = await connectClassicScale(device, (weight) => {
  console.log('Weight:', weight, 'kg');
});

// Disconnect
await disconnectClassicScale();
```

## Native Methods

| Method | Description |
|--------|-------------|
| `isAvailable()` | Check if Classic Bluetooth is available |
| `requestPermissions()` | Request Bluetooth permissions (handles Android 12+ automatically) |
| `getPairedDevices()` | Get list of bonded Bluetooth devices |
| `connect({address})` | Connect to device via RFCOMM SPP |
| `disconnect()` | Disconnect and cleanup resources |
| `isConnected()` | Check connection status |
| `write({data})` | Write data to connected device |

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `dataReceived` | `{value: string}` | Raw serial data from scale |
| `connectionStateChanged` | `{connected: boolean}` | Connection state changes |

## Permission Handling

### Android 12+ (API 31+)
- `BLUETOOTH_CONNECT` - Required for connecting to paired devices
- `BLUETOOTH_SCAN` - Required for discovering devices

### Android 8-11 (API 26-30)
- `BLUETOOTH` - Basic Bluetooth operations
- `BLUETOOTH_ADMIN` - Bonded device access

## Supported Scales

The plugin is optimized for industrial SPP scales including:
- T-Scale DR Series (DR 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150)
- BTM Series Bluetooth modules
- HC-05/HC-06 modules
- Any device using standard SPP UUID

## Weight Data Parsing

The service includes multi-strategy weight parsing:
1. **Standard format**: `ST,GS,+ 12.345kg` 
2. **Decimal format**: `12.345`
3. **Grams format**: `12345` (auto-converts to kg)
4. **Binary format**: Various byte layouts

## Building

After pulling the code:

```bash
# Install dependencies
npm install

# Sync with Android
npx cap sync android

# Build the APK
cd android && ./gradlew assembleDebug
```

## Troubleshooting

### "Plugin not found" error
Ensure `MainActivity.kt` registers the plugin in `onCreate()`:
```kotlin
registerPlugin(BluetoothClassicPlugin::class.java)
```

### Connection timeout
Some industrial devices need the fallback connection method (automatically tried on first failure).

### No paired devices shown
1. Pair the scale in Android Bluetooth Settings first
2. Ensure Bluetooth permissions are granted
3. Check if the device name matches scale patterns

## Coexistence with BLE

This plugin works alongside the existing BLE implementation:
- **BLE**: For scales with Bluetooth Low Energy support (most modern BTM modules)
- **Classic SPP**: For legacy scales that only support serial port profile

The UI allows users to choose between "Connect via BLE (Scan)" and "Connect via Classic BT (Paired)".
