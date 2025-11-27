# Scale Connection Troubleshooting Guide

## ACS-SB1 and Other Scale Models

This guide helps troubleshoot Bluetooth scale connectivity issues, specifically for models like the **ACS-SB1** (S/N: S82412008).

## Before You Start

### 1. Check Scale Power and Bluetooth
- Ensure the scale is powered on
- Verify Bluetooth is enabled on the scale
- Scale should be in pairing/discoverable mode
- Check that the scale battery is charged

### 2. Check Device Permissions
- **Android**: Go to Settings → Apps → [App Name] → Permissions
  - Enable Bluetooth
  - Enable Location (required for Bluetooth scanning)
- **iOS**: Go to Settings → [App Name]
  - Enable Bluetooth

### 3. Clear Previous Connections
- On the scale: Reset Bluetooth or unpair previous devices
- In the app: Try disconnecting and reconnecting
- On your phone: Forget the scale in Bluetooth settings

## Connection Process

### Step 1: Enable Diagnostic Logging
Before connecting, the app will now log detailed information to the browser console:
1. Open Developer Tools (if available)
2. Go to Console tab
3. Attempt to connect to the scale
4. Look for log messages starting with 🔍, 📱, ✅, or ❌

### Step 2: Connect the Scale
1. Tap "Connect Scale" in the app
2. Select your scale from the device picker
3. Wait for connection to establish

### What the App Logs Will Show:
```
🔍 Requesting Bluetooth scale device...
📱 Device selected: [Scale Name] (ID: [Device ID])
✅ Connected to device
📋 Found X services:
  Service 1: [UUID]
    Characteristics: [Count]
      Char 1: [UUID]
        Properties: read=true, write=false, notify=true
```

## Common Issues and Solutions

### Issue 1: "No compatible Bluetooth scale service found"

**Symptoms:**
- App connects to scale but shows this error
- Scale appears in device list but won't complete connection

**Solutions:**
1. **Check the console logs** for available services
2. Look for the service UUIDs in the logs
3. Contact support with these UUIDs - we can add support for your scale model

**Expected Services for Different Scales:**
- HC-05 scales: `0000ffe0-xxxx-xxxx-xxxx`
- HM-10 scales: `0000fee7-xxxx-xxxx-xxxx`
- Generic scales: Various custom UUIDs

### Issue 2: Scale connects but no weight readings

**Symptoms:**
- Connection successful
- Scale shows as connected
- Weight doesn't update in app

**Check Console Logs for:**
```
📊 Raw scale data: "[data]" (X bytes)
```

**Solutions:**
1. Verify scale is sending data (check console logs)
2. Scale data format might be different:
   - Some scales send: "12.34 kg"
   - Others send: "1234" (needs conversion)
   - Some use special protocols
3. Try placing weight on scale to trigger data transmission

### Issue 3: Connection drops frequently

**Symptoms:**
- Scale connects but disconnects after a few seconds
- Weight readings stop updating

**Solutions:**
1. **Distance**: Keep phone within 5 meters of scale
2. **Interference**: Move away from:
   - WiFi routers
   - Other Bluetooth devices
   - Microwave ovens
   - Metal barriers
3. **Battery**: Check scale battery level
4. **App permissions**: Verify all permissions are granted

### Issue 4: Scale not appearing in device list

**Symptoms:**
- Device picker shows no devices or doesn't show your scale

**Solutions:**
1. **Pairing Mode**: Put scale in pairing/discovery mode
   - Usually: Hold Bluetooth button for 3-5 seconds
   - LED should blink rapidly
2. **Location Services**: 
   - Android requires Location to be ON for Bluetooth scanning
   - Grant location permission to the app
3. **Previous Pairing**: 
   - Unpair scale from phone Bluetooth settings
   - Restart the scale
   - Try connecting again

## Scale-Specific Instructions

