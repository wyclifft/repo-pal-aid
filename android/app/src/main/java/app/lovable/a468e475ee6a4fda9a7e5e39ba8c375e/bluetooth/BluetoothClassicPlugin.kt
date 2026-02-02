package app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.bluetooth

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Capacitor 7–compatible Classic Bluetooth SPP Plugin
 * 
 * Provides RFCOMM/SPP support for industrial weighing scales.
 * Production-ready with thread-safe I/O and proper socket lifecycle management.
 * 
 * Supports Android 8 (API 26) through Android 14 (API 34)
 */
@CapacitorPlugin(
    name = "BluetoothClassic",
    permissions = [
        // Legacy permissions for Android < 12
        Permission(
            alias = "bluetooth_legacy",
            strings = [
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN
            ]
        ),
        // New permissions for Android 12+
        Permission(
            alias = "bluetooth_new",
            strings = [
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN
            ]
        )
    ]
)
class BluetoothClassicPlugin : Plugin() {

    companion object {
        private const val TAG = "BluetoothClassicPlugin"
        
        // Standard SPP UUID for RFCOMM
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        
        // Buffer settings
        private const val READ_BUFFER_SIZE = 1024
        private const val DATA_EMIT_INTERVAL_MS = 100L
    }

    // Bluetooth adapter
    private var bluetoothAdapter: BluetoothAdapter? = null
    
    // Connection state
    private var socket: BluetoothSocket? = null
    private var inputStream: InputStream? = null
    private var outputStream: OutputStream? = null
    private var connectedDevice: BluetoothDevice? = null
    
    // Thread management
    private val isReading = AtomicBoolean(false)
    private var readThread: Thread? = null
    
    // Data buffer for accumulating serial data
    private val dataBuffer = StringBuilder()
    private val bufferLock = Any()

    override fun load() {
        super.load()
        initBluetooth()
        Log.i(TAG, "BluetoothClassicPlugin loaded - Capacitor 7 compatible")
    }

    private fun initBluetooth() {
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        
        if (bluetoothAdapter == null) {
            Log.w(TAG, "Bluetooth not available on this device")
        } else {
            Log.i(TAG, "Bluetooth adapter initialized")
        }
    }

