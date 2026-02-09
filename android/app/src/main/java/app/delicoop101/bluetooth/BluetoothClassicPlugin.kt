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

    private var bluetoothAdapter: BluetoothAdapter? = null
    private var connectedSocket: BluetoothSocket? = null
    private var connectedDevice: BluetoothDevice? = null
    private var inputStream: InputStream? = null
    private var readJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun load() {
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        Log.d(TAG, "[BT] Plugin loaded, adapter available: ${bluetoothAdapter != null}")
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val result = JSObject()
        result.put("available", bluetoothAdapter != null)
        result.put("enabled", bluetoothAdapter?.isEnabled == true)
        call.resolve(result)
    }

    @PluginMethod
    fun isEnabled(call: PluginCall) {
        val result = JSObject()
        result.put("enabled", bluetoothAdapter?.isEnabled == true)
        call.resolve(result)
    }

    @PluginMethod
    fun getPairedDevices(call: PluginCall) {
        if (!hasBluetoothPermissions()) {
            requestAllPermissions(call, "pairedDevicesCallback")
            return
        }

        try {
            val devicesArray = JSONArray()
            bluetoothAdapter?.bondedDevices?.forEach { device ->
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
        val address = call.getString("address")
        if (address.isNullOrBlank()) {
            call.reject("Device address is required")
            return
        }

        if (!hasBluetoothPermissions()) {
            requestAllPermissions(call, "connectCallback")
            return
        }

        scope.launch {
            try {
                // Disconnect existing connection
                disconnect()

                val device = bluetoothAdapter?.getRemoteDevice(address)
                if (device == null) {
                    call.reject("Device not found")
                    return@launch
                }

                Log.d(TAG, "[BT] Connecting to ${device.name} ($address)")

                val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
                socket.connect()

                connectedSocket = socket
                connectedDevice = device
                inputStream = socket.inputStream

                // Start reading data
                startReading()

                val result = JSObject()
                result.put("connected", true)
                result.put("name", device.name)
                result.put("address", device.address)

                withContext(Dispatchers.Main) {
                    call.resolve(result)
                }

                Log.d(TAG, "[BT] Connected successfully to ${device.name}")

            } catch (e: IOException) {
                Log.e(TAG, "[BT] Connection failed: ${e.message}")
                withContext(Dispatchers.Main) {
                    call.reject("Connection failed: ${e.message}")
                }
            } catch (e: SecurityException) {
                withContext(Dispatchers.Main) {
                    call.reject("Bluetooth permission denied")
                }
            }
        }
    }

    @PermissionCallback
    private fun connectCallback(call: PluginCall) {
        if (hasBluetoothPermissions()) {
            connect(call)
        } else {
            call.reject("Bluetooth permissions not granted")
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall? = null) {
        readJob?.cancel()
        readJob = null

        try {
            inputStream?.close()
            connectedSocket?.close()
        } catch (e: IOException) {
            Log.e(TAG, "[BT] Error closing connection: ${e.message}")
        }

        inputStream = null
        connectedSocket = null
        connectedDevice = null

        Log.d(TAG, "[BT] Disconnected")

        call?.let {
            val result = JSObject()
            result.put("disconnected", true)
            it.resolve(result)
        }
    }

    @PluginMethod
    fun isConnected(call: PluginCall) {
        val result = JSObject()
        result.put("connected", connectedSocket?.isConnected == true)
        connectedDevice?.let { device ->
            result.put("name", device.name)
            result.put("address", device.address)
        }
        call.resolve(result)
    }

    @PluginMethod
    fun write(call: PluginCall) {
        val data = call.getString("data")
        if (data.isNullOrBlank()) {
            call.reject("Data is required")
            return
        }

        val socket = connectedSocket
        if (socket == null || !socket.isConnected) {
            call.reject("Not connected")
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
                Log.e(TAG, "[BT] Write failed: ${e.message}")
                withContext(Dispatchers.Main) {
                    call.reject("Write failed: ${e.message}")
                }
            }
        }
    }

    private fun startReading() {
        readJob?.cancel()
        readJob = scope.launch {
            val buffer = ByteArray(1024)
            val stream = inputStream ?: return@launch

            while (isActive && connectedSocket?.isConnected == true) {
                try {
                    val bytes = stream.read(buffer)
                    if (bytes > 0) {
                        val data = String(buffer, 0, bytes)
                        Log.d(TAG, "[BT] Received: $data")

                        withContext(Dispatchers.Main) {
                            val event = JSObject()
                            event.put("data", data)
                            notifyListeners("dataReceived", event)
                        }
                    }
                } catch (e: IOException) {
                    if (isActive) {
                        Log.e(TAG, "[BT] Read error: ${e.message}")
                        withContext(Dispatchers.Main) {
                            val event = JSObject()
                            event.put("error", e.message)
                            notifyListeners("connectionLost", event)
                        }
                        break
                    }
                }
            }
        }
    }

    private fun hasBluetoothPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        } else {
            ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }
    }

    override fun handleOnDestroy() {
        disconnect()
        scope.cancel()
        super.handleOnDestroy()
    }
}
