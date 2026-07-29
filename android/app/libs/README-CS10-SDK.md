# CS10 POS SDK (vpos.apipackage / PosApiHelper)

The bundled `cs10-posapi.jar` + `jniLibs/*/libPosApi.so` are the **generic**
Ciontek/VPOS SDK. Some CS10 firmwares — notably `full_a26_6737m` /
Android 7.0 / build fingerprint `.../NRD90M/1608967428` — do **not** ship
one of the runtime dependencies the generic SDK needs (typically
`libcustom_jni.so` and/or the `com.android.server.bcr.IBCRService`
system service). On those units the current SDK crashes with SIGSEGV
inside `libPosApi.so` when `PosApiHelper.getInstance()` runs its
`<clinit>`.

Starting v2.11.25 the app runs a real init probe in an isolated
`:posprobe` process and reports the exact failing stage + missing library
to the WebView. If the diagnostic shows e.g.:

```
stage=loadLibrary  exception=java.lang.UnsatisfiedLinkError
missingLibrary=libcustom_jni.so
```

it means the bundled SDK is wrong for this firmware. In that case:

1. Contact Ciontek support and request the **CS10-specific** SDK matching
   your firmware fingerprint (share `Build.FINGERPRINT` from the diagnostic).
2. Replace the following files with the vendor drop:
   - `android/app/libs/cs10-posapi.jar`
   - `android/app/src/main/jniLibs/armeabi-v7a/libPosApi.so`
   - `android/app/src/main/jniLibs/arm64-v8a/libPosApi.so`
   - Any additional `.so` the vendor ships (e.g. `libcustom_jni.so`) into
     the same `jniLibs/<abi>/` folders.
3. Rebuild the APK — no Kotlin/TypeScript changes are required; the bridge
   loads the SDK reflectively.

The probe will pick up the new SDK on the next launch. If the vendor SDK
requires additional AIDL stubs or a bind to a system service, add them
here and to `Cs10PrinterProbeService.kt`.
