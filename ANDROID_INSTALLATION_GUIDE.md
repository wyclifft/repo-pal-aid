# Android Installation Guide for POS CS10 (Android 7.0+)

## Prerequisites
- A computer with Node.js installed
- Android Studio installed (for building the APK)
- USB cable to connect POS device to computer

## Step 1: Export and Clone Project

1. Click "Export to GitHub" button in Lovable
2. Clone the repository to your computer:
   ```bash
   git clone [your-repo-url]
   cd [your-repo-name]
   ```

## Step 2: Install Dependencies

```bash
npm install
```

## Step 3: Build the Web App

```bash
npm run build
```

## Step 4: Add Android Platform

```bash
npx cap add android
```

## Step 5: Configure Android for Android 7.0

The project is already configured for Android 7.0+ (API level 24). Verify the configuration in `android/app/build.gradle`:

```gradle
minSdkVersion 24  // Android 7.0
targetSdkVersion 33
```

## Step 6: Sync Capacitor

```bash
npx cap sync android
```

## Step 7: Build APK in Android Studio

### Option A: Using Android Studio (Recommended)
1. Open Android Studio
2. Open the `android` folder from your project
3. Wait for Gradle sync to complete
4. Go to **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
5. Once complete, click "locate" to find the APK file
6. The APK will be in: `android/app/build/outputs/apk/debug/app-debug.apk`

### Option B: Using Command Line
```bash
cd android
./gradlew assembleDebug
```
APK location: `android/app/build/outputs/apk/debug/app-debug.apk`

## Step 8: Install APK on POS CS10

### Method 1: USB Installation (Recommended)
1. Enable **Developer Options** on POS CS10:
   - Go to **Settings** → **About Phone**
   - Tap **Build Number** 7 times
   
2. Enable **USB Debugging**:
   - Go to **Settings** → **Developer Options**
   - Enable **USB Debugging**

3. Connect POS CS10 to computer via USB

4. Install APK using ADB:
   ```bash
   adb install android/app/build/outputs/apk/debug/app-debug.apk
   ```

### Method 2: File Transfer
1. Copy `app-debug.apk` to a USB drive or SD card
2. Insert into POS CS10
3. Use a file manager to locate the APK
4. Tap to install (you may need to enable "Install from Unknown Sources")

### Method 3: Direct Transfer
1. Connect POS CS10 to computer
2. Copy APK to device storage
3. On device, use file manager to find and install APK

## Step 9: Enable Installation from Unknown Sources

If you see a security warning:
1. Go to **Settings** → **Security**
2. Enable **Unknown Sources** (or **Install Unknown Apps**)
3. Return and install the APK

## Step 10: Launch App

1. Find "Milk Collection" app in app drawer
2. Tap to open
3. App will work offline automatically!

## Troubleshooting

### App shows blank screen on Android 7.0
**This is the most common issue!** Android 7.0 uses an older WebView (Chrome 55) that requires specific build settings.

**Solution:**
1. Make sure `vite.config.ts` has the correct build target:
   ```typescript
   build: {
     target: 'es2015', // Critical for Android 7.0 compatibility
     minify: 'terser',
   }
   ```

2. Rebuild the app completely:
   ```bash
   npm run build
   npx cap sync android
   ```

3. In Android Studio, clean and rebuild:
   - **Build** → **Clean Project**
   - **Build** → **Rebuild Project**
   - **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**

4. If still blank, check Android Studio Logcat for JavaScript errors

### App crashes on Android 7.0
- Ensure you're using the debug APK first
- Check Android Studio Logcat for errors
- Verify minSdkVersion is 24 in build.gradle
- Make sure you rebuilt after changing vite.config.ts

### Unable to install APK
- Make sure USB debugging is enabled
- Check if "Install from Unknown Sources" is enabled
- Try different USB cable/port

### App works on Android 9+ but not Android 7.0
- This is a JavaScript compatibility issue
- Verify `build.target: 'es2015'` is set in vite.config.ts
- Run complete rebuild process (clean, build, sync)
- Older Android versions need ES2015 JavaScript, not modern ES2020+

## Building Production APK (For Distribution)

### Generate Signing Key
```bash
keytool -genkey -v -keystore my-release-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

### Create Release Build
1. In Android Studio: **Build** → **Generate Signed Bundle / APK**
2. Select **APK**
3. Choose your keystore file
4. Enter keystore password
5. Select **release** build variant
6. Build

### Install Release APK
```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

## Updating the App

When you make changes:
1. Pull latest code: `git pull`
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Sync: `npx cap sync android`
5. Rebuild APK in Android Studio
6. Reinstall on device

## Offline Functionality

The app automatically works offline with:
- ✅ Local data storage (IndexedDB)
- ✅ Cached company data
- ✅ Offline login
- ✅ Auto-sync when back online
- ✅ Service worker caching

No additional configuration needed!

## Support

For issues or questions:
- Check Android Studio Logcat for error messages
- Review console logs in Chrome DevTools (chrome://inspect)
- Ensure device is running Android 7.0 or higher
