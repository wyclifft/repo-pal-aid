## What I found
- The APK is rendering and the app is not stuck at first boot.
- The Bluetooth Classic bridge object is present, but every native call rejects immediately, so the JS side falls back to “native plugin required” behavior.
- The direct printer button is trying the placeholder MAC `00:11:22:33:44:55`, which is not a real internal printer address.
- The current native Bluetooth plugin has two likely production blockers:
  - it depends on permission callbacks before paired-device listing/connection, which is fragile on Android 7/WebView 51;
  - it uses one shared socket for scale and printer, so connecting one device can disrupt the other.
- The UI compatibility fix did not go far enough because the Capacitor/native shell still uses dark splash/status/background values, and some modern CSS/Tailwind output can still render badly on WebView 51.

## Plan
1. **Fix Classic Bluetooth native plugin for Android 7**
   - Make Android 7 treat classic Bluetooth install-time permissions as granted instead of entering a runtime-permission callback path.
   - Initialize the adapter with a safer fallback using `BluetoothAdapter.getDefaultAdapter()` if `BluetoothManager.adapter` is null.
   - Add explicit native logs and reject messages so future logs show the real reason instead of blank `FAILED:` lines.

2. **Separate scale and printer Classic connections**
   - Replace the single shared `connectedSocket` state with role-aware connections for `scale` and `printer`.
   - Add native methods like `connectScale`, `connectPrinter`, `writePrinter`, and role-aware `isConnected` while preserving existing methods for backward compatibility.
   - Update the JS Classic scale/printer services to use the role-specific native methods when available, falling back to the old methods only if needed.

3. **Remove fake internal-printer MAC presets**
   - Stop offering placeholder addresses such as `00:11:22:33:44:55` as “internal printer” options.
   - Make the printer dialog list real paired devices first and clearly require Android pairing for internal printers unless the actual MAC is entered.
   - Keep manual direct-connect for real MAC addresses only.

4. **Fix WebView 51 UI at the native shell level**
   - Change Capacitor Android background, splash, and status-bar config from dark colors to white/light.
   - Change Android styles from DayNight to a fixed light theme to prevent the OS from forcing dark surfaces.
   - Add a stronger legacy WebView CSS fallback that replaces fragile CSS-variable theme surfaces with direct light colors for body, dialogs, menus, cards, and headers.

5. **Reduce boot-time refresh storms**
   - Guard overlapping `psettings` refreshes so the device does not issue multiple simultaneous refreshes on startup/visibility events.
   - This should reduce UI freezing/fps drops during Bluetooth attempts without changing transaction/sync logic.

6. **Version and verification**
   - Bump the app to the next version/code with a clear changelog comment.
   - Run a targeted TypeScript check/build validation after edits.
   - Keep transaction creation, receipt generation, sync, IndexedDB schema, reference generation, payments, and cumulative logic untouched.