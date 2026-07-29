
# PosApiPlugin — Capacitor 7 Vendor SDK Wrapper (v2.11.27)

Wrap the vendor POS SDK (`vpos.apipackage.*`, `com.cspos.PaySys`, `libPosApi.so`, `libPaypassApi.so`) in a single Capacitor plugin, retire the old CS10 printer bridge, and route the Internal CS10 Printer button through the new plugin. Only confirmed SDK methods are exposed; no invented APIs.

## Assumptions (from your answers)

- Vendor JAR is already at `android/app/libs/*.jar` (containing `vpos.apipackage.*`, `com.cspos.PaySys`, `vpos.apipackage.PosApiHelper`).
- Native libs are already at `android/app/src/main/jniLibs/<abi>/libPosApi.so` and `libPaypassApi.so`.
- Plugin lives inside the existing app module (`app.delicoop101.posapi`).
- Existing internal-printer bridge/probe from v2.11.25–26 is retired. All other pre-existing hardware paths (Classic BT scale, external printer, etc.) stay untouched.
- Java, AndroidX, Android 7+, Capacitor 7.

## Files

### New — Android

```
android/app/src/main/java/app/delicoop101/posapi/
    PosApi.java          // thin wrapper around PosApiHelper.getInstance() + PaySys
    PosApiPlugin.java    // @CapacitorPlugin, dispatches PluginCall -> PosApi
```

- `PosApi.java`
  - Static singleton, `init(Context)` calls `Sys.Lib_AppInit(ctx)` exactly once.
  - Holds one `PosApiHelper.getInstance()` reference.
  - One method per confirmed SDK call listed below. No invented calls.
  - Central `mapRc(int)` translating printer return codes: `0 -> ok`, `-1 -> NO_PAPER`, `-2 -> PRINTER_OVERHEATED`, `-3 -> LOW_BATTERY`, other -> `POS_ERR_<n>`.
- `PosApiPlugin.java`
  - `@CapacitorPlugin(name = "PosApi")`
  - `load()` calls `PosApi.init(getContext())` inside a try/catch — a failing init resolves subsequent calls with a structured error, never crashes.
  - All hardware work runs on a single background `HandlerThread` (JNI calls are not main-thread safe) and results are posted back to the Capacitor call.
  - `@PluginMethod` per exposed method below.

### New — TypeScript

```
src/plugins/pos-api/
    definitions.ts   // PosApiPlugin interface + option/result types + PosErrorCode union
    index.ts         // registerPlugin<PosApiPlugin>('PosApi', { web: () => new PosApiWeb() })
    web.ts           // PosApiWeb: every method rejects with 'UNIMPLEMENTED_ON_WEB'
```

### Modified

- `android/app/src/main/java/app/delicoop101/MainActivity.kt`
  - `registerPlugin(PosApiPlugin::class.java)` alongside existing plugins.
  - Remove registration/injection of the old CS10 printer JS bridge (`Cs10PrinterJsBridge`) and its call sites in `installDirectJsBridges`.
- `android/app/src/main/AndroidManifest.xml`
  - Remove the `:posprobe` service entry for `Cs10PrinterProbeService`.
- `src/components/PrinterConnectionDialog.tsx` and `src/hooks/useDirectPrint.ts`
  - Replace calls into the retired CS10 bridge with the new `PosApi` plugin (`initializePrinter` → `printReceipt` → `closePrinter`).
  - "Internal CS10 Printer" button always attempts `PosApi.printerStatus()` first; on error surfaces the returned `code`/`message` in the existing diagnostic panel.
- `src/constants/appVersion.ts` — bump to `2.11.27`, `APP_FIX_TAG = 'pos-api-plugin'`.
- `android/app/build.gradle` — `versionCode 169`, `versionName "2.11.27"`.

### Deleted (retire old printer path only)

- `android/app/src/main/java/app/delicoop101/bluetooth/Cs10PrinterJsBridge.kt`
- `android/app/src/main/java/app/delicoop101/bluetooth/Cs10PrinterProbeService.kt`
- `android/app/src/main/java/app/delicoop101/bluetooth/CiontekPrinterBridge.kt`
- `android/app/src/main/java/app/delicoop101/bluetooth/CiontekServiceProbe.kt`
- `android/app/libs/cs10-posapi.jar.disabled` (if still present; the real vendor JAR you dropped in stays)
- `android/app/libs/README-CS10-SDK.md`

Classic Bluetooth files (`BluetoothClassicPlugin.kt`, `BluetoothClassicJsBridge.kt`) are **not** touched.

## Exposed plugin methods (only confirmed SDK calls)

