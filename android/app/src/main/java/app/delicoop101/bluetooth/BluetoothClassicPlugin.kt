package app.delicoop101.bluetooth

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
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlinx.coroutines.*
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Capacitor plugin for Classic Bluetooth (SPP) communication.
 * 
 * This plugin enables:
 * - Scanning for paired Bluetooth devices
 * - Connecting to devices via SPP (Serial Port Profile)
 * - Reading weight data from Bluetooth scales
 * - Sending data to Bluetooth printers
 * 
 * Supports both legacy Bluetooth permissions (Android < 12)
 * and new runtime permissions (Android 12+).
 */
@CapacitorPlugin(
    name = "BluetoothClassic",
    permissions = [
        Permission(
            strings = [Manifest.permission.BLUETOOTH],
            alias = "bluetooth"
        ),
        Permission(
            strings = [Manifest.permission.BLUETOOTH_ADMIN],
            alias = "bluetoothAdmin"
        ),
        Permission(
            strings = [Manifest.permission.BLUETOOTH_SCAN],
            alias = "bluetoothScan"
        ),
        Permission(
            strings = [Manifest.permission.BLUETOOTH_CONNECT],
            alias = "bluetoothConnect"
        ),
        Permission(
            strings = [Manifest.permission.ACCESS_FINE_LOCATION],
            alias = "location"
        )
    ]
)
class BluetoothClassicPlugin : Plugin() {
    
    companion object {
        private const val TAG = "BluetoothClassic"
        
        // Standard SPP UUID for serial communication
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        
        // Connection timeout in milliseconds
        private const val CONNECT_TIMEOUT = 10000L
        
        // Read buffer size
        private const val BUFFER_SIZE = 1024
    }
    
    // Bluetooth adapter reference
    private var bluetoothAdapter: BluetoothAdapter? = null
    
    // Active connections map (deviceId -> Connection)
    private val connections = ConcurrentHashMap<String, DeviceConnection>()
    
    // Coroutine scope for async operations
    private val pluginScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    /**
     * Data class to hold connection state
     */
    private data class DeviceConnection(
        val device: BluetoothDevice,
        val socket: BluetoothSocket,
        val inputStream: InputStream,
        val outputStream: OutputStream,
        var isReading: Boolean = false,
        var readJob: Job? = null
    )
    
    override fun load() {
        super.load()
        Log.d(TAG, "[BT] BluetoothClassicPlugin loaded")
        
        // Initialize Bluetooth adapter
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        
        if (bluetoothAdapter == null) {
            Log.w(TAG, "[BT] Bluetooth not supported on this device")
        } else {
            Log.d(TAG, "[BT] Bluetooth adapter initialized")
        }
    }
    
