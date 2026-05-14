## Goal

Make the Bluetooth scale and printer connections **survive app lifecycle events** (background, logout, lock screen, device power-cycle) and self-heal automatically, with accurate real-time status in the UI and full integration into the persistent debug console.

Target release: **v2.10.85 (Version Code 107)**.

## Scope

- Scale and printer (BLE + Classic SPP).
- Native Capacitor Android (production) is the priority. Web/PWA path keeps current best-effort behavior — Web Bluetooth cannot persist across reloads.
- No backend, schema, transaction, reference generator, or sync changes.

## What changes

### 1. New connection manager (`src/services/btConnectionManager.ts`)

A single source of truth that wraps the existing `services/bluetooth.ts` and `services/bluetoothClassic.ts` calls. Existing functions stay; the manager only **orchestrates**.

State machine per role (`scale`, `printer`):

```text
idle → connecting → connected
                 ↘ failed → reconnecting → connected
connected → disconnected (auto) → reconnecting → connected | failed
```

Public API:
- `getStatus(role)` → `'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'failed'`
- `subscribe(role, cb)` → unsubscribe fn
- `ensureConnected(role)` — idempotent, dedup-locked
- `forget(role)` — user-initiated unpair

Internals:
- Per-role mutex so two callers can never start parallel connect attempts (eliminates duplicate connections / frozen states).
- Exponential backoff retry: 2s, 4s, 8s, 15s, 30s, then steady 30s. Cap at 30s. Stop after the user calls `forget()`.
- Health monitor: every 15s while `connected`, run the existing `verifyScaleConnection()` / `verifyPrinterConnection()` ping. On failure → transition to `reconnecting` and trigger backoff loop.
- Reacts to `online`/`offline`, Capacitor `App` `appStateChange` (resume), and Bluetooth adapter state events. On resume from background → immediate reconnect attempt (resets backoff).
- All transitions emit existing `scaleConnectionChange` / `printerConnectionChange` events **plus** a new `btStatusChange` event with `{ role, status, deviceName, error? }` for the new UI.
- Every transition is logged via `plog('BT', …)` so it lands in the persistent debug console.

### 2. Background survival on Android

Add a lightweight foreground service so the OS does not kill the BT socket when the app is backgrounded or the user logs out (the web layer logs out, but the native process stays alive).

- New Kotlin file `android/app/src/main/java/app/delicoop101/bluetooth/BluetoothKeepAliveService.kt` — `Service` with a low-priority persistent notification ("Connected to scale/printer"). Started/stopped by `BluetoothClassicPlugin` via two new `@PluginMethod`s `startKeepAlive` / `stopKeepAlive`.
- `AndroidManifest.xml` — declare the service and `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_CONNECTED_DEVICE` (Android 14) permissions.
- The connection manager calls `startKeepAlive` on first successful connect of either role, `stopKeepAlive` when both are forgotten.
- BLE side: keep the existing `BleClient.connect` callback registered; the connection manager owns the "auto-reconnect on disconnect" loop instead of one-shot logs.

Logout behavior: `AuthContext.logout` is updated to **not** call `disconnect()` — Bluetooth survives logout. Only `forget()` from a settings action drops the saved device.

### 3. Persistent last-paired memory

Already partially present (`getStoredPrinterInfo`, `getStoredScaleInfo`). Consolidate into one helper inside the manager:

- `localStorage` keys `bt.lastScale` and `bt.lastPrinter` → `{ deviceId, name, type: 'ble'|'classic', savedAt }`.
- On app boot (`main.tsx` after login restore), the manager auto-calls `ensureConnected('scale')` and `ensureConnected('printer')` if entries exist. Auto-reconnect happens before the user reaches the dashboard.
- Stale-state guard: when `BleClient`/Classic reports `isConnected=false` but local cache says connected, the manager corrects local cache and emits the event — fixes "frozen Bluetooth states".

### 4. UI status — real-time, accurate

A single new shared hook `src/hooks/useBtStatus.ts`:

```ts
useBtStatus('scale'|'printer') → { status, deviceName, lastError, retryIn }
```

Replaces ad-hoc state in:
- `src/components/PrinterSelector.tsx` — button label/icon driven by status (Connected / Connecting / Reconnecting in N s / Disconnected / Failed).
- `src/hooks/useScaleConnection.ts` — keeps existing scale value reading; status badge driven by manager.
- `src/components/Dashboard.tsx` — small scale + printer chips already present; now bound to the hook.
- `src/components/BluetoothConnectionDialog.tsx` — same status vocabulary.

Status colors use existing semantic tokens (`text-green-600`, `text-amber-500`, `text-destructive`, `text-muted-foreground`) — no new design tokens.

### 5. Performance & safety

- Health-check interval 15s, paused while `document.hidden` and resumed on `visibilitychange` → no battery drain when phone is asleep.
- Backoff is `setTimeout`-based (no busy loops). Cleared on success / forget / unmount.
- Per-role mutex prevents the duplicate-connect path that currently locks the BLE adapter.
- All listeners registered once at module load and torn down via `beforeunload` to prevent leaks during hot reload.

### 6. Logging integration

Every state transition, retry, health-check failure, adapter state change, and Kotlin-side service start/stop is forwarded to `plog('BT', message, data)` so the existing **/debug** console captures it. Native `Log.d/Log.e` lines from the plugin already include the `[BT]` prefix; we add a new `notifyListeners('btLog', …)` event the manager subscribes to and forwards into `plog`.

### 7. Versioning

- `src/constants/appVersion.ts` → `2.10.85`
- `android/app/build.gradle` → `versionCode 107`, `versionName "2.10.85"`
- `public/sw.js` → `CACHE_VERSION = 'v32'`

## Out of scope

- Reference generator, sync engine, IndexedDB schemas, receipts, auth flow.
- iOS (project is Android-only Capacitor).
- Replacing `services/bluetooth.ts`/`bluetoothClassic.ts` — they remain the low-level drivers.

## Verification checklist

1. Connect scale + printer → kill the app from recents → reopen: both reconnect within 5 s without user input.
2. Power off scale → UI flips to **Reconnecting** within 15 s; power on → flips to **Connected** automatically.
3. Logout from app → re-login: devices already connected, no manual pairing.
4. Open `/debug`: BT events visible under the `BT` tag with timestamps.
5. Background the app for 5 min → resume: connections still alive (foreground service notification visible).
6. Tap Reconnect twice rapidly → only one connect attempt runs (mutex).
7. Build succeeds; transactions, receipts, sync, and photo upload paths untouched.
