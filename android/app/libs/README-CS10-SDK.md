# CS10 Internal Printer SDK (Ciontek PosManagerProvider)

Starting v2.11.26 the app no longer loads the generic `vpos.apipackage`
JNI SDK. That SDK targets a different device family and SIGSEGVs on the
CS10 A26 firmware. The correct integration — confirmed by the vendor
SDK PDF (`CS30Pro-SDK_instructions_V1.0.1.pdf`) and by the presence of
`/system/priv-app/PosManagerProvider/` on the device — is an **AIDL
bind to the `com.ciontek.posmanagerprovider` system service**, which
already ships pre-installed by Ciontek.

The bundled `cs10-posapi.jar` and `jniLibs/*/libPosApi.so` files are
retained for archival only. `cs10-posapi.jar` has been renamed to
`cs10-posapi.jar.disabled` so Gradle's `fileTree(include: ['*.jar'])`
no longer picks it up.

## What the app does now

1. `Cs10PrinterProbeService` runs in an isolated `:posprobe` process.
2. Inside that process, `CiontekServiceProbe` calls `PackageManager` to
   describe the installed `com.ciontek.posmanagerprovider` (version,
   services, exported flags) and tries to `bindService` to each known
   Ciontek AIDL interface:
   - `com.ciontek.ciontekposservice.ICiontekPosService`
   - `com.ciontek.sdk.IPosService`
   - `com.ctk.sdk.IPosService`
   - `com.pos.device.IPosService`
3. Whichever bind succeeds is reported back to the WebView with the
   interface descriptor.
4. In the main process, `CiontekPrinterBridge`:
   - If `com.ctk.sdk.PosApiHelper` is on the classpath (vendor JAR
     drop), uses it directly — `PrintInit`, `PrintStr`, `PrintStart`,
     `PrintCheckStatus`.
   - Otherwise reports `stage=missing-aidl` with the exact bound
     interface + descriptor so support can hand it to Ciontek.

## Enabling real printing — drop the CS10 vendor SDK

Ciontek ships a per-device SDK zip. Ask them for:

- `ciontek-cs10-SDK-v*.zip` matching your CS10 firmware
  (share `Build.FINGERPRINT` from the /debug diagnostic).

The zip mirrors the CS30Pro one and contains:

- `com/ctk/sdk/PosApiHelper.java` (wrapper)
- `aidl/com/ciontek/ciontekposservice/ICiontekPosService.aidl`

Drop them into the project like this:

- `android/app/libs/ciontek-cs10-sdk.jar` — compile the JAR from the
  vendor `.java` sources OR use the pre-built JAR they ship.
- `android/app/src/main/aidl/com/ciontek/ciontekposservice/ICiontekPosService.aidl`
  (exact path matters — AIDL generator is folder-driven).

Rebuild — no Kotlin/TypeScript change required. `CiontekPrinterBridge`
detects `PosApiHelper` reflectively and switches to the official path
on next launch.

## Deprecated files (kept on disk, not built)

- `android/app/libs/cs10-posapi.jar.disabled` — generic VPOS SDK,
  wrong for CS10.
- `android/app/src/main/jniLibs/*/libPosApi.so`,
  `libPaypassApi.so`, `libVisaLib.so` — no longer loaded. Safe to
  delete in a follow-up commit if the vendor drop confirms no `.so`
  dependency.
