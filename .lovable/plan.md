
# Integrate recovered vendor POS SDK into PosApiPlugin — v2.11.28 (code 170)

## What I verified in the uploads

- `apipackage.zip` → 23 Java sources, package `vpos.apipackage` (`PosApiHelper`, `Sys`, `Print`, `Icc`, `Picc`, `Mcr`, `Scan`, `Fingerprint`, `IDCard`, `Key`, `Pci`, `APDU_SEND/RESP`, `ByteUtil`, `StringUtil`, `Session`, `FileTools`, `BarcodeCreater`, `AppTypeApi`, `AppTypeWindow`, `PasswordShow`, `CustomLayout`, `PrintInitException`).
- `cspos.zip` → `com.cspos.PaySys` (all EMV/PIN natives), plus `BuildConfig.java` and `R.java` from the vendor demo app.
- `armeabi-v7a.zip` → `libPosApi.so` (550,120 B) and `libPaypassApi.so` (405,948 B).
- The project already has `android/app/src/main/jniLibs/{armeabi-v7a,arm64-v8a}/` with *different* builds (v7a `libPosApi.so` is 599,280 B) plus a `libVisaLib.so`. The uploaded v7a pair comes from this exact device's PosDemo, so it wins.
- Gaps found in the recovered set (must be supplied or the build fails): `vpos.util.Util` (used by `PosApiHelper.SetMcuPowerMode`) and `vpos.apipackage.PrinterBitmap` (used by `Print.Bitmap2PrintDot`). Also `BarcodeCreater`/`ByteUtil`/`CustomLayout` import `android.support.v4.*` (project is AndroidX), and `AppTypeWindow`/`PasswordShow` import `com.cspos.R`.

## Plan

### 1. Native libraries

- Overwrite `android/app/src/main/jniLibs/armeabi-v7a/libPosApi.so` and `libPaypassApi.so` with the uploaded device-matched builds. Keep `libVisaLib.so` as-is.
- No arm64 versions were recovered, and mixing an unverified arm64 `libPosApi.so` with the recovered v7a Java layer is the most likely source of a fresh SIGSEGV. So: delete `jniLibs/arm64-v8a/` and pin `ndk { abiFilters "armeabi-v7a" }` in `android/app/build.gradle`. Every arm64 Android device also runs armeabi-v7a, so this loses no device coverage.

### 2. Add recovered SDK sources

Under `android/app/src/main/java/`:

```text
vpos/apipackage/  Sys, Print, PosApiHelper, PrintInitException, Icc, Picc, Mcr,
                  Scan, Fingerprint, IDCard, Key, Pci, AppTypeApi,
                  APDU_SEND, APDU_RESP, ByteUtil, StringUtil, Session,
                  FileTools, BarcodeCreater, PrinterBitmap (new)
vpos/util/        Util (new)
com/cspos/        PaySys
```

- **Excluded:** `AppTypeWindow`, `PasswordShow`, `CustomLayout`, `com.cspos.R`, `com.cspos.BuildConfig` — vendor demo UI/resource classes that reference `com.cspos.R` layouts we don't ship and that nothing in the printer/system path calls. Excluding them avoids dragging vendor resources into the app.
- **`PrinterBitmap` (new, 4 fields):** `m_iWidth`, `m_iHeight`, `m_iRowBytes`, `m_pDotByteBuffer` — exactly the shape `Print.Bitmap2PrintDot()` builds and consumes.
- **`vpos.util.Util` (new):** single `sleepMs(long)` helper, the only member referenced.
- **AndroidX fixes:** rewrite `android.support.v4.view.ViewCompat` → `androidx.core.view.ViewCompat`, `android.support.v4.internal.view.SupportMenu` → the literal int constants it provides, `android.support.v4.view.MotionEventCompat` → `androidx.core.view.MotionEventCompat` (only `BarcodeCreater` and `ByteUtil` remain after the exclusions).
- ZXing is already on the classpath (`com.google.zxing:core:3.5.1`), which satisfies `Print`/`BarcodeCreater`/`PosApiHelper` barcode signatures.
- `proguard-rules.pro`: add `-keep class vpos.** { *; }` and `-keep class com.cspos.** { *; }` so JNI-bound names survive a future minified build.