    /**
     * Check if Classic Bluetooth is available
     */
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val available = bluetoothAdapter != null
        val result = JSObject().apply {
            put("available", available)
        }
        Log.d(TAG, "isAvailable: $available")
        call.resolve(result)
    }

    /**
     * Request Bluetooth permissions - exposed as plugin method
     */
    @PluginMethod
    fun requestBluetoothPermissions(call: PluginCall) {
        if (checkBluetoothPermissions()) {
            val result = JSObject().apply {
                put("granted", true)
            }
            call.resolve(result)
            return
        }

        // Request appropriate permissions based on Android version
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAlias("bluetooth_new", call, "permissionCallback")
        } else {
            requestPermissionForAlias("bluetooth_legacy", call, "permissionCallback")
        }
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        val granted = checkBluetoothPermissions()
        val result = JSObject().apply {
            put("granted", granted)
        }
        Log.d(TAG, "Permission callback - granted: $granted")
        call.resolve(result)
    }

    /**
     * Check if required Bluetooth permissions are granted
     */
    private fun checkBluetoothPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+ needs BLUETOOTH_CONNECT
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            // Android < 12 needs BLUETOOTH
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Get list of paired/bonded Bluetooth devices
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun getPairedDevices(call: PluginCall) {
        if (!checkBluetoothPermissions()) {
            call.reject("Bluetooth permission not granted")
            return
        }

        val adapter = bluetoothAdapter
        if (adapter == null) {
            call.reject("Bluetooth not available")
            return
        }

        try {
            val bondedDevices = adapter.bondedDevices
            val devicesArray = JSArray()

            bondedDevices?.forEach { device ->
                val deviceObj = JSObject().apply {
                    put("address", device.address)
                    put("name", device.name ?: "Unknown Device")
                    put("bonded", true)
                    put("deviceClass", device.bluetoothClass?.deviceClass ?: 0)
                }
                devicesArray.put(deviceObj)
            }

            val result = JSObject().apply {
                put("devices", devicesArray)
            }
            
            Log.i(TAG, "Found ${bondedDevices?.size ?: 0} paired devices")
            call.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "Error getting paired devices", e)
            call.reject("Failed to get paired devices: ${e.message}")
        }
    }

    /**
     * Connect to a Classic Bluetooth device via SPP/RFCOMM
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun connect(call: PluginCall) {
        val address = call.getString("address")
        if (address.isNullOrEmpty()) {
            call.reject("Device address is required")
            return
        }

        if (!checkBluetoothPermissions()) {
            call.reject("Bluetooth permission not granted")
            return
        }

        val adapter = bluetoothAdapter
        if (adapter == null) {
            call.reject("Bluetooth not available")
            return
        }

        // Disconnect any existing connection first
        disconnectInternal()

        thread(name = "BT-Connect-$address") {
            try {
                Log.i(TAG, "Connecting to device: $address")
                
                val device = adapter.getRemoteDevice(address)
                if (device == null) {
                    activity.runOnUiThread {
                        call.reject("Device not found: $address")
                    }
                    return@thread
                }

                // Cancel discovery if running (saves power and improves connection)
                adapter.cancelDiscovery()

                // Create RFCOMM socket
                val btSocket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                
                // Connect (blocking call)
                btSocket.connect()
                
                // Store connection state
                socket = btSocket
                inputStream = btSocket.inputStream
                outputStream = btSocket.outputStream
                connectedDevice = device

                // Start reading thread
                startReadingThread()

                // Notify connection state change
                notifyConnectionStateChanged(true)

                Log.i(TAG, "Connected to: ${device.name} ($address)")

                activity.runOnUiThread {
                    val result = JSObject().apply {
                        put("connected", true)
                    }
                    call.resolve(result)
                }

            } catch (e: IOException) {
                Log.e(TAG, "Connection failed: ${e.message}")
                disconnectInternal()
                
                activity.runOnUiThread {
                    // Try fallback method for some devices
                    tryFallbackConnection(address, call)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Connection error", e)
                disconnectInternal()
                
                activity.runOnUiThread {
                    call.reject("Connection failed: ${e.message}")
                }
            }
        }
    }

    /**
     * Fallback connection method using reflection for stubborn devices
     */
    @SuppressLint("MissingPermission")
    private fun tryFallbackConnection(address: String, call: PluginCall) {
        thread(name = "BT-Fallback-$address") {
            try {
                Log.i(TAG, "Trying fallback connection method for: $address")
                
                val device = bluetoothAdapter?.getRemoteDevice(address)
                if (device == null) {
                    activity.runOnUiThread {
                        call.reject("Device not found: $address")
                    }
                    return@thread
                }

                // Use reflection to create socket (works for some industrial devices)
                val method = device.javaClass.getMethod(
                    "createRfcommSocket",
                    Int::class.javaPrimitiveType
                )
                val btSocket = method.invoke(device, 1) as BluetoothSocket
                
                btSocket.connect()
                
                socket = btSocket
                inputStream = btSocket.inputStream
                outputStream = btSocket.outputStream
                connectedDevice = device

                startReadingThread()
                notifyConnectionStateChanged(true)

                Log.i(TAG, "Fallback connection successful: ${device.name}")

                activity.runOnUiThread {
                    val result = JSObject().apply {
                        put("connected", true)
                    }
                    call.resolve(result)
                }

            } catch (e: Exception) {
                Log.e(TAG, "Fallback connection also failed", e)
                disconnectInternal()
                
                activity.runOnUiThread {
                    call.reject("Connection failed (both methods tried): ${e.message}")
                }
            }
        }
    }

    /**
     * Disconnect from the connected device
     */
    @PluginMethod
    fun disconnect(call: PluginCall) {
        Log.i(TAG, "Disconnect requested")
        disconnectInternal()
        call.resolve()
    }

    private fun disconnectInternal() {
        // Stop reading thread
        isReading.set(false)
        readThread?.interrupt()
        readThread = null

        // Close streams and socket
        try {
            inputStream?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing input stream", e)
        }
        inputStream = null

        try {
            outputStream?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing output stream", e)
        }
        outputStream = null

        try {
            socket?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing socket", e)
        }
        socket = null
        
        val wasConnected = connectedDevice != null
        connectedDevice = null

        // Clear buffer
        synchronized(bufferLock) {
            dataBuffer.clear()
        }

        if (wasConnected) {
            notifyConnectionStateChanged(false)
        }

        Log.i(TAG, "Disconnected and cleaned up")
    }

    /**
     * Check if currently connected
     */
    @PluginMethod
    fun isConnected(call: PluginCall) {
        val connected = socket?.isConnected == true
        val result = JSObject().apply {
            put("connected", connected)
        }
        call.resolve(result)
    }

    /**
     * Write data to connected device
     */
    @PluginMethod
    fun write(call: PluginCall) {
        val data = call.getString("data")
        if (data.isNullOrEmpty()) {
            call.reject("Data is required")
            return
        }

        val out = outputStream
        if (out == null || socket?.isConnected != true) {
            call.reject("Not connected")
            return
        }

        thread(name = "BT-Write") {
            try {
                out.write(data.toByteArray(Charsets.UTF_8))
                out.flush()
                
                Log.d(TAG, "Wrote ${data.length} bytes")
                
                activity.runOnUiThread {
                    call.resolve()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Write error", e)
                activity.runOnUiThread {
                    call.reject("Write failed: ${e.message}")
                }
            }
        }
    }

    /**
     * Start the background thread for reading serial data
     */
    private fun startReadingThread() {
        isReading.set(true)
        
        readThread = thread(name = "BT-Read") {
            val buffer = ByteArray(READ_BUFFER_SIZE)
            var lastEmitTime = System.currentTimeMillis()
            
            Log.i(TAG, "Read thread started")
            
            while (isReading.get() && !Thread.currentThread().isInterrupted) {
                try {
                    val input = inputStream
                    val currentSocket = socket
                    
                    if (input == null || currentSocket == null || !currentSocket.isConnected) {
                        Log.w(TAG, "Connection lost, stopping read thread")
                        break
                    }

                    // Check if data is available (non-blocking check)
                    val available = input.available()
                    
                    if (available > 0) {
                        val bytesRead = input.read(buffer, 0, minOf(available, READ_BUFFER_SIZE))
                        
                        if (bytesRead > 0) {
                            val data = String(buffer, 0, bytesRead, Charsets.UTF_8)
                            
                            synchronized(bufferLock) {
                                dataBuffer.append(data)
                            }
                            
                            Log.v(TAG, "Read $bytesRead bytes: ${data.take(50)}")
                        }
                    }

                    // Emit buffered data at intervals
                    val now = System.currentTimeMillis()
                    if (now - lastEmitTime >= DATA_EMIT_INTERVAL_MS) {
                        synchronized(bufferLock) {
                            if (dataBuffer.isNotEmpty()) {
                                val toEmit = dataBuffer.toString()
                                dataBuffer.clear()
                                
                                emitData(toEmit)
                            }
                        }
                        lastEmitTime = now
                    }

                    // Small sleep to prevent CPU hogging
                    Thread.sleep(10)

                } catch (e: InterruptedException) {
                    Log.i(TAG, "Read thread interrupted")
                    break
                } catch (e: IOException) {
                    Log.e(TAG, "Read error (connection lost?)", e)
                    break
                } catch (e: Exception) {
                    Log.e(TAG, "Unexpected read error", e)
                    break
                }
            }

            Log.i(TAG, "Read thread stopped")
            
            // If we exited the loop unexpectedly, notify disconnect
            if (connectedDevice != null) {
                activity.runOnUiThread {
                    disconnectInternal()
                }
            }
        }
    }

    /**
     * Emit data to JavaScript listeners
     */
    private fun emitData(data: String) {
        activity.runOnUiThread {
            try {
                val eventData = JSObject().apply {
                    put("value", data)
                }
                notifyListeners("dataReceived", eventData)
                Log.d(TAG, "Emitted data: ${data.take(30)}...")
            } catch (e: Exception) {
                Log.e(TAG, "Error emitting data", e)
            }
        }
    }

    /**
     * Notify connection state changes
     */
    private fun notifyConnectionStateChanged(connected: Boolean) {
        activity.runOnUiThread {
            try {
                val eventData = JSObject().apply {
                    put("connected", connected)
                }
                notifyListeners("connectionStateChanged", eventData)
                Log.i(TAG, "Connection state changed: $connected")
            } catch (e: Exception) {
                Log.e(TAG, "Error notifying connection state", e)
            }
        }
    }

    override fun handleOnDestroy() {
        Log.i(TAG, "Plugin being destroyed, cleaning up")
        disconnectInternal()
        super.handleOnDestroy()
    }
}
