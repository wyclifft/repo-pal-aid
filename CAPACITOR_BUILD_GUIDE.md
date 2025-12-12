# Capacitor Mobile App Build Guide

Complete guide to build and deploy the Milk Collection app as a native Android/iOS application.

## Prerequisites

### Required Software
- **Node.js** (v18+)
- **npm** or **yarn**
- **Git**
- **Android Studio** (for Android builds)
- **Xcode** (for iOS builds, Mac only)

### System Requirements
- **Android**: Android Studio with SDK 24+ (Android 7.0+)
- **iOS**: macOS with Xcode 14+

---

## Quick Start

### 1. Clone and Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd <project-folder>

# Install dependencies
npm install
```

### 2. Build the Web App

```bash
# Build for production
npm run build
```

### 3. Add Native Platforms

```bash
# Add Android
npx cap add android

# Add iOS (Mac only)
npx cap add ios
```

### 4. Sync Changes

```bash
# Sync web code to native projects
npx cap sync
```

### 5. Run on Device/Emulator

```bash
# Run on Android
npx cap run android

# Run on iOS (Mac only)
npx cap run ios
```

---

## Project Structure

```
project/
├── android/                 # Android native project
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml
│   │   │   ├── java/
│   │   │   └── res/
│   │   └── build.gradle
│   └── capacitor.settings.gradle
├── ios/                     # iOS native project (after cap add ios)
│   └── App/
├── src/                     # Web source code
├── dist/                    # Built web app (webDir)
├── capacitor.config.ts      # Capacitor configuration
└── package.json
```

---

## Configuration

### capacitor.config.ts

Key settings for native behavior:

```typescript
{
  appId: 'app.lovable.milkcollection',
  appName: 'Milk Collection',
  webDir: 'dist',
  
  android: {
    minWebViewVersion: 55,        // Chrome 55 minimum
    allowMixedContent: true,      // Allow HTTP in WebView
    backgroundColor: '#1a1a2e',
  },
  
  ios: {
    backgroundColor: '#1a1a2e',
    contentInset: 'automatic',
  },
  
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1a1a2e',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a1a2e',
    },
  },
}
```

### Development Hot-Reload

For live development on device, uncomment in `capacitor.config.ts`:

```typescript
server: {
  url: 'https://your-preview-url.lovableproject.com?forceHideBadge=true',
  cleartext: true,
}
```

---

## Android Build

### Debug APK

```bash
# Build debug APK
cd android
./gradlew assembleDebug

# APK location: android/app/build/outputs/apk/debug/app-debug.apk
```

### Release APK

1. **Create Signing Key** (first time only):
```bash
keytool -genkey -v -keystore milk-collection.keystore \
  -alias milk-collection -keyalg RSA -keysize 2048 -validity 10000
```

2. **Configure Signing** in `android/app/build.gradle`:
```gradle
android {
    signingConfigs {
        release {
            storeFile file('milk-collection.keystore')
            storePassword 'your-store-password'
            keyAlias 'milk-collection'
            keyPassword 'your-key-password'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
```

3. **Build Release APK**:
```bash
cd android
./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```

### Android App Bundle (for Play Store)

```bash
cd android
./gradlew bundleRelease
# AAB: android/app/build/outputs/bundle/release/app-release.aab
```

---

## iOS Build

### Development Build

```bash
# Open in Xcode
npx cap open ios

# Select device/simulator and run
```

### Archive for App Store

1. Open project in Xcode
2. Product → Archive
3. Window → Organizer
4. Distribute App

---

## Installed Capacitor Plugins

| Plugin | Purpose |
|--------|---------|
| `@capacitor/core` | Core Capacitor runtime |
| `@capacitor/android` | Android platform |
| `@capacitor/app` | App state, URL handling |
| `@capacitor/haptics` | Haptic feedback |
| `@capacitor/network` | Network status monitoring |
| `@capacitor/splash-screen` | Native splash screen |
| `@capacitor/status-bar` | Status bar styling |
| `@capacitor-community/bluetooth-le` | Bluetooth LE for scales/printers |

---

## Offline-First Architecture

### Service Worker Caching

The PWA service worker (`public/sw.js`) handles:
- **Static Assets**: Cached on install, never expire
- **API Responses**: Cached with network-first fallback
- **Dynamic Content**: Stale-while-revalidate strategy
- **Offline Fallback**: Shows offline page when unavailable

### IndexedDB Storage

Local database stores:
- **Farmers**: Cached farmer list
- **Receipts**: Pending/synced milk collections
- **Sessions**: Available collection sessions
- **Routes**: Route/tank information
- **Device Config**: Device fingerprint and settings

### Sync Strategy

1. **Offline Capture**: Data saved to IndexedDB
2. **Deduplication**: Prevents duplicate entries
3. **Background Sync**: Automatic sync when online
4. **Retry Logic**: Failed syncs retry with backoff
5. **Conflict Resolution**: Server timestamp wins

---

## Bluetooth Integration

### Scale Connection

```typescript
import { connectBluetoothScale } from '@/services/bluetooth';

const result = await connectBluetoothScale((weight, type) => {
  console.log(`Weight: ${weight} kg, Type: ${type}`);
});

if (result.success) {
  console.log('Connected to scale');
}
```

### Printer Connection

```typescript
import { connectBluetoothPrinter, printReceipt } from '@/services/bluetooth';

await connectBluetoothPrinter();
await printReceipt(receiptData);
```

---

## Performance Optimization

### Build Optimization (vite.config.ts)

- **Code Splitting**: Separate chunks for vendors
- **Tree Shaking**: Remove unused code
- **Minification**: Compressed production build
- **ES2015 Target**: Compatible with Android 7.0+

### Runtime Optimization

- **Lazy Loading**: Components loaded on demand
- **Virtual Scrolling**: Large lists rendered efficiently
- **Debounced Sync**: Prevents rapid API calls
- **Memory Management**: Cleanup on component unmount

---

## Troubleshooting

### Android Issues

**Blank Screen on Launch**
- Ensure `build.target` in `vite.config.ts` is `'es2015'`
- Check WebView version: must be Chrome 55+

**Bluetooth Not Working**
- Check Bluetooth permissions in AndroidManifest.xml
- Ensure location permission is granted (required for BLE)

**App Crashes**
- Check logcat: `adb logcat | grep -i "capacitor"`
- Look for JavaScript errors in WebView

### iOS Issues

**Build Fails**
- Update Xcode to latest version
- Run `pod install` in ios/App directory

**Network Requests Blocked**
- Check App Transport Security settings
- Ensure HTTPS is used for API calls

### General Issues

**Offline Sync Not Working**
- Check IndexedDB initialization in console
- Verify network status detection
- Look for sync errors in console

**Slow Performance**
- Enable production build (`npm run build`)
- Check for memory leaks in dev tools
- Verify large lists use virtualization

---

## Update Process

After code changes:

```bash
# 1. Build web app
npm run build

# 2. Sync to native projects
npx cap sync

# 3. Run updated app
npx cap run android
# or
npx cap run ios
```

---

## Environment Variables

For native builds, environment variables must be baked in at build time:

```bash
# Set before building
VITE_API_URL=https://backend.maddasystems.co.ke/api npm run build
```

---

## Support

For issues specific to:
- **Capacitor**: https://capacitorjs.com/docs
- **Android**: Check Android Studio logs
- **iOS**: Check Xcode console
- **Bluetooth**: See `SCALE_CONNECTION_GUIDE.md`
