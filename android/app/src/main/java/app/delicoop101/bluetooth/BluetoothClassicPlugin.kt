package app.delicoop101.bluetooth

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.ActivityCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlinx.coroutines.*
import org.json.JSONArray
import java.io.IOException
import java.io.InputStream
import java.util.UUID

/**
 * Capacitor plugin for Classic Bluetooth (SPP) communication.
 * Used for connecting to Bluetooth scales and printers.
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
            strings = [Manifest.permission.BLUETOOTH_CONNECT],
            alias = "bluetoothConnect"
        ),
        Permission(
            strings = [Manifest.permission.BLUETOOTH_SCAN],
            alias = "bluetoothScan"
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
    }

    private data class RoleConnection(
        var socket: BluetoothSocket? = null,
        var device: BluetoothDevice? = null,
        var inputStream: InputStream? = null,
        var readJob: Job? = null
    )

    private var bluetoothAdapter: BluetoothAdapter? = null
    private val connections = mutableMapOf(
        "scale" to RoleConnection(),
        "printer" to RoleConnection()
    )
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun load() {
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter ?: BluetoothAdapter.getDefaultAdapter()
        Log.d(TAG, "[BT] Plugin loaded, adapter available: ${bluetoothAdapter != null}, enabled: ${bluetoothAdapter?.isEnabled == true}, sdk: ${Build.VERSION.SDK_INT}")
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val result = JSObject()
        result.put("available", bluetoothAdapter != null)
        result.put("enabled", bluetoothAdapter?.isEnabled == true)
        result.put("sdk", Build.VERSION.SDK_INT)
        call.resolve(result)
    }

    @PluginMethod
    fun isEnabled(call: PluginCall) {
        val result = JSObject()
        result.put("enabled", bluetoothAdapter?.isEnabled == true)
        call.resolve(result)
    }

    /**
     * Request Bluetooth permissions explicitly. On Android 12+ (API 31+) this
     * requests BLUETOOTH_SCAN + BLUETOOTH_CONNECT; on older versions it falls
     * back to BLUETOOTH + BLUETOOTH_ADMIN + ACCESS_FINE_LOCATION (already auto-granted at install).
     * Resolves { granted: Boolean }.
     */
    @PluginMethod
    fun requestBluetoothPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            val result = JSObject()
            result.put("granted", true)
            result.put("legacyInstallTime", true)
            call.resolve(result)
            return
        }

        if (hasBluetoothPermissions()) {
            val result = JSObject()
            result.put("granted", true)
            call.resolve(result)
            return
        }

        val aliases: Array<String> = arrayOf("bluetoothScan", "bluetoothConnect")
        requestPermissionForAliases(aliases, call, "bluetoothPermsCallback")
    }

    @PermissionCallback
    private fun bluetoothPermsCallback(call: PluginCall) {
        val granted = hasBluetoothPermissions()
        Log.d(TAG, "[BT] requestBluetoothPermissions result: granted=$granted")
        val result = JSObject()
        result.put("granted", granted)
        call.resolve(result)
    }

    @PluginMethod
    fun getPairedDevices(call: PluginCall) {
        if (!hasBluetoothPermissions()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                requestPermissionForAliases(arrayOf("bluetoothConnect", "bluetoothScan"), call, "pairedDevicesCallback")
            } else {
                call.reject("Bluetooth install-time permission missing")
            }
            return
        }

        val adapter = bluetoothAdapter
        if (adapter == null) {
            call.reject("Bluetooth adapter unavailable")
            return
        }

        if (!adapter.isEnabled) {
            call.reject("Bluetooth is disabled")
            return
        }

        try {
            val devicesArray = JSONArray()
            adapter.bondedDevices?.forEach { device ->
                val obj = JSObject()
                obj.put("name", device.name ?: "Unknown")
                obj.put("address", device.address)
                obj.put("type", device.type)
                obj.put("bonded", true)
                devicesArray.put(obj)
            }

            Log.d(TAG, "[BT] Found ${devicesArray.length()} paired devices")

            val result = JSObject()
            result.put("devices", devicesArray)
            call.resolve(result)
        } catch (e: SecurityException) {
            call.reject("Bluetooth permission denied", e)
        }
    }

    @PermissionCallback
    private fun pairedDevicesCallback(call: PluginCall) {
        if (hasBluetoothPermissions()) {
            getPairedDevices(call)
        } else {
            call.reject("Bluetooth permissions not granted")
        }
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        connectToDevice(call, insecure = false, role = call.getString("role") ?: "scale")
    }

    @PluginMethod
    fun connectInsecure(call: PluginCall) {
        connectToDevice(call, insecure = true, role = call.getString("role") ?: "printer")
    }

    @PluginMethod
    fun connectScale(call: PluginCall) {
        connectToDevice(call, insecure = false, role = "scale")
    }

    @PluginMethod
    fun connectPrinter(call: PluginCall) {
        connectToDevice(call, insecure = false, role = "printer")
    }

    @PluginMethod
    fun connectPrinterInsecure(call: PluginCall) {
        connectToDevice(call, insecure = true, role = "printer")
    }

    private fun connectToDevice(call: PluginCall, insecure: Boolean, role: String) {
        val address = call.getString("address")
        if (address.isNullOrBlank()) {
            call.reject("Device address is required")
            return
        }

        val adapter = bluetoothAdapter ?: BluetoothAdapter.getDefaultAdapter()
        bluetoothAdapter = adapter
        if (adapter == null) {
            call.reject("Bluetooth adapter unavailable")
            return
        }

        if (!adapter.isEnabled) {
            call.reject("Bluetooth is disabled")
            return
        }

        if (!hasBluetoothPermissions()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                requestPermissionForAliases(arrayOf("bluetoothConnect", "bluetoothScan"), call, if (insecure) "connectInsecureCallback" else "connectCallback")
            } else {
                call.reject("Bluetooth install-time permission missing")
            }
            return
        }

        scope.launch {
            try {
                // Disconnect only this role. Scale and printer must not evict each other.
                disconnectRole(role, notify = false)

                val device = adapter.getRemoteDevice(address)

                Log.d(TAG, "[BT][$role] Connecting (${if (insecure) "insecure" else "secure"}) to ${device.name} ($address)")

                val socket = if (insecure) {
                    device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
                } else {
                    device.createRfcommSocketToServiceRecord(SPP_UUID)
                }
                
                socket.connect()

                val connection = connections.getOrPut(role) { RoleConnection() }
                connection.socket = socket
                connection.device = device
                connection.inputStream = socket.inputStream

                // Start reading data
                startReading(role)

                val result = JSObject()
                result.put("connected", true)
                result.put("name", device.name)
                result.put("address", device.address)
                result.put("insecure", insecure)
                result.put("role", role)

                withContext(Dispatchers.Main) {
                    call.resolve(result)
                }

                Log.d(TAG, "[BT][$role] Connected successfully to ${device.name}")

            } catch (e: IOException) {
                Log.e(TAG, "[BT][$role] Connection failed: ${e.message}", e)
                
                // v2.11.16: Auto-fallback to insecure if secure fails
                if (!insecure) {
                    Log.d(TAG, "[BT][$role] Secure connection failed, attempting insecure fallback...")
                    withContext(Dispatchers.Main) {
                        connectToDevice(call, insecure = true, role = role)
                    }
                } else {
                    withContext(Dispatchers.Main) {
                        call.reject("Connection failed: ${e.message}")
                    }
                }
            } catch (e: SecurityException) {
                Log.e(TAG, "[BT][$role] Bluetooth permission denied: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    call.reject("Bluetooth permission denied: ${e.message}")
                }
            } catch (e: IllegalArgumentException) {
                Log.e(TAG, "[BT][$role] Invalid device address: $address", e)
                withContext(Dispatchers.Main) {
                    call.reject("Invalid Bluetooth address: $address")
                }
            }
        }
    }

    @PermissionCallback
    private fun connectCallback(call: PluginCall) {
        if (hasBluetoothPermissions()) {
            connectToDevice(call, insecure = false, role = call.getString("role") ?: "scale")
        } else {
            call.reject("Bluetooth permissions not granted")
        }
    }

    @PermissionCallback
    private fun connectInsecureCallback(call: PluginCall) {
        if (hasBluetoothPermissions()) {
            connectToDevice(call, insecure = true, role = call.getString("role") ?: "printer")
        } else {
            call.reject("Bluetooth permissions not granted")
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall? = null) {
        val role = call?.getString("role")
        if (role == "scale" || role == "printer") {
            disconnectRole(role, notify = true)
        } else {
            disconnectRole("scale", notify = true)
            disconnectRole("printer", notify = true)
        }

        Log.d(TAG, "[BT] Disconnected")

        call?.let {
            val result = JSObject()
            result.put("disconnected", true)
            it.resolve(result)
        }
    }

    @PluginMethod
    fun isConnected(call: PluginCall) {
        val role = call.getString("role")
        val connection = if (role == "scale" || role == "printer") connections[role] else null
        val result = JSObject()
        result.put("connected", connection?.socket?.isConnected == true || (role == null && connections.values.any { it.socket?.isConnected == true }))
        if (role == "scale" || role == "printer") result.put("role", role)
        connection?.device?.let { device ->
            result.put("name", device.name)
            result.put("address", device.address)
        }
        call.resolve(result)
    }

    @PluginMethod
    fun write(call: PluginCall) {
        val data = call.getString("data")
        val role = call.getString("role") ?: "scale"
        if (data.isNullOrBlank()) {
            call.reject("Data is required")
            return
        }

        val socket = connections[role]?.socket
        if (socket == null || !socket.isConnected) {
            call.reject("$role not connected")
            return
        }

        scope.launch {
            try {
                socket.outputStream.write(data.toByteArray())
                socket.outputStream.flush()

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    call.resolve(result)
                }
            } catch (e: IOException) {
                Log.e(TAG, "[BT][$role] Write failed: ${e.message}")
                withContext(Dispatchers.Main) {
                    call.reject("Write failed: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun writePrinter(call: PluginCall) {
        writeWithRole(call, "printer")
    }

    @PluginMethod
    fun writeScale(call: PluginCall) {
        writeWithRole(call, "scale")
    }

    private fun writeWithRole(call: PluginCall, role: String) {
        val data = call.getString("data")
        if (data.isNullOrBlank()) {
            call.reject("Data is required")
            return
        }
        val socket = connections[role]?.socket
        if (socket == null || !socket.isConnected) {
            call.reject("$role not connected")
            return
        }
        scope.launch {
            try {
                socket.outputStream.write(data.toByteArray())
                socket.outputStream.flush()
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("role", role)
                    call.resolve(result)
                }
            } catch (e: IOException) {
                Log.e(TAG, "[BT][$role] Write failed: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    call.reject("Write failed: ${e.message}")
                }
            }
        }
    }

    private fun startReading(role: String) {
        val connection = connections.getOrPut(role) { RoleConnection() }
        connection.readJob?.cancel()
        connection.readJob = scope.launch {
            val buffer = ByteArray(1024)
            val stream = connection.inputStream ?: return@launch

            while (isActive && connection.socket?.isConnected == true) {
                try {
                    val bytes = stream.read(buffer)
                    if (bytes > 0) {
                        val data = String(buffer, 0, bytes)
                        Log.d(TAG, "[BT][$role] Received: $data")

                        withContext(Dispatchers.Main) {
                            val event = JSObject()
                            event.put("data", data)
                            event.put("role", role)
                            event.put("address", connection.device?.address)
                            notifyListeners("dataReceived", event)
                        }
                    }
                } catch (e: IOException) {
                    if (isActive) {
                        Log.e(TAG, "[BT][$role] Read error: ${e.message}")
                        withContext(Dispatchers.Main) {
                            val event = JSObject()
                            event.put("error", e.message)
                            event.put("role", role)
                            event.put("address", connection.device?.address)
                            notifyListeners("connectionLost", event)
                            val state = JSObject()
                            state.put("connected", false)
                            state.put("role", role)
                            state.put("address", connection.device?.address)
                            notifyListeners("connectionStateChanged", state)
                        }
                        break
                    }
                }
            }
        }
    }

    private fun disconnectRole(role: String, notify: Boolean) {
        val connection = connections.getOrPut(role) { RoleConnection() }
        val address = connection.device?.address
        connection.readJob?.cancel()
        connection.readJob = null
        try {
            connection.inputStream?.close()
            connection.socket?.close()
        } catch (e: IOException) {
            Log.e(TAG, "[BT][$role] Error closing connection: ${e.message}")
        }
        connection.inputStream = null
        connection.socket = null
        connection.device = null

        if (notify) {
            val state = JSObject()
            state.put("connected", false)
            state.put("role", role)
            state.put("address", address)
            notifyListeners("connectionStateChanged", state)
        }
    }

    private fun hasBluetoothPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    override fun handleOnDestroy() {
        disconnect()
        scope.cancel()
        super.handleOnDestroy()
    }
}
