## Root cause (native printer SIGSEGV)

Confirmed from logcat:

1. `PosApiHelper.<clinit>` calls `getBCRService()` which looks up `com.android.server.bcr.IBCRService$Stub` → `ClassNotFoundException`. That AIDL stub only ships in Ciontek firmware that exposes the BCR (barcode) system service. The CS10 A26 (Android 7, build `full_a26_6737m/NRD90M`) firmware installed on this unit does not export it.
2. `libPosApi.so` then `dlopen`s `/vendor/lib64/libcustom_jni.so`. That file does not exist in our APK's `jniLibs/arm64-v8a/` (we only ship `libPosApi.so`, `libPaypassApi.so`, `libVisaLib.so`) and Android 7's linker namespace refuses to load third-party vendor `.so`s from `/vendor/lib64` for a non-system app. The linker error is followed immediately by `SIGSEGV` inside the SDK's static init because it dereferences a NULL function pointer that was supposed to come from `libcustom_jni.so`.

Conclusion: the `cs10-posapi.jar` / `libPosApi.so` we bundled is the **generic Ciontek POS SDK** (built for CS30Pro-class Android 10 firmware that ships `libcustom_jni.so` and the BCR system service). It is **binary-incompatible with the CS10 A26 Android 7 firmware** on this device. No amount of Java-side guarding can prevent the crash once `PosApiHelper.getInstance()` triggers the SDK's static initializer, because JNI `dlopen` failure + static init NPE happen inside the vendor native code.

The correct fix is (a) never call into a vendor SDK we cannot prove is loadable, and (b) obtain the CS10-A26–specific SDK from Ciontek. Until (b) is available, the app must degrade gracefully to the existing Bluetooth print path and never load `libPosApi.so`.

## Plan (v2.11.23, versionCode 165, fixTag `cs10-android7-hardening`)

### 1. Stop the native printer crash — probe before loading

`android/app/src/main/java/app/delicoop101/bluetooth/Cs10PrinterJsBridge.kt`

- Add a static `sdkUsable` gate computed **once**, before any reference to `PosApiHelper`, that checks:
  - `File("/vendor/lib64/libcustom_jni.so").exists()` OR `File("/system/vendor/lib64/libcustom_jni.so").exists()`
  - `Class.forName("com.android.server.bcr.IBCRService$Stub", false, classLoader)` in a `try/catch`
  - `Build.MANUFACTURER`/`Build.MODEL` allow-list for known-working Ciontek variants
- Only if `sdkUsable == true` do we ever touch `PosApiHelper` (import stays, but resolved lazily via `Class.forName("vpos.apipackage.PosApiHelper")` + reflection so the class loader never triggers `<clinit>` on unsupported firmware).
- `isAvailable()` returns `{available:false, reason:"cs10-sdk-incompatible", model, sdk}` when the gate is false — no crash, structured JSON to JS.
- `printText()` returns `{error:"cs10-sdk-unavailable"}` instead of throwing when the gate is false.
- Wrap the actual `PosApiHelper` calls in an inner class that is only class-loaded after the gate passes, so a mis-shipped SDK cannot ever run its static initializer on unsupported firmware.

### 2. Route around the internal printer when it is unusable

`src/services/bluetoothClassic.ts` (printer routing only — no receipt/formatting changes)

- Before choosing the CS10 internal path, call `Cs10PrinterAndroid.isAvailable()` and parse `available`. Only prefer internal if `available === true`.
- If unavailable, fall through to the existing Classic Bluetooth printer path exactly as before.
- Log `[CS10-PRINTER] Internal SDK unavailable (reason=…), using Bluetooth printer` once per session.

### 3. Hardware Back button

`src/main.tsx` (or new `src/utils/nativeBackButton.ts` imported from `main.tsx`)

- On native only, `import('@capacitor/app')` and register `App.addListener('backButton', …)`:
  - If `window.history.length > 1` and current route ≠ `/` → `window.history.back()`.
  - Else call `App.exitApp()`.
- Log `[BACK] Hardware back button pressed route=<pathname>`.
- No React Router or UI changes.

### 4. Native camera on Android 7

`src/components/PhotoCapture.tsx` capture path only (no UI/business logic changes)

- On native, always try Capacitor `Camera.getPhoto({ source: CameraSource.Camera, … })` first. Do **not** fall through to `getUserMedia` on native unless Capacitor throws a non-permission error.
- Before calling, explicitly `Camera.checkPermissions()` → `Camera.requestPermissions({ permissions: ['camera'] })` and abort with a toast if denied (matching existing pattern in `permissionRequests.ts`).
- Ensure `AndroidManifest.xml` declares `android.permission.CAMERA` and `<uses-feature android:name="android.hardware.camera" android:required="false" />` (add if missing — currently absent from the manifest shown).
- Structured logs: `[CAMERA] permission=granted|denied`, `[CAMERA] native capture ok`, `[CAMERA] native failed reason=… falling back to web`.

### 5. Haptics graceful degrade

`src/hooks/useHaptics.ts`

- Wrap every `Haptics.*` call in `try/catch`. On the first `UNIMPLEMENTED`/`Not implemented on android` error, set a module-level `hapticsSupported = false` and short-circuit all subsequent calls.
- Log `[HAPTICS] unsupported on this device, disabling` once.
- No behavior change beyond suppressing the noise.

### 6. Manifest + logging tidy

- Add `CAMERA` permission and camera `uses-feature` if missing.
- Bump `versionCode` to 165, `versionName` to 2.11.23, `APP_FIX_TAG` to `cs10-android7-hardening` in `src/constants/appVersion.ts`.

## What is explicitly NOT changed

Transactions, sync, IndexedDB, cumulative logic, receipt formatting/content, Bluetooth discovery/connect logic, existing plugin registration for `BluetoothClassic` / `OfflineStorage` / `BluetoothLe`, UI/theming, and printer receipt content. Only the printer *routing decision* and the native crash guard are touched in the print stack.

## Verification (after `npm run build && npx cap sync android` and reinstall)

- Tapping print no longer crashes; logcat shows `[CS10-PRINTER] Internal SDK unavailable` and the receipt prints over Bluetooth via the existing classic path.
- `Cs10PrinterAndroid.isAvailable()` from JS returns `{available:false, reason:"cs10-sdk-incompatible", …}` on this A26 unit.
- Hardware Back on the dashboard exits the app; on any inner route it navigates back.
- Camera capture opens the native camera intent, permission prompt appears once, photo returns to the app.
- No `Haptics ... not implemented` spam after the first suppressed log.

## Follow-up (out of scope for this build, needs the vendor)

Request the **CS10 A26 / Android 7 firmware-matched** POS SDK from Ciontek (the jar + `libPosApi.so` + `libcustom_jni.so` built against `full_a26_6737m/NRD90M`). Once received, drop them into `android/app/libs/` and `android/app/src/main/jniLibs/arm64-v8a/` and the gate above will start returning `available:true` on this hardware with no further code changes.
