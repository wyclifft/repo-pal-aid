/**
 * Capacitor 7–Compatible Classic Bluetooth SPP Plugin
 * 
 * This file documents the native Android implementation needed for Classic Bluetooth SPP support.
 * 
 * IMPLEMENTATION GUIDE:
 * =====================
 * 
 * 1. Create the plugin class at:
 *    android/app/src/main/java/app/lovable/bluetooth/BluetoothClassicPlugin.java
 * 
 * 2. Register the plugin in MainActivity.java
 * 
 * 3. The plugin must implement these methods:
 *    - isAvailable(): Check if Classic Bluetooth is available
 *    - requestPermissions(): Request BLUETOOTH_CONNECT, BLUETOOTH_SCAN for Android 12+
 *    - getPairedDevices(): List bonded devices from BluetoothAdapter
 *    - connect(address): Create RFCOMM socket and connect
 *    - disconnect(): Close socket
 *    - isConnected(): Check socket state
 *    - write(data): Write to output stream
 * 
 * 4. Emit events for:
 *    - dataReceived: When data arrives on input stream
 *    - connectionStateChanged: When connection state changes
 * 
 * SAMPLE IMPLEMENTATION:
 * ======================
 * 
 * package app.lovable.bluetooth;
 * 
 * import android.Manifest;
 * import android.bluetooth.BluetoothAdapter;
 * import android.bluetooth.BluetoothDevice;
 * import android.bluetooth.BluetoothSocket;
 * import android.content.pm.PackageManager;
 * import android.os.Build;
 * import android.util.Log;
 * 
 * import com.getcapacitor.JSArray;
 * import com.getcapacitor.JSObject;
 * import com.getcapacitor.Plugin;
 * import com.getcapacitor.PluginCall;
 * import com.getcapacitor.PluginMethod;
 * import com.getcapacitor.annotation.CapacitorPlugin;
 * import com.getcapacitor.annotation.Permission;
 * 
 * import java.io.IOException;
 * import java.io.InputStream;
 * import java.io.OutputStream;
 * import java.util.Set;
 * import java.util.UUID;
 * 
 * @CapacitorPlugin(
 *     name = "BluetoothClassic",
 *     permissions = {
 *         @Permission(strings = { Manifest.permission.BLUETOOTH }),
 *         @Permission(strings = { Manifest.permission.BLUETOOTH_ADMIN }),
 *         @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }),
 *         @Permission(strings = { Manifest.permission.BLUETOOTH_SCAN })
 *     }
 * )
 * public class BluetoothClassicPlugin extends Plugin {
 *     private static final String TAG = "BluetoothClassic";
 *     private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
 *     
 *     private BluetoothAdapter bluetoothAdapter;
 *     private BluetoothSocket socket;
 *     private InputStream inputStream;
 *     private OutputStream outputStream;
 *     private Thread readThread;
 *     private volatile boolean isReading = false;
 * 
 *     @Override
 *     public void load() {
 *         bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
 *     }
 * 
 *     @PluginMethod
 *     public void isAvailable(PluginCall call) {
 *         JSObject result = new JSObject();
 *         result.put("available", bluetoothAdapter != null && bluetoothAdapter.isEnabled());
 *         call.resolve(result);
 *     }
 * 
 *     @PluginMethod
 *     public void requestPermissions(PluginCall call) {
 *         // Request runtime permissions for Android 12+
 *         if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
 *             requestAllPermissions(call, "permissionCallback");
 *         } else {
 *             JSObject result = new JSObject();
 *             result.put("granted", true);
 *             call.resolve(result);
 *         }
 *     }
 * 
 *     @PluginMethod
 *     public void getPairedDevices(PluginCall call) {
 *         if (bluetoothAdapter == null) {
 *             call.reject("Bluetooth not available");
 *             return;
 *         }
 * 
 *         try {
 *             Set<BluetoothDevice> bondedDevices = bluetoothAdapter.getBondedDevices();
 *             JSArray devicesArray = new JSArray();
 *             
 *             for (BluetoothDevice device : bondedDevices) {
 *                 JSObject deviceObj = new JSObject();
 *                 deviceObj.put("address", device.getAddress());
 *                 deviceObj.put("name", device.getName() != null ? device.getName() : "Unknown");
 *                 deviceObj.put("bonded", true);
 *                 deviceObj.put("deviceClass", device.getBluetoothClass().getDeviceClass());
 *                 devicesArray.put(deviceObj);
 *             }
 *             
 *             JSObject result = new JSObject();
 *             result.put("devices", devicesArray);
 *             call.resolve(result);
 *         } catch (SecurityException e) {
 *             call.reject("Bluetooth permission denied", e);
 *         }
 *     }
 * 
 *     @PluginMethod
 *     public void connect(PluginCall call) {
 *         String address = call.getString("address");
 *         if (address == null) {
 *             call.reject("Address is required");
 *             return;
 *         }
 * 
 *         try {
 *             BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
 *             socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
 *             
 *             // Cancel discovery to speed up connection
 *             bluetoothAdapter.cancelDiscovery();
 *             
 *             socket.connect();
 *             inputStream = socket.getInputStream();
 *             outputStream = socket.getOutputStream();
 *             
 *             // Start reading thread
 *             startReadThread();
 *             
 *             JSObject result = new JSObject();
 *             result.put("connected", true);
 *             call.resolve(result);
 *             
 *             // Notify connection state
 *             notifyConnectionState(true);
 *         } catch (IOException | SecurityException e) {
 *             Log.e(TAG, "Connection failed", e);
 *             call.reject("Connection failed: " + e.getMessage(), e);
 *         }
 *     }
 * 
 *     @PluginMethod
 *     public void disconnect(PluginCall call) {
 *         closeConnection();
 *         call.resolve();
 *     }
 * 
 *     @PluginMethod
 *     public void isConnected(PluginCall call) {
 *         JSObject result = new JSObject();
 *         result.put("connected", socket != null && socket.isConnected());
 *         call.resolve(result);
 *     }
 * 
 *     @PluginMethod
 *     public void write(PluginCall call) {
 *         String data = call.getString("data");
 *         if (data == null || outputStream == null) {
 *             call.reject("No data or not connected");
 *             return;
 *         }
 * 
 *         try {
 *             outputStream.write(data.getBytes());
 *             outputStream.flush();
 *             call.resolve();
 *         } catch (IOException e) {
 *             call.reject("Write failed", e);
 *         }
 *     }
 * 
 *     private void startReadThread() {
 *         isReading = true;
 *         readThread = new Thread(() -> {
 *             byte[] buffer = new byte[1024];
 *             int bytes;
 *             
 *             while (isReading && socket != null && socket.isConnected()) {
 *                 try {
 *                     bytes = inputStream.read(buffer);
 *                     if (bytes > 0) {
 *                         String data = new String(buffer, 0, bytes);
 *                         notifyDataReceived(data);
 *                     }
 *                 } catch (IOException e) {
 *                     if (isReading) {
 *                         Log.e(TAG, "Read error", e);
 *                         closeConnection();
 *                     }
 *                     break;
 *                 }
 *             }
 *         });
 *         readThread.start();
 *     }
 * 
 *     private void closeConnection() {
 *         isReading = false;
 *         
 *         try {
 *             if (inputStream != null) inputStream.close();
 *             if (outputStream != null) outputStream.close();
 *             if (socket != null) socket.close();
 *         } catch (IOException e) {
 *             Log.e(TAG, "Error closing connection", e);
 *         }
 *         
 *         inputStream = null;
 *         outputStream = null;
 *         socket = null;
 *         
 *         notifyConnectionState(false);
 *     }
 * 
 *     private void notifyDataReceived(String data) {
 *         JSObject event = new JSObject();
 *         event.put("value", data);
 *         notifyListeners("dataReceived", event);
 *     }
 * 
 *     private void notifyConnectionState(boolean connected) {
 *         JSObject event = new JSObject();
 *         event.put("connected", connected);
 *         notifyListeners("connectionStateChanged", event);
 *     }
 * }
 * 
 * REGISTRATION IN MainActivity.java:
 * ===================================
 * 
 * Add to onCreate():
 *     registerPlugin(BluetoothClassicPlugin.class);
 * 
 * Add import:
 *     import app.lovable.bluetooth.BluetoothClassicPlugin;
 */

// This file serves as documentation for the native implementation
// The actual TypeScript interface is in bluetoothClassic.ts

export const NATIVE_PLUGIN_INFO = {
  name: 'BluetoothClassic',
  status: 'pending-native-implementation',
  requiredPermissions: [
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_ADMIN',
    'android.permission.BLUETOOTH_CONNECT', // Android 12+
    'android.permission.BLUETOOTH_SCAN',    // Android 12+
  ],
  sppUuid: '00001101-0000-1000-8000-00805F9B34FB',
  capacitorVersion: '7.x',
  implementation: {
    android: 'android/app/src/main/java/app/lovable/bluetooth/BluetoothClassicPlugin.java',
    ios: 'Not applicable - iOS does not support Classic Bluetooth SPP in apps',
  },
};