### ACS-SB1 Model
**Specifications:**
- Model: ACS-SB1
- Serial Number: S82412008
- Communication: Bluetooth 4.0/5.0

**Connection Steps:**
1. Power on the scale
2. Press and hold the Bluetooth button until LED blinks rapidly
3. Open the app and tap "Connect Scale"
4. Select "ACS-SB1" or your scale name from the list
5. Wait 5-10 seconds for connection

**Troubleshooting:**
- If scale doesn't appear: Turn off and on again
- If connection fails: Remove scale battery for 10 seconds
- If weight not showing: Place test weight on scale to trigger transmission

### Other Common Scales

#### HC-05 Based Scales
- Service UUID: `0000ffe0-0000-1000-8000-00805f9b34fb`
- Usually appear as "HC-05" or "BT-SCALE"
- Data format: Usually ASCII text with decimal

#### HM-10 Based Scales  
- Service UUID: `0000fee7-0000-1000-8000-00805f9b34fb`
- May appear as "HMSoft" or "BLE-SCALE"
- Data format: Binary or ASCII

## Advanced Diagnostics

### Enable Detailed Logging
The app now includes comprehensive logging. To view:

**Android:**
1. Connect phone to computer
2. Run: `adb logcat | grep Bluetooth`
3. Attempt scale connection
4. Share logs with support

**Web (Development):**
1. Open browser Developer Tools (F12)
2. Go to Console tab
3. Attempt scale connection
4. Screenshot or copy console output

### What to Share with Support

If you need help, provide:
1. **Scale Model & Serial Number**
2. **Console logs** showing:
   - Available services and UUIDs
   - Connection error messages
   - Raw data received (if any)
3. **Phone Model & OS Version**
4. **App Version**

### Manual Service UUID Discovery

If you want to find your scale's service UUID manually:

**Using nRF Connect (Android/iOS):**
1. Download "nRF Connect" from app store
2. Scan for your scale
3. Connect to the scale
4. Note down all Service UUIDs
5. Find characteristics with "Notify" property
6. Share this information with app support

## Expected Connection Flow

```
1. User taps "Connect Scale"
   ↓
2. App requests Bluetooth permission (if needed)
   ↓
3. Device picker appears
   ↓
4. User selects scale
   ↓
5. App connects to scale
   ↓
6. App discovers services
   ↓
7. App finds notify characteristic
   ↓
8. App subscribes to weight notifications
   ↓
9. Scale sends weight data
   ↓
10. App parses and displays weight
```

## Still Having Issues?

### Quick Checklist:
- [ ] Scale is powered on
- [ ] Scale Bluetooth is enabled
- [ ] Phone Bluetooth is enabled
- [ ] Location permission granted (Android)
- [ ] App has Bluetooth permission
- [ ] Scale is in pairing mode
- [ ] Previous connections cleared
- [ ] Scale is within 5 meters
- [ ] No interference from other devices
- [ ] Console logs checked
- [ ] Scale battery charged

### Contact Support

Provide the following information:
1. Scale model and serial number
2. Phone model and OS version
3. Console logs from connection attempt
4. Screenshot of error message
5. List of services/UUIDs from diagnostic logs

## Technical Notes for Developers

### Supported Service UUIDs
The app currently supports:
- `0000ffe0-0000-1000-8000-00805f9b34fb` (HC-05)
- `0000fee7-0000-1000-8000-00805f9b34fb` (HM-10)
- Any custom service with notify characteristic (fallback)

### Data Parsing Strategies
1. Decimal format: "12.34" → 12.34 kg
2. Integer format: "1234" → 12.34 kg (assumes grams)
3. With units: "12.34 kg" → 12.34 kg

### Adding New Scale Support
To add support for a new scale model:
1. Get the service UUID and characteristic UUID
2. Add the service UUID to `GENERIC_SCALE_SERVICES`
3. Test connection and data parsing
4. Update this guide with scale-specific instructions