    /**
     * Check if Bluetooth is available and enabled
     */
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val result = JSObject()
        result.put("available", bluetoothAdapter != null)
        result.put("enabled", bluetoothAdapter?.isEnabled == true)
        call.resolve(result)
    }
    
    /**
     * Request Bluetooth permissions
     */
    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        Log.d(TAG, "[BT] Requesting Bluetooth permissions")
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+ requires BLUETOOTH_SCAN and BLUETOOTH_CONNECT
            requestPermissionForAlias("bluetoothScan", call, "permissionsCallback")
        } else {
            // Legacy permissions
            requestPermissionForAlias("bluetooth", call, "permissionsCallback")
        }
    }
    
    @PermissionCallback
    private fun permissionsCallback(call: PluginCall) {
        Log.d(TAG, "[BT] Permissions callback received")
        
        val result = JSObject()
        val granted = hasBluetoothPermissions()
        result.put("granted", granted)
        
        if (granted) {
            Log.d(TAG, "[BT] All required permissions granted")
        } else {
            Log.w(TAG, "[BT] Some permissions were denied")
        }
        
        call.resolve(result)
    }
    
    /**
     * Get list of paired Bluetooth devices
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun getPairedDevices(call: PluginCall) {
        Log.d(TAG, "[BT] Getting paired devices")
        
        if (!hasBluetoothPermissions()) {
            call.reject("Bluetooth permissions not granted")
            return
        }
        
        if (bluetoothAdapter == null) {
            call.reject("Bluetooth not available")
            return
        }
        
        if (!bluetoothAdapter!!.isEnabled) {
            call.reject("Bluetooth is not enabled")
            return
        }
        
        try {
            val pairedDevices = bluetoothAdapter!!.bondedDevices
            val devicesArray = JSArray()
            
            for (device in pairedDevices) {
                val deviceObj = JSObject()
                deviceObj.put("id", device.address)
                deviceObj.put("name", device.name ?: "Unknown Device")
                deviceObj.put("address", device.address)
                deviceObj.put("type", getDeviceTypeString(device.type))
                deviceObj.put("bondState", getBondStateString(device.bondState))
                devicesArray.put(deviceObj)
            }
            
            Log.d(TAG, "[BT] Found ${pairedDevices.size} paired devices")
            
            val result = JSObject()
            result.put("devices", devicesArray)
            call.resolve(result)
            
        } catch (e: Exception) {
            Log.e(TAG, "[BT] Error getting paired devices", e)
            call.reject("Failed to get paired devices: ${e.message}")
        }
    }
    
    /**
     * Connect to a Bluetooth device using SPP
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun connect(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        
        if (deviceId.isNullOrEmpty()) {
            call.reject("Device ID is required")
            return
        }
        
        Log.d(TAG, "[BT] Connecting to device: $deviceId")
        
        if (!hasBluetoothPermissions()) {
            call.reject("Bluetooth permissions not granted")
            return
        }
        
        if (bluetoothAdapter == null || !bluetoothAdapter!!.isEnabled) {
            call.reject("Bluetooth is not available or enabled")
            return
        }
        
        // Check if already connected
        if (connections.containsKey(deviceId)) {
            Log.d(TAG, "[BT] Already connected to $deviceId")
            val result = JSObject()
            result.put("connected", true)
            result.put("deviceId", deviceId)
            call.resolve(result)
            return
        }
        
        pluginScope.launch {
            try {
                val device = bluetoothAdapter!!.getRemoteDevice(deviceId)
                
                // Cancel discovery to speed up connection
                bluetoothAdapter!!.cancelDiscovery()
                
                // Create socket with timeout
                val socket = withTimeoutOrNull(CONNECT_TIMEOUT) {
                    val sock = device.createRfcommSocketToServiceRecord(SPP_UUID)
                    sock.connect()
                    sock
                }
                
                if (socket == null || !socket.isConnected) {
                    withContext(Dispatchers.Main) {
                        call.reject("Connection timeout")
                    }
                    return@launch
                }
                
                // Store connection
                val connection = DeviceConnection(
                    device = device,
                    socket = socket,
                    inputStream = socket.inputStream,
                    outputStream = socket.outputStream
                )
                connections[deviceId] = connection
                
                Log.d(TAG, "[BT] Successfully connected to $deviceId")
                
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("connected", true)
                    result.put("deviceId", deviceId)
                    result.put("deviceName", device.name ?: "Unknown")
                    call.resolve(result)
                    
                    // Notify listeners
                    notifyListeners("connectionStateChange", JSObject().apply {
                        put("deviceId", deviceId)
                        put("connected", true)
                    })
                }
                
            } catch (e: IOException) {
                Log.e(TAG, "[BT] Connection failed", e)
                withContext(Dispatchers.Main) {
                    call.reject("Connection failed: ${e.message}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "[BT] Unexpected error during connection", e)
                withContext(Dispatchers.Main) {
                    call.reject("Connection error: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Disconnect from a Bluetooth device
     */
    @PluginMethod
    fun disconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        
        if (deviceId.isNullOrEmpty()) {
            call.reject("Device ID is required")
            return
        }
        
        Log.d(TAG, "[BT] Disconnecting from device: $deviceId")
        
        val connection = connections.remove(deviceId)
        
        if (connection != null) {
            try {
                connection.readJob?.cancel()
                connection.socket.close()
                Log.d(TAG, "[BT] Disconnected from $deviceId")
            } catch (e: Exception) {
                Log.e(TAG, "[BT] Error closing connection", e)
            }
            
            // Notify listeners
            notifyListeners("connectionStateChange", JSObject().apply {
                put("deviceId", deviceId)
                put("connected", false)
            })
        }
        
        val result = JSObject()
        result.put("disconnected", true)
        result.put("deviceId", deviceId)
        call.resolve(result)
    }
    
    /**
     * Check if connected to a device
     */
    @PluginMethod
    fun isConnected(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        
        if (deviceId.isNullOrEmpty()) {
            call.reject("Device ID is required")
            return
        }
        
        val connection = connections[deviceId]
        val connected = connection?.socket?.isConnected == true
        
        val result = JSObject()
        result.put("connected", connected)
        result.put("deviceId", deviceId)
        call.resolve(result)
    }
    
    /**
     * Write data to a connected device
     */
    @PluginMethod
    fun write(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        val data = call.getString("data")
        
        if (deviceId.isNullOrEmpty()) {
            call.reject("Device ID is required")
            return
        }
        
        if (data.isNullOrEmpty()) {
            call.reject("Data is required")
            return
        }
        
        val connection = connections[deviceId]
        
        if (connection == null || !connection.socket.isConnected) {
            call.reject("Device not connected")
            return
        }
        
        pluginScope.launch {
            try {
                val bytes = data.toByteArray(Charsets.UTF_8)
                connection.outputStream.write(bytes)
                connection.outputStream.flush()
                
                Log.d(TAG, "[BT] Wrote ${bytes.size} bytes to $deviceId")
                
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("bytesWritten", bytes.size)
                    call.resolve(result)
                }
                
            } catch (e: IOException) {
                Log.e(TAG, "[BT] Write failed", e)
                handleDisconnection(deviceId)
                withContext(Dispatchers.Main) {
                    call.reject("Write failed: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Write raw bytes to a connected device (for printer commands)
     */
    @PluginMethod
    fun writeBytes(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        val dataArray = call.getArray("data")
        
        if (deviceId.isNullOrEmpty()) {
            call.reject("Device ID is required")
            return
        }
        
        if (dataArray == null) {
            call.reject("Data array is required")
            return
        }
        
        val connection = connections[deviceId]
        
        if (connection == null || !connection.socket.isConnected) {
            call.reject("Device not connected")
            return
        }
        
        pluginScope.launch {
            try {
                val bytes = ByteArray(dataArray.length()) { i ->
                    dataArray.getInt(i).toByte()
                }
                
                connection.outputStream.write(bytes)
                connection.outputStream.flush()
                
                Log.d(TAG, "[BT] Wrote ${bytes.size} raw bytes to $deviceId")
                
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("bytesWritten", bytes.size)
                    call.resolve(result)
                }
                
            } catch (e: IOException) {
                Log.e(TAG, "[BT] WriteBytes failed", e)
                handleDisconnection(deviceId)
                withContext(Dispatchers.Main) {
                    call.reject("Write failed: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Start reading data from a connected device
     */
    @PluginMethod
    fun startReading(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        
        if (deviceId.isNullOrEmpty()) {
            call.reject("Device ID is required")
            return
        }
        
        val connection = connections[deviceId]
        
        if (connection == null || !connection.socket.isConnected) {
            call.reject("Device not connected")
            return
        }
        
        if (connection.isReading) {
            Log.d(TAG, "[BT] Already reading from $deviceId")
            val result = JSObject()
            result.put("started", true)
            call.resolve(result)
            return
        }
        
        connection.isReading = true
        connection.readJob = pluginScope.launch {
            val buffer = ByteArray(BUFFER_SIZE)
            
            Log.d(TAG, "[BT] Started reading from $deviceId")
            
            while (isActive && connection.isReading && connection.socket.isConnected) {
                try {
                    val bytesRead = connection.inputStream.read(buffer)
                    
                    if (bytesRead > 0) {
                        val data = String(buffer, 0, bytesRead, Charsets.UTF_8)
                        
                        Log.d(TAG, "[BT] Received $bytesRead bytes: $data")
                        
                        withContext(Dispatchers.Main) {
                            notifyListeners("dataReceived", JSObject().apply {
                                put("deviceId", deviceId)
                                put("data", data)
                                put("bytesRead", bytesRead)
                            })
                        }
                    }
                    
                } catch (e: IOException) {
                    if (connection.isReading) {
                        Log.e(TAG, "[BT] Read error", e)
                        handleDisconnection(deviceId)
                    }
                    break
                }
            }
            
            Log.d(TAG, "[BT] Stopped reading from $deviceId")
        }
        
        val result = JSObject()
        result.put("started", true)
        call.resolve(result)
    }
    
    /**
     * Stop reading data from a connected device
     */
    @PluginMethod
    fun stopReading(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        
        if (deviceId.isNullOrEmpty()) {
            call.reject("Device ID is required")
            return
        }
        
        val connection = connections[deviceId]
        
        if (connection != null) {
            connection.isReading = false
            connection.readJob?.cancel()
            Log.d(TAG, "[BT] Stopped reading from $deviceId")
        }
        
        val result = JSObject()
        result.put("stopped", true)
        call.resolve(result)
    }
    
    /**
     * Get all active connections
     */
    @PluginMethod
    fun getConnections(call: PluginCall) {
        val connectionsArray = JSArray()
        
        for ((deviceId, connection) in connections) {
            val connObj = JSObject()
            connObj.put("deviceId", deviceId)
            connObj.put("connected", connection.socket.isConnected)
            connObj.put("isReading", connection.isReading)
            connectionsArray.put(connObj)
        }
        
        val result = JSObject()
        result.put("connections", connectionsArray)
        call.resolve(result)
    }
    
    /**
     * Clean up all connections when plugin is destroyed
     */
    override fun handleOnDestroy() {
        Log.d(TAG, "[BT] Plugin destroyed, cleaning up connections")
        
        pluginScope.cancel()
        
        for ((deviceId, connection) in connections) {
            try {
                connection.readJob?.cancel()
                connection.socket.close()
            } catch (e: Exception) {
                Log.e(TAG, "[BT] Error closing connection $deviceId", e)
            }
        }
        connections.clear()
        
        super.handleOnDestroy()
    }
    
    // Helper methods
    
    private fun hasBluetoothPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ActivityCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            ActivityCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH
            ) == PackageManager.PERMISSION_GRANTED
        }
    }
    
    private fun getDeviceTypeString(type: Int): String {
        return when (type) {
            BluetoothDevice.DEVICE_TYPE_CLASSIC -> "classic"
            BluetoothDevice.DEVICE_TYPE_LE -> "le"
            BluetoothDevice.DEVICE_TYPE_DUAL -> "dual"
            else -> "unknown"
        }
    }
    
    private fun getBondStateString(state: Int): String {
        return when (state) {
            BluetoothDevice.BOND_BONDED -> "bonded"
            BluetoothDevice.BOND_BONDING -> "bonding"
            BluetoothDevice.BOND_NONE -> "none"
            else -> "unknown"
        }
    }
    
    private fun handleDisconnection(deviceId: String) {
        val connection = connections.remove(deviceId)
        
        if (connection != null) {
            connection.isReading = false
            connection.readJob?.cancel()
            
            try {
                connection.socket.close()
            } catch (e: Exception) {
                // Ignore
            }
            
            activity?.runOnUiThread {
                notifyListeners("connectionStateChange", JSObject().apply {
                    put("deviceId", deviceId)
                    put("connected", false)
                    put("reason", "disconnected")
                })
            }
        }
    }
}
