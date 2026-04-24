

## Fix Classic Bluetooth printer drops to "scale" state during Store/AI receipt print — v2.10.65

### What's actually happening (refined with your new detail)

You confirmed that **no scale is even paired** on this user's POS. Yet after a Store receipt prints, the printer badge flips off and the UI behaves as if the system "switched to the scale". That tells me the bug is not socket contention with a real scale — it's a **JS-level state corruption** in the Classic Bluetooth layer where a single shared listener and state flag flip the wrong device offline.

Concretely, in `src/services/bluetoothClassic.ts`:

1. The same `BluetoothClassic` plugin instance is used for both scale and printer.
2. `connectClassicScale(...)` and `connectClassicPrinter(...)` each register their own `connectionStateChanged` listener on the **same plugin** — but those events carry no device address, so a `connected: false` event fired after a print write completes (or after a transient socket close) is delivered to **both** listeners.
3. Whichever listener fires first wins. In this user's case, the scale listener (still installed from a previous session, or installed defensively at app boot) calls `clearClassicScaleState()` → that's harmless because no scale is paired. But the printer listener also fires, calls `clearClassicPrinterState()` → printer badge goes orange, and `printerConnectionChange` is broadcast.
4. The UI in `Settings`/`Dashboard`/`PrinterSelector` reacts to `printerConnectionChange` and shows the "select printer / scale" reconnect prompt — which the user perceives as "it moved to the scale".

There is also a real secondary cause in `src/services/bluetooth.ts` (BLE printer path, line ~2066): the catch block calls `clearPrinterState()` unconditionally on **any** print write error, including a transient single-chunk hiccup that the next chunk would have recovered from. On Classic the equivalent is the `connectionStateChanged → connected: false` that fires briefly between print chunks on some integrated POS firmware.

### Fix — three minimal, production-safe changes

#### 1. Scope the Classic `connectionStateChanged` listeners by device address (`src/services/bluetoothClassic.ts`)

Inside `connectClassicScale` and `connectClassicPrinter`, capture the device address in closure and ignore any `connectionStateChanged` event that doesn't match it. If the event payload has no address (older native plugin), fall back to the current behaviour but only act when the role's own state flag is `true` — so a printer event can never clear scale state and vice versa.

This is a pure JS change. No native plugin change required for the fix to work, because the worst case (event without address) becomes a no-op for the wrong role.

#### 2. Add a verify-before-clear gate in the Classic printer disconnect path (`src/services/bluetoothClassic.ts`)

Before `clearClassicPrinterState()` runs in the printer's `connectionStateChanged` handler, call `BluetoothClassic.isConnected({ address })`. If the native side still reports the printer socket as connected, log a warning and **do not** clear state. This eliminates the transient false-disconnect that some POS firmwares emit between print chunks.

Same gate for the scale listener.

#### 3. Don't kill the BLE printer on a single failed write (`src/services/bluetooth.ts`)

In `printToBluetoothPrinter`'s catch block (~line 2066), replace the unconditional `clearPrinterState()` with a `verifyPrinterConnection()` check. Only clear state if the printer is genuinely gone. This protects BLE printer users from the same class of false-disconnect.

#### 4. Drop the no-op scale auto-reconnect on Store/AI mount

`src/pages/Store.tsx` (and `AIPage.tsx` if the same call exists) calls `autoReconnect()` for the scale on mount. Store and AI never read weight from the scale — they're cart-based. On a POS with no scale paired, this call is harmless but it does briefly toggle Classic plugin state on platforms where the plugin probes existing pairings, which feeds bug #1. Remove the call from these two pages. Buy/Sell pages still auto-reconnect normally.

#### 5. Version bump

| File | Change |
|---|---|
| `src/constants/appVersion.ts` | Bump to **v2.10.65** with note: *"v2.10.65 — Fix Classic BT printer state being cleared by spurious scale-side connection events on Store/AI receipt print. Listeners now scope to their device address, false-disconnect events are verified before clearing state, and Store/AI no longer auto-reconnect the scale."* |
| `android/app/build.gradle` | `versionName "2.10.65"`, `versionCode 87` |

### Files Touched

| File | Change |
|---|---|
| `src/services/bluetoothClassic.ts` | Scope `connectionStateChanged` listeners by address; verify with `BluetoothClassic.isConnected({ address })` before clearing state for both scale and printer |
| `src/services/bluetooth.ts` | Replace unconditional `clearPrinterState()` in `printToBluetoothPrinter` catch block with a `verifyPrinterConnection()` gate |
| `src/pages/Store.tsx` | Remove scale `autoReconnect()` call on mount (no scale used here) |
| `src/pages/AIPage.tsx` | Remove scale `autoReconnect()` call on mount if present |
| `src/constants/appVersion.ts` | Bump to **2.10.65** with changelog comment |
| `android/app/build.gradle` | `versionName 2.10.65`, `versionCode 87` |

### What does NOT change

- `BluetoothClassicPlugin.kt` — untouched. No native rebuild required for this fix to ship; the JS-layer scoping and verify-before-clear gate are sufficient. (We can revisit per-address sockets in a later release if a customer actually pairs both peripherals on the same POS.)
- `backend-api/server.js` — untouched.
- BLE scale flow, Buy/Sell weight capture, references, IndexedDB, sync engine, multOpt=0 modal, FarmerSyncDashboard, photo audit, Z-Reports, periodic reports, login/`resilientFetch`, member cache — all untouched.
- Existing paired-printer UX, "last connected" indicator, and reconnect button — unchanged.

### Verification Checklist

1. Affected user's POS (Classic printer, no scale paired): connect printer in Settings, submit a Store sale with `printCopies=2`, both copies print, printer badge stays green throughout, no "select printer / scale" prompt afterwards. ✓ (was: badge flipped off after print)
2. Same POS: submit an AI receipt → same result. ✓
3. POS with both Classic printer and Classic scale paired (other user setup): connect both in Settings, submit a Buy capture (uses scale weight), then a Store sale (uses printer). Both badges remain green; receipt prints; weight still flows live on returning to Buy. ✓
4. BLE-only printer user: deliberately introduce a single-chunk write failure → printer state preserved, retry succeeds, no orange badge flash. ✓
5. Web preview (no Capacitor plugin): Classic paths short-circuit as today; no console errors. ✓
6. Z-Report, Periodic Report, Reprint Modal printing — unchanged. ✓
7. Sync engine, photo audit, IndexedDB, transactions, references, login, multOpt=0 modal — no regressions. ✓
8. No new console errors. ✓

### Out of scope

- Per-address native sockets in `BluetoothClassicPlugin.kt` (only needed if a future customer actually pairs both Classic peripherals — current evidence shows printer-only).
- Auto-detecting integrated POS units (Sunmi/iMin) and pre-pairing peripherals.
- Refactoring `printerConnectionChange` / `scaleConnectionChange` into a single typed event bus.
- Backend changes.

