# Walkthrough - `zeroOpt` and `stableopt` Enhancements

I have improved the scale interaction logic and UI to make weight capture more reliable and provide clearer feedback to the user.

## Changes

### 1. Stability Logic Fix (`stableopt`)
- **Bug**: The scale stability check was resetting on every weight update because a dependency was missing in the `handleScaleReading` callback.
- **Fix**: Updated [useScaleConnection.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/hooks/useScaleConnection.ts) and [WeightInput.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/WeightInput.tsx) to correctly track the "waiting for stable" state. The scale now reliably reaches a "stable" state after 3 consistent readings.

### 2. Return-to-Zero Enforcement (`zeroOpt`)
- **Tightened Threshold**: The zero threshold has been updated from **0.5 kg to 0.2 kg** across the application.
- **Persistent Lock**: Fixed a loophole where the capture lock could be bypassed by changing the selected farmer.
- **Implementation**: Modified [Index.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/pages/Index.tsx) to ensure the `weight` state is not cleared when a farmer is changed if `captureLocked` is active. The lock now strictly persists until the scale reading actually drops below 0.2 kg.

### 3. Bluetooth State Management
- **User Prompt**: Added a check in [useScaleConnection.ts](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/hooks/useScaleConnection.ts) to see if Bluetooth is enabled before connecting.
- **Action**: If Bluetooth is off on an Android device, the app now prompts the user to turn it on instead of failing silently.

### 4. UI Update (Status Light)
- **Visual Feedback**: Replaced the large blue progress bar with a compact **Status Light** circle in the top right of the weight displays.
- **Colors**:
    - `●` **Gray**: Scale disconnected.
    - `●` **Red (Animated)**: Scale reading is fluctuating/unstable.
    - `●` **Green**: Scale reading is stable and ready for capture.
- **Affected Files**: [LiveWeightDisplay.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/LiveWeightDisplay.tsx), [CoffeeWeightDisplay.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/CoffeeWeightDisplay.tsx), and [WeightInput.tsx](file:///C:/Users/TESH/AndroidStudioProjects/repo-pal-aid/src/components/WeightInput.tsx).

## Verification Results

### Manual Test Scenarios (Recommended)
1. **Stability Check**: Enable `stableopt`. Observe the Status Light. It should be **Red** while weight is being added and turn **Green** once it settles for ~2 seconds.
2. **Zero-Opt Lock**: Enable `zeroOpt`. Capture a 10 kg reading. The Capture button should disable. Change the farmer—the button **must remain disabled** until you remove the weight (drop below 0.2 kg).
3. **Bluetooth Off**: Turn off device Bluetooth. Click "Connect Bluetooth Scale". You should receive a system prompt to turn on Bluetooth.
