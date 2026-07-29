
# v2.11.25 — CS10 Internal Printer: Real Initialization, No Silent Disable

## Goal

Selecting **Internal CS10 Printer** must actually try to initialize the built-in thermal printer on the CS10 A26 (Android 7, WebView 51) and print. If it cannot, the user must see a precise diagnostic (which class/library/service is missing), not a silent `available:false`. The app must never crash, and we must never fall back to Bluetooth when the user explicitly picked the internal printer.

Transaction, sync, Bluetooth, receipt formatting, IndexedDB, and UI logic are **out of scope**.

## Current state (verified)

- Bundled SDK: `android/app/libs/cs10-posapi.jar` — package `vpos.apipackage.*` (generic Ciontek/VPOS SDK, `PosApiHelper` present).
- Bundled native libs: `libPosApi.so`, `libPaypassApi.so`, `libVisaLib.so` for `armeabi-v7a` and `arm64-v8a` under `android/app/src/main/jniLibs/`.
- `Cs10PrinterJsBridge.kt` currently gates on the presence of `/vendor/lib*/libcustom_jni.so` **and** `com.android.server.bcr.IBCRService$Stub`. On the CS10 A26 firmware these probes fail, so `available:false` is returned and the class is never loaded. This gate is the reason the user sees the feature permanently disabled.
- The previous SIGSEGV happened inside `libPosApi.so` during `PosApiHelper.<clinit>` / `getInstance()`, so a plain in-process try/catch cannot save us — but a crash in a **separate probe process** can.

The assumption that "libcustom_jni.so + IBCRService are required" is **not verified against vendor docs** for this exact firmware; it was a heuristic from the crash trace. The plan treats it as unverified and replaces it with a real init attempt plus a proper diagnostic.

## Plan

### 1. Remove the permanent gate; add a real, crash-safe init probe

Rewrite `android/app/src/main/java/app/delicoop101/bluetooth/Cs10PrinterJsBridge.kt` so it:

- Stops using `libcustom_jni.so` / `IBCRService` presence as a hard block.
- On first `isAvailable()` / `status()` / `printText()` call, runs a **one-shot native init probe in a separate Android process** (`android:process=":posprobe"` service). The probe:
  1. `System.loadLibrary("PosApi")` and reports success/failure + `UnsatisfiedLinkError` message (missing symbol / dependent `.so`).
  2. `Class.forName("vpos.apipackage.PosApiHelper")` + `getInstance()` + `PrintInit()` + `PrintCheckStatus()`.
  3. Writes the structured result (ok / stage-that-failed / exception class / message / missing library name) to a small file the main process reads.
- If the probe process dies (SIGSEGV, killed by zygote), the parent detects the missing result file and records `crash-at-<stage>` with the last logcat line captured via `Runtime.exec("logcat -d -t 200 *:E")` filtered for `libPosApi|PosApiHelper|DEBUG|SIGSEGV`.
- If the probe succeeds, the main process performs the real `PosApiHelper.getInstance()` normally (safe now) and caches the helper for the app session.
- If the probe fails, `isAvailable()` returns `available:false` **with a structured diagnostic** (`stage`, `missingLibrary`, `exception`, `logcatTail`) so the UI can show the exact reason.

### 2. Expose a rich diagnostic to the WebView

Update the JSON returned by `isAvailable()` / `status()` / `printText()` to always include:

```json
{
  "available": false,
  "stage": "loadLibrary|getInstance|printInit|printCheckStatus|print",
  "exception": "java.lang.UnsatisfiedLinkError",
  "missingLibrary": "libcustom_jni.so",
  "logcatTail": "…",
  "sdkBuild": "cs10-posapi.jar sha=…",
  "firmware": "full_a26_6737m/NRD90M/1608967428",
  "model": "CS10", "sdk": 24
}
```

### 3. Do not fall back to Bluetooth when the user picked Internal

In `src/services/bluetoothClassic.ts` and `src/components/PrinterConnectionDialog.tsx`:

- When the selected printer is `internal-cs10`, do not silently switch to Classic Bluetooth on failure.
- Show the structured diagnostic (stage / missing library / logcat tail) in the dialog so the user can report it verbatim.
- Keep a manual "Try Classic Bluetooth instead" button — never an automatic fallback.

No changes to receipt formatting, transaction, or sync code.

### 4. SDK-swap path (only if the probe proves the bundled SDK is wrong)

If step 1 reports `UnsatisfiedLinkError: dlopen failed: library "libcustom_jni.so" not found` or similar, that is proof the bundled generic VPOS SDK does not match the CS10 A26 firmware. In that case:

- Document the exact missing dependency in the diagnostic.
- Add `android/app/libs/README-CS10-SDK.md` describing which vendor SDK variant to obtain from Ciontek for firmware `full_a26_6737m` and how to drop it in (`cs10-posapi.jar` + matching `libPosApi.so` / `libcustom_jni.so`).
- Once the correct SDK is provided by the user (Ciontek ships per-firmware SDKs), swapping the JAR + `.so` files is a file replacement — no code change beyond bumping the SDK hash in `Cs10PrinterJsBridge.kt`.

This plan does **not** commit to bundling a specific replacement SDK sight unseen; it commits to producing the diagnostic that tells us whether a swap is needed, and — if it is — to accept the vendor drop.

### 5. Crash protection stays

- The isolated `:posprobe` process guarantees a native crash cannot terminate the main app.
- The main process wraps every subsequent SDK call in `try { … } catch (Throwable)` + `Thread.setDefaultUncaughtExceptionHandler` scoped to the printer worker thread.

### 6. Version bump

- `src/constants/appVersion.ts`: `v2.11.25`, `APP_FIX_TAG = 'cs10-internal-printer-real-init'`.
- `android/app/build.gradle`: `versionCode 167`, `versionName "2.11.25"`.

## Files to change

- `android/app/src/main/java/app/delicoop101/bluetooth/Cs10PrinterJsBridge.kt` — remove gate, add probe orchestration + diagnostics.
- `android/app/src/main/java/app/delicoop101/bluetooth/Cs10PrinterProbeService.kt` — **new**, runs in `:posprobe`.
- `android/app/src/main/AndroidManifest.xml` — declare the probe service with `android:process=":posprobe"`.
- `src/services/bluetoothClassic.ts` — surface structured diagnostic; no auto-fallback for `internal-cs10`.
- `src/components/PrinterConnectionDialog.tsx` — render diagnostic (stage, missing lib, logcat tail) when internal init fails; keep manual BT switch.
- `src/constants/appVersion.ts`, `android/app/build.gradle` — version bump.
- `android/app/libs/README-CS10-SDK.md` — **new**, SDK swap instructions.

## Acceptance criteria

1. Tapping **Internal CS10 Printer** actually calls into the native SDK on the device (verifiable in logcat by `PosApiHelper` / `libPosApi` entries), instead of being blocked by the pre-check.
2. If the SDK initializes, a receipt prints on the built-in thermal head.
3. If it fails, the dialog shows a precise stage + missing dependency + logcat snippet.
4. The app never crashes, regardless of what the SDK does.
5. No automatic fallback to Bluetooth when Internal was selected.
6. No changes to receipts, transactions, sync, Bluetooth pairing, IndexedDB, or unrelated UI.
