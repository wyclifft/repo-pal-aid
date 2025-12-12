# Capacitor Mobile App Build Guide (Windows CMD)

Complete guide to build and deploy the Milk Collection app as a native Android application on Windows.

## Prerequisites

### Required Software
- **Node.js** (v18+) - Download from https://nodejs.org
- **Git for Windows** - Download from https://git-scm.com
- **Android Studio** - Download from https://developer.android.com/studio

### Android Studio Setup
1. Download and install Android Studio
2. Open Android Studio → SDK Manager (File → Settings → Languages & Frameworks → Android SDK)
3. In "SDK Platforms" tab, install:
   - Android 14 (API 34) or latest
4. In "SDK Tools" tab, install:
   - Android SDK Build-Tools
   - Android SDK Command-line Tools
   - Android SDK Platform-Tools
   - Android Emulator (optional, for testing without physical device)

### Set Environment Variables (Windows)
1. Open System Properties → Advanced → Environment Variables
2. Under "User variables", click "New" and add:
   - Variable name: `ANDROID_HOME`
   - Variable value: `C:\Users\<YourUsername>\AppData\Local\Android\Sdk`
3. Edit the "Path" variable and add:
   - `%ANDROID_HOME%\platform-tools`
   - `%ANDROID_HOME%\cmdline-tools\latest\bin`
4. Click OK and restart CMD

---

## Step-by-Step Build Guide (Windows CMD)

### Step 1: Navigate to Project and Install Dependencies

```cmd
cd C:\Users\TESH\milkapp\repo-pal-aid

npm install
```

### Step 2: Build the Web App

**IMPORTANT: Use `npm run build` NOT `npx run build`**

```cmd
npm run build
```

This creates the `dist` folder with your compiled web app.

### Step 3: Add Android Platform (First Time Only)

```cmd
npx cap add android
```

### Step 4: Sync Web App to Android

Run this every time you make code changes:

```cmd
npx cap sync android
```

### Step 5: Build Debug APK

```cmd
cd android
gradlew.bat assembleDebug
```

Wait for the build to complete. Your APK will be at:
```
android\app\build\outputs\apk\debug\app-debug.apk
```

### Step 6: Install APK to Phone

1. Connect your Android phone via USB
2. Enable "USB Debugging" on your phone (Settings → Developer Options)
3. Run:

```cmd
adb install app\build\outputs\apk\debug\app-debug.apk
```

Or copy the APK file to your phone and install it manually.

---

## Quick Reference Commands (Windows CMD)

```cmd
:: Navigate to project
cd C:\Users\TESH\milkapp\repo-pal-aid

:: Install dependencies (first time or after pull)
npm install

:: Build web app (CORRECT command)
npm run build

:: Sync to Android
npx cap sync android

:: Build debug APK
cd android
gradlew.bat assembleDebug

:: Build release APK
cd android
gradlew.bat assembleRelease

:: Open in Android Studio
npx cap open android

:: Check connected devices
adb devices

:: Install APK to connected device
adb install android\app\build\outputs\apk\debug\app-debug.apk
```

---

## Complete Build Flow (Copy-Paste Ready)

Run these commands one by one in Windows CMD:

```cmd
cd C:\Users\TESH\milkapp\repo-pal-aid
npm install
npm run build
npx cap sync android
cd android
gradlew.bat assembleDebug
```

After successful build, find your APK at:
`C:\Users\TESH\milkapp\repo-pal-aid\android\app\build\outputs\apk\debug\app-debug.apk`

---

## Project Structure

```
repo-pal-aid/
├── android/                 # Android native project
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml
│   │   │   ├── java/
│   │   │   └── res/
│   │   └── build.gradle
│   └── gradlew.bat          # Windows build script
├── src/                     # Web source code
├── dist/                    # Built web app (created by npm run build)
├── capacitor.config.ts      # Capacitor configuration
└── package.json
```

---

## Building Release APK (For Distribution)

### 1. Create Signing Key (First Time Only)

Open CMD in your project folder:

```cmd
keytool -genkey -v -keystore milk-collection.keystore -alias milk-collection -keyalg RSA -keysize 2048 -validity 10000
```

Follow the prompts to set a password and key details.

### 2. Configure Signing

Edit `android\app\build.gradle` and add before `dependencies`:

```gradle
android {
    signingConfigs {
        release {
            storeFile file('../../milk-collection.keystore')
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

### 3. Build Release APK

```cmd
cd android
gradlew.bat assembleRelease
```

Release APK location:
`android\app\build\outputs\apk\release\app-release.apk`

---

## Configuration

### capacitor.config.ts

Key settings:

```typescript
{
  appId: 'app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e',
  appName: 'repo-pal-aid',
  webDir: 'dist',
  
  android: {
    minWebViewVersion: 55,
    allowMixedContent: true,
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

For live development on device, the config already includes:

```typescript
server: {
  url: 'https://a468e475-ee6a-4fda-9a7e-5e39ba8c375e.lovableproject.com?forceHideBadge=true',
  cleartext: true,
}
```

This lets the app load from the Lovable preview server for instant updates.

---

## Installed Capacitor Plugins

| Plugin | Version | Purpose |
|--------|---------|---------|
| `@capacitor/core` | ^7.4.4 | Core Capacitor runtime |
| `@capacitor/android` | ^7.4.4 | Android platform |
| `@capacitor/cli` | ^7.4.4 | Capacitor CLI |
| `@capacitor/app` | ^7.1.1 | App state, URL handling |
| `@capacitor/haptics` | ^7.0.3 | Haptic feedback (vibration) |
| `@capacitor/network` | ^7.0.3 | Network status monitoring |
| `@capacitor/preferences` | ^7.0.3 | Persistent key-value storage |
| `@capacitor/splash-screen` | ^7.0.4 | Native splash screen |
| `@capacitor/status-bar` | ^7.0.4 | Status bar styling |
| `@capacitor-community/bluetooth-le` | ^7.2.0 | Bluetooth LE for scales/printers |

---

## Troubleshooting

### "Cannot find module 'build'" Error
You typed `npx run build` which is wrong. Use `npm run build` instead.

### "gradlew is not recognized"
Make sure you're in the `android` folder:
```cmd
cd android
gradlew.bat assembleDebug
```

### "ANDROID_HOME is not set"
Set environment variable (see Prerequisites section above).

### "SDK not found"
1. Open Android Studio
2. Go to File → Settings → Languages & Frameworks → Android SDK
3. Note the "Android SDK Location" path
4. Set that as your ANDROID_HOME environment variable

### Build Fails with Gradle Errors
```cmd
cd android
gradlew.bat clean
gradlew.bat assembleDebug
```

### Blank Screen on Launch
- Ensure `npm run build` completed successfully
- Check that `dist` folder exists and has content
- Run `npx cap sync android` again

### Bluetooth Not Working
Check that these permissions exist in `android\app\src\main\AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.BLUETOOTH"/>
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN"/>
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"/>
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
```

### Check Logs
```cmd
adb logcat | findstr -i "capacitor"
```

---

## Update Process

After making code changes in Lovable:

```cmd
:: 1. Pull latest changes
git pull

:: 2. Install any new dependencies
npm install

:: 3. Build web app
npm run build

:: 4. Sync to Android
npx cap sync android

:: 5. Build new APK
cd android
gradlew.bat assembleDebug
```

---

## Support

- **Capacitor Docs**: https://capacitorjs.com/docs
- **Android Studio**: Check logs in Logcat tab
- **Bluetooth Issues**: See `SCALE_CONNECTION_GUIDE.md`
