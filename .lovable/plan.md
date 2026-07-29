
# v2.11.26 — CS10 Internal Printer: Bind to `com.ciontek.posmanagerprovider`, drop the wrong JNI SDK

## Why the current bundle can never work

The Ciontek SDK PDF you uploaded (`CS30Pro-SDK_instructions_V1.0.1.pdf`) and the system app you found on the CS10 (`com.ciontek.posmanagerprovider` in `/system/priv-app/PosManagerProvider/`) together prove the integration pattern:

- The real Ciontek SDK is **`com.ctk.sdk.PosApiHelper`**, which is a thin wrapper. It does NOT talk to the printer via JNI. It calls into `com.ciontek.ciontekposservice.ICiontekPosService` — an AIDL interface exported by the `PosManagerProvider` system app. That system app owns the hardware (printer, scanner, IC card, serial port).
- What we currently ship (`android/app/libs/cs10-posapi.jar`, package `vpos.apipackage.PosApiHelper`, plus `libPosApi.so` + `libcustom_jni.so` expectations) is the **generic VPOS/Ciontek reference SDK** for a different device family. It tries to load its own `.so` and expects a different system service (`IBCRService`). That is why every attempt SIGSEGVs or fails with `ClassNotFoundException: com.android.server.bcr.IBCRService$Stub` on this CS10 A26 firmware.

Trying harder to load `vpos.apipackage` on this device is a dead end. The fix is to stop using the bundled JAR and instead bind to the Ciontek service that is already installed on the device.

## Plan

### 1. Add a native-side discovery probe (no vendor SDK required)

New `CiontekServiceProbe.kt` that runs in the isolated `:posprobe` process (same pattern as v2.11.25) and writes a JSON report the WebView can display:

- `PackageManager.getPackageInfo("com.ciontek.posmanagerprovider", GET_SERVICES | GET_META_DATA)` → dump versionName, versionCode, uid, installed path, list every `<service>` component + its declared actions/permissions.
- Try `bindService(Intent("com.ciontek.ciontekposservice.ICiontekPosService").setPackage("com.ciontek.posmanagerprovider"))`. Report bind result: `success`, `SecurityException`, `not-found`, or timeout.
- If bind succeeds, use reflection to enumerate the returned `IBinder`'s `getInterfaceDescriptor()` and any published Stub class name found via `ServiceManager.getService`/`Binder.queryLocalInterface`. That tells us the exact AIDL FQN for this firmware.
- Also probe alternate known Ciontek interface names in case A26 uses a different one: `com.ciontek.sdk.IPosService`, `com.ctk.sdk.IPosService`, `com.pos.device.IPosService`.

This step can ship without any vendor drop and immediately tells us which interface to code against.

### 2. Retire the wrong JNI SDK from the active path

- Remove the `System.loadLibrary("PosApi")` + `Class.forName("vpos.apipackage.PosApiHelper")` code path from `Cs10PrinterProbeService.kt` and `Cs10PrinterJsBridge.kt`.
- Do NOT delete `android/app/libs/cs10-posapi.jar` or the `jniLibs/*/libPosApi.so` files yet — leave them on disk behind a `.disabled` rename so we don't lose the artifacts, and so the APK size drop is a separate reviewable change.
- The isolated `:posprobe` process stays (crash containment), but its job changes from "load libPosApi" to "bind PosManagerProvider and report".

### 3. Add a real Ciontek printer bridge (AIDL-based)

New `CiontekPrinterBridge.kt` that:
- Binds to `com.ciontek.posmanagerprovider` using the interface name confirmed by step 1.
- Caches the `IBinder` for the app session; auto-rebinds on `onServiceDisconnected`.
- Calls the printer methods (`PrintInit`, `PrintSetFont`, `PrintStr`, `PrintStart`, `PrintCheckStatus`) via the AIDL proxy generated from the Ciontek `.aidl`.
- Exposes the same `@JavascriptInterface` surface the WebView already calls (`isAvailable`, `status`, `printText`, `retryProbe`) so **no frontend change is needed**.

This requires the vendor `.aidl` file. Two paths, in order of preference:

**a. Preferred — you provide the CS10 SDK drop from Ciontek.** Ask Ciontek for the "CS10 / A26 firmware" SDK zip (they ship one per device family, exactly like the CS30Pro one you attached). We drop:
- `android/app/src/main/aidl/com/ciontek/ciontekposservice/ICiontekPosService.aidl`
- `android/app/libs/ciontek-cs10-sdk.jar` (contains `com.ctk.sdk.PosApiHelper` for CS10)

Then `CiontekPrinterBridge.kt` calls `PosApiHelper.getInstance().PrintStr(...)` exactly as the PDF shows. No JNI, no `.so`.