### 3. Rewrite `PosApi.java` as direct calls

Replace all reflection in `android/app/src/main/java/app/delicoop101/posapi/PosApi.java` with typed calls. Removed: `Class.forName`, `Method.invoke`, the `initError` / "PosApiHelper unavailable" path, and `hwUnavailable()` fallbacks. Kept: the `Result` struct, `mapRc()` printer-code mapping, and per-call `try/catch (Throwable)` for genuine runtime failures (`UnsatisfiedLinkError` from a bad firmware match still surfaces as a structured error rather than a crash).

Direct bindings (recovered signatures, not invented):

| Area | Call |
|---|---|
| init | `Sys.Lib_AppInit(ctx)` — once, guarded by an `AtomicBoolean` |
| system | `Sys.Lib_Beep/PowerOn/PowerOff/GetVersion/ReadSN/ReadChipID/GetTime/SetTime/LogSwitch/SetLed/SetEntryModeOpen/Close` |
| printer | `PosApiHelper.getInstance()` → `PrintInit(2,24,24,0)`, `PrintStr`, `PrintStart`, `PrintCheckStatus`, `PrintClose` (`PrintOpen()`/`PrintInit()` throw `PrintInitException`, so they're wrapped) |
| ICC / PICC / MSR | `Icc.Lib_*`, `Picc.Lib_*`, `Mcr.Lib_McrRead(keyNo, mode, t1, t2, t3)` |
| scanner | `Scan.Lib_ScanOpen/Close`, `Lib_ScanRead(short timeout, String[] out)` |
| fingerprint | `Fingerprint.Lib_FpOpen/Close/Register/Match/Code/DeleteAll` |
| ID card | `IDCard.Lib_IDCardOpen/Read/Read2/Close` |
| serial | `Sys.Lib_SendBytes/RecvBytes/SendPacket/RecvPacket` |
| PIN / EMV | `PaySys.CallKeyPad/Getpinblock/GetKLKpinblock/SetPadTime/SetPinType`, `PaySys.EmvContextInit/EmvProcess/EmvFinal/EmvGetTagData/EmvPrePare55Field/EmvSetTransAmount/EmvSetTransType/EmvSetCardType/EmvSetOnlineResult/EmvGetVersion/EmvAddOneCAPK/EmvAddOneAIDS/EmvSaveTermParas/EmvClearAllAIDS/EmvClearAllCapks` |

Two recovered signatures differ from the current reflective guesses and will be adapted **inside** `PosApi.java` so the TS surface is unchanged: `Fingerprint.Lib_FpRegister()` takes no id (the `id` argument is accepted and ignored), and `Scan.Lib_ScanRead` takes a `short` timeout.

`isReady()` becomes: `Sys.Lib_AppInit` completed **and** a `SysGetVersion` probe returned — no more class-presence check.

### 4. Untouched

`PosApiPlugin.java`, `src/plugins/pos-api/*` (`definitions.ts`, `index.ts`, `web.ts`), `bluetoothClassic.ts` internal-printer routing, `PrinterConnectionDialog.tsx`, `useDirectPrint.ts`, Classic Bluetooth scale/printer, payments, sync, IndexedDB, UI. The Capacitor method names, arguments and result shapes stay byte-identical.

### 5. Version

- `src/constants/appVersion.ts` → `2.11.28`, `APP_FIX_TAG = 'pos-api-vendor-sdk'`
- `android/app/build.gradle` → `versionCode 170`, `versionName "2.11.28"`

## Verification I can do here vs. on-device

Runnable in this environment: web typecheck/build stays green (no TS change), and no source references the retired bridges.

Not runnable here (no Android SDK/Gradle in the sandbox): the `:app:compileDebugJava` pass and every hardware assertion (`isReady()`, `initializePrinter`, `printReceipt`, `printerStatus`, absence of "PosApiHelper unavailable"). Those need `npx cap sync && ./gradlew assembleDebug` on your machine. I'll self-review every recovered source against its call sites for import/signature breakage before finishing, and list anything I couldn't statically resolve.

## Rollback

The change is confined to `jniLibs/`, the two new source trees, `PosApi.java`, `build.gradle`, and `proguard-rules.pro` — reverting those restores v2.11.27 exactly.
