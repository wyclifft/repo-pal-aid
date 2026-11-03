# Phase 4 Fix — Scale & Printer Auto-Connect (v2.12.108)

Scope: only the Bluetooth fixes diagnosed from the Nov 3 CS10 field log (`scale_fails_to_auto_connect_also_the_printer_pasted.log`). The code-audit findings (duplicates/data-integrity/perf) are parked for a later phase.

Device-agnostic guarantee: no device names, MACs, model strings or scale-specific parsing are touched. Every fix is keyed to standard stack behavior (GATT CCCD writes, RFCOMM socket errors, library loading) and error signatures, so any other scale or printer model keeps its current path or benefits from the same retry handling. If a device worked before, its flow is unchanged when no error occurs.

## Fix 1 — BLE scale: CCCD subscribe rejected on reconnect (root cause of "no weight data after BT off/on")

Log evidence: 75 × `reject: writeDescriptor | 0x2902 (CCCD) | Setting notification failed.` — every reconnect reached GATT connect but never re-subscribed, so the scale showed connected but streamed nothing.

Change in `src/services/bluetooth.ts` reconnect path (~line 1519):
- Ensure service discovery has fully completed before `startNotifications` (await discovery instead of using a cached service list).
- Retry the notification subscribe with short backoff (~300ms / 600ms / 1200ms) when the CCCD write fails; treat GATT-not-ready (status 133/201) as retryable.
- On final failure: disconnect + full retry cycle (existing behavior), so nothing is left half-subscribed.
- Applies to any BLE scale: it only adds retries around the standard subscribe step; the first-attempt success path is byte-for-byte unchanged.

## Fix 2 — Reconnect backoff churn (infinite "attempt 1 / retry in 2000ms")

Log evidence: each low-level disconnect event reset the attempt counter to 1 → 75 failures in ~2 minutes of hammering.

Change in `src/services/btConnectionManager.ts`:
- Keep exponential backoff per role across disconnect events (do not reset the attempt counter on a disconnect event while a retry is already scheduled).
- Cap retries; the existing health check restarts the cycle after the cap.
- No change to connection ordering or the printer/scale staggering guard (kept as-is — it broke the ping-pong loop).

## Fix 3 — Classic printer: quick retry on "bt socket closed, read return: -1"

Log evidence: first two connect attempts failed with `bt socket closed, read return: -1`; the printer connected fine on later attempts after a Bluetooth toggle.

Change in the Classic connect fallback (`src/services/bluetoothClassic.ts` / `btConnectionManager.ts`):
- On that specific error signature, schedule one quick delayed retry (~1.5s) before the long backoff.
- Generic: any Classic printer that briefly refuses the socket gets the fast retry; devices that connect first-time are unaffected.

## Fix 4 — Internal CS10 printer: library load error is silently swallowed

Log evidence: `Sys.Lib_AppInit failed: UnsatisfiedLinkError` — but the bundled `libPosApi.so` DOES export the JNI symbol, meaning `System.loadLibrary("PosApi")` itself failed on-device and `Sys.java`'s static block swallowed the Throwable, hiding the cause.

Change in `android/app/src/main/java/app/delicoop101/posapi/PosApi.java` (+ plugin error mapping):
- Load the library explicitly inside `appInit` (not via the silent static block), capture the exact Throwable (`dlopen failed: cannot locate symbol X` etc.), and surface it through `isReady` to JS and `/debug`.
- If the library loads fine (e.g. on other POS models or after the real cause is fixed), behavior is identical to today — this fix only makes the failure diagnosable, it does not change printer logic.
- Next field log will name the true on-device cause; a targeted follow-up can then fix it (dependency or build config), not guessed at.

## Note (no change unless fallback is broken)

SQLite backup writes to `Documents/DeliCoop_Backups` fail with `EACCES` every session and fall back to the next location. Verify the fallback succeeds; log as warning only. No permission/workflow changes.

## Version & verification

- Version 2.12.107 → 2.12.108 (bug-fix patch), `sw.js` cache v72 → v73, `package.json` aligned, changelog comments at each fix site.
- Regression checks: transaction creation, reference generation, receipt print, farmer/item sync, offline startup, build clean + typecheck.
- Bluetooth verification needs one new field log after this build: scale notifications resume after Bluetooth off/on; internal printer `isReady` reports the exact library-load error; printer auto-connects without a Bluetooth toggle.
- No `server.js` changes.