**b. Fallback if the vendor drop is delayed — reflective AIDL.** After step 1 confirms the interface FQN and method signatures, hand-write the minimal AIDL locally (only the Print* methods we need) and invoke it via `android.os.Parcel` + `IBinder.transact`. This is uglier but unblocks printing without waiting on Ciontek. If method transaction codes differ per firmware, the diagnostic from step 1 tells us; we don't guess.

The plan implements path (b) as a stub with clear TODOs, and path (a) becomes a JAR/AIDL drop-in with no further code change — mirroring how we already handle the SDK swap in `README-CS10-SDK.md`.

### 4. Rich diagnostic surfaces

Extend the JSON returned to the WebView with the PosManagerProvider discovery result:

```json
{
  "available": false,
  "provider": {
    "package": "com.ciontek.posmanagerprovider",
    "versionName": "…", "versionCode": …,
    "services": [
      { "name": "…PosService", "actions": ["com.ciontek.ciontekposservice.ICiontekPosService"], "permission": null }
    ],
    "bind": { "interface": "com.ciontek.ciontekposservice.ICiontekPosService", "result": "success|not-found|security|timeout" }
  },
  "stage": "bind|print|checkStatus",
  "exception": "…", "message": "…",
  "sdk": 24, "fingerprint": "…"
}
```

`PrinterConnectionDialog.tsx` renders the provider block under "Show diagnostic" — no other UI changes.

### 5. Manifest permission

Add `<queries><package android:name="com.ciontek.posmanagerprovider" /></queries>` to `AndroidManifest.xml` so `getPackageInfo` and explicit `bindService` work on Android 11+ builds (harmless on Android 7). No dangerous permission needed for the bind itself; the Ciontek service is exported.

### 6. No fallback to Bluetooth when Internal is selected

Unchanged from v2.11.25.

### 7. Version bump

- `src/constants/appVersion.ts`: `v2.11.26`, `APP_FIX_TAG = 'cs10-pos-manager-provider-aidl'`.
- `android/app/build.gradle`: `versionCode 168`, `versionName "2.11.26"`.

## Files to change

- `android/app/src/main/java/app/delicoop101/bluetooth/CiontekServiceProbe.kt` — **new**, discovery probe (runs in `:posprobe`).
- `android/app/src/main/java/app/delicoop101/bluetooth/CiontekPrinterBridge.kt` — **new**, AIDL binder + `@JavascriptInterface` surface.
- `android/app/src/main/java/app/delicoop101/bluetooth/Cs10PrinterProbeService.kt` — swap payload from `loadLibrary("PosApi")` to `CiontekServiceProbe.run(this)`.
- `android/app/src/main/java/app/delicoop101/bluetooth/Cs10PrinterJsBridge.kt` — delegate print calls to `CiontekPrinterBridge`; keep the JS-facing method names so `PrinterConnectionDialog.tsx` needs no change.
- `android/app/src/main/AndroidManifest.xml` — add `<queries>` entry for `com.ciontek.posmanagerprovider`.
- `android/app/libs/cs10-posapi.jar` → renamed to `cs10-posapi.jar.disabled` (kept for archival).
- `android/app/libs/README-CS10-SDK.md` — rewrite: explain that CS10 uses the AIDL provider `com.ciontek.posmanagerprovider`, list what to request from Ciontek, and how to drop in the CS10 `.aidl` + `PosApiHelper.jar`.
- `src/constants/appVersion.ts`, `android/app/build.gradle` — version bump.

**Not touched**: any transaction, sync, IndexedDB, receipt formatting, Bluetooth, or unrelated UI code. `PrinterConnectionDialog.tsx` gets zero logic changes; the "Show diagnostic" panel already renders whatever JSON the bridge returns.

## Acceptance criteria

1. On the CS10 A26 device, tapping **Internal CS10 Printer** attempts an AIDL bind to `com.ciontek.posmanagerprovider` (verifiable in logcat).
2. The diagnostic panel shows the PosManagerProvider version, exported services, and the bind result — no matter what.
3. If bind succeeds and the AIDL methods are available (either from the vendor drop or the reflective fallback), a receipt prints on the built-in thermal head.
4. If bind fails, the exact reason (permission denied / interface not found / security exception) is shown; nothing crashes and no silent fallback to Bluetooth happens.
5. `vpos.apipackage.PosApiHelper` is no longer loaded at runtime.

## What I need from you to complete path (a)

The CS10-specific SDK from Ciontek — they ship it exactly like the CS30Pro zip you attached (`ciontek-cs10-SDK-v*.zip`, containing `com/ctk/sdk/PosApiHelper.java` and `aidl/com/ciontek/ciontekposservice/ICiontekPosService.aidl`). Share your CS10 `Build.FINGERPRINT` (already captured in v2.11.25's diagnostic) so their support gives the matching version.

Path (b) — the reflective AIDL fallback — will still ship in v2.11.26 so you have working printing to test with even before Ciontek responds; the vendor drop then becomes a pure JAR+AIDL replacement, no further code change.
