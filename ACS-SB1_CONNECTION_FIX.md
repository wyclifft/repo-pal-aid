# ACS-SB1 Scale Connection Fix

## Issue
Scale Model: **ACS-SB1** (S/N: S82412008) was not connecting to the app.

## Changes Made

### 1. Enhanced Bluetooth Service (`src/services/bluetooth.ts`)

**Added Support for More Scale Types:**
- Expanded service UUID discovery to include generic Bluetooth scales
- Added fallback detection for scales that don't use standard HC-05/HM-10 protocols
- The app now attempts to connect to ANY Bluetooth scale with a notify characteristic

**Improved Diagnostics:**
- Comprehensive logging of all Bluetooth services and characteristics
- Detailed connection flow logging with emoji indicators:
  - 🔍 = Searching for devices
  - 📱 = Device selected
  - ✅ = Connection successful
  - 📋 = Services discovered
  - 📊 = Weight data received
  - ❌ = Error occurred

**Better Data Parsing:**
- Multiple parsing strategies for different scale data formats
- Support for decimal format: "12.34" → 12.34 kg
- Support for integer format: "1234" → 12.34 kg (assumes grams)
- Handles scales that send units: "12.34 kg"

### 2. New Diagnostic Tools

**Created `src/utils/bluetoothDiagnostics.ts`:**
- `runBluetoothDiagnostics()` - Checks Bluetooth availability
- `logConnectionTips()` - Displays helpful troubleshooting tips in console
- Automatically runs when the app loads

**Added to Settings Page:**
- New "Run Diagnostics" button (🐛 icon) next to "Search for Scale"
- Shows connection troubleshooting tips
- Link to detailed SCALE_CONNECTION_GUIDE.md

### 3. Documentation

**Created `SCALE_CONNECTION_GUIDE.md`:**
- Complete troubleshooting guide for all scale models
- Specific instructions for ACS-SB1
- Step-by-step connection process
- Common issues and solutions
- How to share diagnostic data with support

## How to Connect Your ACS-SB1 Scale

### Option 1: Try Connecting Now (Recommended)

1. **Prepare the Scale:**
   - Power on the ACS-SB1
   - Press and hold the Bluetooth button until LED blinks rapidly
   - Keep scale within 5 meters of your phone

2. **In the App:**
   - Go to Settings
   - Tap "Search for Scale"
   - Select your scale from the list (might show as "ACS-SB1", "BLE-SCALE", or a generic name)
   - Wait 5-10 seconds for connection

3. **Check Console Logs:**
   - Open Developer Tools (F12 on desktop, or use adb logcat on Android)
   - Look for log messages showing discovered services
   - The app will now log ALL services it finds on your scale

### Option 2: If Still Not Connecting

1. **Run Diagnostics:**
   - Go to Settings → Bluetooth Scale section
   - Click the 🐛 (bug) button next to "Search for Scale"
   - Check the console for diagnostic information

2. **Share Diagnostic Data:**
   - After attempting to connect, the console will show:
     - All discovered services and their UUIDs
     - Characteristics and their properties
     - Any error messages
   - Take a screenshot or copy the console logs
   - Share with support to add specific ACS-SB1 support

### What the Enhanced App Now Does

**Before (Old Behavior):**
- Only looked for HC-05 (0xFFE0) and HM-10 (0xFEE7) service UUIDs
- Failed if scale used different UUIDs
- Limited error messages

**Now (Enhanced):**
- Searches for HC-05, HM-10, AND any other Bluetooth service
- Logs all available services for troubleshooting
- Uses ANY service with a notify characteristic (fallback)
- Multiple data parsing strategies
- Detailed diagnostic logging
- Helpful error messages with next steps

## Expected Console Output When Connecting

```
═══════════════════════════════════════════════════
📖 SCALE CONNECTION TROUBLESHOOTING TIPS
═══════════════════════════════════════════════════

✓ Make sure scale is powered on and Bluetooth enabled
✓ Put scale in pairing mode (usually hold BT button)
✓ Keep phone within 5 meters of scale
...

🔍 Requesting Bluetooth scale device...
📱 Device selected: ACS-SB1 (ID: XX:XX:XX:XX:XX:XX)
✅ Connected to device
📋 Found 3 services:
  Service 1: 0000180a-0000-1000-8000-00805f9b34fb
    Characteristics: 5
      Char 1: 00002a29-0000-1000-8000-00805f9b34fb
        Properties: read=true, write=false, notify=false
  Service 2: 49535343-fe7d-4ae5-8fa9-9fafd205e455
    Characteristics: 2
      Char 1: 49535343-1e4d-4bd9-ba61-23c647249616
        Properties: read=false, write=true, notify=false
      Char 2: 49535343-8841-43f4-a8d4-ecbe34729bb3
        Properties: read=false, write=false, notify=true
✅ Found generic scale service: 49535343-fe7d-4ae5-8fa9-9fafd205e455
   Using characteristic: 49535343-8841-43f4-a8d4-ecbe34729bb3
📡 Starting notifications on [service]/[characteristic]
✅ Scale connection successful
📊 Raw scale data: "  12.34 kg" (10 bytes)
✅ Parsed weight: 12.34 kg
```

## Troubleshooting Checklist

Before contacting support, verify:
- [ ] Scale is powered on
- [ ] Scale Bluetooth is enabled and in pairing mode
- [ ] Phone Bluetooth is enabled
- [ ] Location permission granted (Android requirement)
- [ ] App has Bluetooth permission
- [ ] Scale is within 5 meters of phone
- [ ] No interference from other Bluetooth devices
- [ ] Diagnostic button clicked and console checked
- [ ] Previous Bluetooth pairings cleared

## What to Share with Support

If your ACS-SB1 still won't connect after these enhancements:

1. **Console Logs** showing:
   - All discovered services (UUIDs)
   - Characteristics and their properties
   - Any error messages
   
2. **Scale Information:**
   - Model: ACS-SB1
   - Serial Number: S82412008
   - Any other model details visible on the scale

3. **Device Information:**
   - Phone model
   - Operating system version
   - Whether using web or mobile app

## Next Steps

The enhanced app should now be able to:
1. ✅ Detect your ACS-SB1 scale
2. ✅ Connect to it using generic Bluetooth discovery
3. ✅ Log detailed diagnostic information for support
4. ✅ Parse weight data from various formats

**Try connecting now!** The detailed console logs will help us add full support for your specific scale model if needed.

## Technical Notes

### Why ACS-SB1 Might Have Failed Before

Most scales use one of two common Bluetooth modules:
- HC-05 (Service UUID: 0xFFE0)
- HM-10 (Service UUID: 0xFEE7)

The ACS-SB1 likely uses a custom or less common Bluetooth module with different service UUIDs. The enhanced app now:
1. First tries HC-05 and HM-10 (fast path for common scales)
2. Then scans ALL services looking for any with notify characteristics
3. Uses the first compatible service it finds
4. Logs everything for troubleshooting

This approach should work with ANY Bluetooth scale that sends weight data via notifications.