| Domain | Plugin method | Underlying SDK call(s) |
|---|---|---|
| System | `beep` | `Lib_Beep` |
| System | `powerOn` / `powerOff` | `Lib_PowerOn` / `Lib_PowerOff` |
| System | `getVersion` | `Lib_GetVersion` |
| System | `getSerial` | `Lib_ReadSN` |
| System | `getChipId` | `Lib_ReadChipID` |
| System | `getTime` / `setTime` | `Lib_GetTime` / `Lib_SetTime` |
| System | `setLed` | `Lib_SetLed` / `SysSetLedMode` |
| System | `setLog` | `Lib_LogSwitch` |
| System | `setEntryMode` | `Lib_SetEntryModeOpen` / `Lib_SetEntryModeClose` |
| Printer | `initializePrinter` | `PrintOpen`, `PrintInit(2,24,24,0)` |
| Printer | `printText` | `PrintStr` |
| Printer | `startPrint` | `PrintStart` |
| Printer | `printReceipt(lines[])` | `PrintOpen` → `PrintInit` → loop `PrintStr` → `PrintStart` |
| Printer | `closePrinter` | (state reset; SDK has no explicit close) |
| Printer | `printerStatus` | last `PrintStart` rc mapped via `mapRc` |
| ICC | `openCard` / `closeCard` / `checkCard` / `sendApdu` | `IccOpen` / `IccClose` / `IccCheck` / `IccCommand` |
| NFC | `openNfc` / `closeNfc` / `detectCard` / `sendApdu` / `removeCard` / `resetCard` / `entryPoint` | `PiccOpen` / `PiccClose` / `PiccCheck` / `PiccCommand` / `PiccRemove` / `PiccReset` / `EntryPoint` |
| MSR | `openMag` / `closeMag` / `resetMag` / `checkMag` / `readMagStripe` | `McrOpen` / `McrClose` / `McrReset` / `McrCheck` / `McrRead` |
| Scanner | `openScanner` / `scan` / `closeScanner` | `ScanOpen` / `ScanRead` / `ScanClose` |
| PIN Pad | `enterPin` / `getPinBlock` / `getKlkPinBlock` / `setTimeout` / `setPinType` | `PaySys.CallKeyPad` / `Getpinblock` / `GetKLKpinblock` / `SetPadTime` / `SetPinType` |
| EMV | `initEmv`, `startTransaction`, `completeTransaction`, `getTag`, `prepareField55`, `setAmount`, `setTransactionType`, `setCardType`, `setOnlineResult`, `getEmvVersion`, `loadCapk`, `loadAid`, `saveTermParas`, `clearAllAids`, `clearAllCapks` | Matching `PaySys.Emv*` methods |
| Fingerprint | `openFingerprint` / `closeFingerprint` / `captureFingerprint` / `matchFingerprint` / `getFingerprintCode` / `deleteFingerprints` | `FpOpen` / `FpClose` / `FpRegister` / `FpMatch` / `FpCode` / `FpDeleteAll` |
| ID Card | `openIdReader` / `readId` / `readId2` / `closeIdReader` | `IDCardOpen` / `IDCardRead` / `IDCardRead2` / `IDCardClose` |
| Serial | `send` / `receive` / `sendPacket` / `receivePacket` | `SendBytes` / `RecvBytes` / `SendPacket` / `RecvPacket` |

Every method returns `{ ok: true, ...data }` on success, or `reject(code, message)` where `code` is from the `PosErrorCode` union in `definitions.ts` (`NO_PAPER`, `PRINTER_OVERHEATED`, `LOW_BATTERY`, `NOT_INITIALIZED`, `HARDWARE_UNAVAILABLE`, `TIMEOUT`, `INVALID_ARGUMENT`, `POS_ERR_<n>`).

## Error handling contract

- Printer: `0 → ok`, `-1 → NO_PAPER`, `-2 → PRINTER_OVERHEATED`, `-3 → LOW_BATTERY`, other → `POS_ERR_<n>`.
- Any `UnsatisfiedLinkError` / `NoClassDefFoundError` / SDK bind failure at `load()` → subsequent calls reject `HARDWARE_UNAVAILABLE` with the JNI message attached.
- Missing/invalid arguments → `INVALID_ARGUMENT`.
- JNI methods returning non-zero (non-printer) → `POS_ERR_<n>` with the raw integer preserved for logging.

## Web fallback

`web.ts` implements every method as `throw this.unavailable('UNIMPLEMENTED_ON_WEB')` so the same TS API compiles in browser dev without leaking hardware calls.

## UI wiring (printer only)

`PrinterConnectionDialog.tsx` "Internal CS10 Printer" button flow becomes:

```text
tap → PosApi.initializePrinter()
    → PosApi.printReceipt({ lines: sampleLines })
    → PosApi.closePrinter()
    → toast success OR show diagnostic panel with { code, message } on reject
```

`useDirectPrint.ts` gains an `internalCs10` printer branch that calls `PosApi.printReceipt({ lines })` and maps errors to the existing toast/diagnostic UI.

## Verification checklist (before shipping)

- App builds on Java 17 / Android 7+ target.
- No compile-time reference to retired `Cs10PrinterJsBridge` / `CiontekPrinterBridge` remains.
- `MainActivity` startup logs show `PosApi` in the registered plugin list.
- Tapping Internal CS10 Printer either prints or produces a structured `{code, message}` — never a silent no-op or SIGSEGV.
- Existing flows (transaction create, receipt render, Classic BT scale, sync, photo capture) remain intact.
- Version stamped `2.11.27` / `versionCode 169` everywhere.

## Not in this pass

- ICC / NFC / MSR / EMV / PIN / fingerprint / ID / scanner UI surfaces — the plugin exposes them via TS but no screens are added.
- Standalone Capacitor plugin package (kept inside app module per your choice).
- Firmware-specific SDK swap tooling (JAR you dropped in is used as-is).
