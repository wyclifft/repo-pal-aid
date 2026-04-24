# Fix "ghost scale" turning green when only the printer connects — v2.10.68

## What's actually happening

When the user connects only a Bluetooth printer (no scale paired), the Dashboard's scale indicator still flips to green. Tracing the chain:

1. The **native `BluetoothClassicPlugin.kt`** uses ONE shared socket. When you connect the printer over Classic SPP, the printer emits inbound bytes (status ACKs, idle bytes, command echoes). The plugin forwards every inbound packet as a single `dataReceived` event with no device-address tag.

2. In `src/services/bluetoothClassic.ts` `connectClassicScale()` (line 315) registers a **global `dataReceived` listener** that is never removed unless `disconnectClassicScale()` is called. If the user previously visited Settings and tried/touched the scale flow, that listener stays alive for the rest of the session.

3. When printer ACK bytes arrive, the leftover scale listener calls `parseSerialWeightData(rawData)`. The parser is permissive (Strategy 3 will treat any 3+ digit run as grams), so printer status bytes frequently parse into a plausible "weight". It then calls `broadcastScaleWeightUpdate(weight, 'Classic-SPP')`.

4. In `src/hooks/useScaleConnection.ts` (lines 110–123), the `scaleWeightUpdate` listener unconditionally runs `setScaleConnected(true)` — flipping the Dashboard indicator green even though no scale is connected.

There is also a second, milder path: the BLE `connectBluetoothPrinter()` could in theory race with a leftover scale GATT subscription, but that's not the cause for the user reporting "no scale paired" — the Classic-SPP shared-socket cross-talk is.

## The fix

Three small, defensive guards. No behavior change when a real scale IS connected.

### 1. Gate the `dataReceived` handler in `bluetoothClassic.ts`

Before parsing or broadcasting, the scale's `dataReceived` listener must check `classicScale.isConnected && classicScale.address`. If our scale role is not currently flagged connected, drop the bytes silently — they belong to the printer (or another role) sharing the native socket.

```ts
dataListenerHandle = await BluetoothClassic.addListener('dataReceived', (event: any) => {
  // v2.10.68: Drop inbound bytes when our scale role is not active.
  // The native plugin shares one RFCOMM socket across scale & printer roles,
  // and printer ACK/status bytes can otherwise be misparsed as a "weight".
  if (!classicScale.isConnected || !classicScale.address) {
    return;
  }
  const rawData = event.data ?? event.value ?? '';
  // ... existing parse + broadcast ...
});
```

Also: make sure `disconnectClassicScale()` removes the listener handle before any other path can fire it (it already does — keep as is, just verify ordering).

### 2. Tighten the `scaleWeightUpdate` listener in `useScaleConnection.ts`

Stop using a stray weight broadcast as proof that a scale is connected. Only update `liveWeight` / call parent callbacks when the connection is actually live.

```ts
const handleWeightUpdate = (e: CustomEvent<{ weight: number; scaleType: ScaleType }>) => {
  const { weight, scaleType: type } = e.detail;
  // v2.10.68: Trust the connection-state event, not weight broadcasts, for "connected".
  // This stops a phantom "scale online" indicator when only the printer is connected
  // and shared-socket bytes leak through the parser.
  if (!isScaleConnected()) {
    return;
  }
  setLiveWeight(weight);
  setScaleType(type);
  // (no more setScaleConnected(true) here)
  onWeightChangeRef.current(weight);
  onEntryTypeChangeRef.current('scale');
};
```

The same `isScaleConnected()` check should be applied in `Dashboard.tsx` and `Settings.tsx` if they ever flip state from a weight event (they don't today — they only listen to `scaleConnectionChange`, which is fine).

### 3. Make `parseSerialWeightData` slightly less greedy on noise

Reject parses where the cleaned input has no `kg`/`g` suffix AND is shorter than 3 chars or contains no digit-cluster ≥ 3. Strategy 3 (raw integer → grams) is the main culprit for misparsing printer ACKs like `\x06\x00\x10`. Tighten:

- Require the original `data` string to contain at least one decimal point OR an explicit unit token (`kg`, `g`, `lb`, `oz`) for any parse to succeed.
- If neither is present, return `null` — printer ACKs never have these.

This is a belt-and-braces guard. The role check in step 1 is the actual fix; this just prevents future regressions if another caller registers a `dataReceived` listener.

## Files to change

- `src/services/bluetoothClassic.ts` — role-gate the `dataReceived` listener; tighten `parseSerialWeightData`.
- `src/hooks/useScaleConnection.ts` — drop the unconditional `setScaleConnected(true)` inside `handleWeightUpdate`; verify with `isScaleConnected()` first.
- `src/constants/appVersion.ts` — bump to **v2.10.68** with changelog note.
- `android/app/build.gradle` — bump `versionCode` to **90**, `versionName` to **2.10.68**.

## Compatibility & safety

- A real Classic-SPP scale: `classicScale.isConnected = true` after `connectClassicScale()`, so the listener still parses and broadcasts normally. No regression.
- BLE scale: unaffected — uses a separate code path (`connectBluetoothScale` / GATT notifications), no change.
- BLE printer: unaffected — no `dataReceived` plumbing.
- Classic printer: now confirmed not to flip the scale indicator green, even when its inbound bytes look weight-ish.
- Recent Receipts, sync, IndexedDB, transactions, references, login: untouched.

## Verification checklist

1. With no scale paired, connect only the Classic printer → scale indicator stays grey. ✓
2. With no scale paired, connect only the BLE printer → scale indicator stays grey. ✓
3. With a real BLE scale connected → weight updates show as before. ✓
4. With a real Classic SPP scale connected → weight updates and "Connected" badge work as before. ✓
5. Print a Store/AI receipt while only the printer is connected → no spurious scale indicator flip mid-print. ✓
6. No new console errors. ✓

## Out of scope

- Per-address native sockets in `BluetoothClassicPlugin.kt` (only relevant if someone pairs both Classic peripherals at once — current evidence is printer-only).
- Refactoring `printerConnectionChange` / `scaleConnectionChange` into a typed event bus.
- Backend changes.
