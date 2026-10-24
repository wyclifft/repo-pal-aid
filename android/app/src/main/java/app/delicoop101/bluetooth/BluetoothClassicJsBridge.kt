package app.delicoop101.bluetooth

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.util.UUID

/**
 * v2.11.20: WebView 51 fallback bridge for Classic Bluetooth.
 *
 * The normal Capacitor plugin remains the primary implementation. This direct
 * JavaScript interface is only used when Capacitor's plugin header export drops
 * BluetoothClassic on legacy Android/WebView builds and JS receives
 * UNIMPLEMENTED before the native plugin is ever invoked.
 */
class BluetoothClassicJsBridge(
    private val context: Context,
    private val webView: WebView
) {
    companion object {
        private const val TAG = "BluetoothClassicJS"
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    private data class RoleConnection(
        var socket: BluetoothSocket? = null,
        var device: BluetoothDevice? = null,
        var inputStream: InputStream? = null,
        var reader: Thread? = null
    )

    private val connections = mutableMapOf(
        "scale" to RoleConnection(),
        "printer" to RoleConnection()
    )

    private val connectMutex = Mutex()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    init {
        registerBluetoothReceiver()
    }

    private fun adapter(): BluetoothAdapter? = try {
        BluetoothAdapter.getDefaultAdapter()
    } catch (t: Throwable) {
        Log.e(TAG, "[BT][JS] Adapter lookup failed: ${t.message}", t)
        null
    }

    @JavascriptInterface
    fun isAvailable(): String = safeJson {
        val adapter = adapter()
        JSONObject()
            .put("available", adapter != null)
            .put("enabled", adapter?.isEnabled == true)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("fallback", true)
    }

    @JavascriptInterface
    fun requestBluetoothPermissions(): String = safeJson {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !hasBluetoothPermissions()) {
            ActivityCompat.requestPermissions(
                context as android.app.Activity,
                arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT),
                102 // random request code
            )
        }
        JSONObject()
            .put("granted", hasBluetoothPermissions())
            .put("legacyInstallTime", Build.VERSION.SDK_INT < Build.VERSION_CODES.S)
            .put("fallback", true)
    }

    @JavascriptInterface
    fun getPairedDevices(): String = safeJson {
        val adapter = adapter()
        if (!hasBluetoothPermissions() || adapter == null || !adapter.isEnabled) {
            return@safeJson JSONObject().put("devices", JSONArray()).put("fallback", true)
        }

        val devicesArray = JSONArray()
        adapter.bondedDevices?.forEach { device ->
            devicesArray.put(
                JSONObject()
                    .put("name", device.name ?: "Unknown")
                    .put("address", device.address)
                    .put("type", device.type)
                    .put("bonded", true)
            )
        }

        Log.d(TAG, "[BT][JS] Found ${devicesArray.length()} paired devices")
        JSONObject().put("devices", devicesArray).put("fallback", true)
    }

    @JavascriptInterface
    fun connect(payload: String?): String = safeJson {
        scope.launch {
            try {
                val options = JSONObject(payload ?: "{}")
                val address = options.optString("address").trim()
                val role = normalizeRole(options.optString("role", "scale"))
                val insecureRequested = options.optBoolean("insecure", false)

                if (address.isEmpty()) {
                    reportConnectError(role, "Device address is required")
                    return@launch
                }
                if (!hasBluetoothPermissions()) {
                    reportConnectError(role, "Bluetooth permissions not granted")
                    return@launch
                }

                val adapter = adapter()
                if (adapter == null) {
                    reportConnectError(role, "Bluetooth adapter unavailable")
                    return@launch
                }
                if (!adapter.isEnabled) {
                    reportConnectError(role, "Bluetooth is disabled")
                    return@launch
                }

                adapter.cancelDiscovery()
                disconnectRole(role, notify = false)

                val device = adapter.getRemoteDevice(address)
                Log.d(TAG, "[BT][JS][$role] Initiating async connection to ${device.name ?: "Unknown"} ($address)...")

                val socket = connectSocket(device, insecureRequested)
                val connection = connections.getOrPut(role) { RoleConnection() }
                connection.socket = socket
                connection.device = device
                connection.inputStream = socket.inputStream
                startReading(role)

                emit("BluetoothClassic:connectionStateChanged", JSONObject()
                    .put("connected", true)
                    .put("role", role)
                    .put("address", device.address)
                    .put("name", device.name ?: "Unknown"))

                Log.d(TAG, "[BT][JS][$role] Connected successfully to ${device.name ?: "Unknown"}")
            } catch (t: Throwable) {
                val role = try { JSONObject(payload ?: "{}").optString("role", "scale") } catch (e: Exception) { "scale" }
                val msg = t.message ?: t.javaClass.simpleName
                Log.e(TAG, "[BT][JS][$role] Async connect failed: $msg", t)
                reportConnectError(role, msg)
            }
        }

        JSONObject()
            .put("initiated", true)
            .put("fallback", true)
    }

    private fun reportConnectError(role: String, error: String) {
        emit("BluetoothClassic:connectionStateChanged", JSONObject()
            .put("connected", false)
            .put("role", role)
            .put("error", error))
    }

    @JavascriptInterface
    fun disconnect(payload: String?): String = safeJson {
        val options = JSONObject(payload ?: "{}")
        val role = options.optString("role", "")
        if (role == "scale" || role == "printer") {
            disconnectRole(role, notify = true)
        } else {
            disconnectRole("scale", notify = true)
            disconnectRole("printer", notify = true)
        }
        JSONObject().put("disconnected", true).put("fallback", true)
    }

    @JavascriptInterface
    fun isConnected(payload: String?): String = safeJson {
        val options = JSONObject(payload ?: "{}")
        val role = options.optString("role", "")
        val connected = if (role == "scale" || role == "printer") {
            connections[role]?.socket?.isConnected == true
        } else {
            connections.values.any { it.socket?.isConnected == true }
        }
        val result = JSONObject().put("connected", connected).put("fallback", true)
        if (role == "scale" || role == "printer") result.put("role", role)
        result
    }

    @JavascriptInterface
    fun write(payload: String?): String = safeJson {
        scope.launch {
            try {
                val options = JSONObject(payload ?: "{}")
                val role = normalizeRole(options.optString("role", "scale"))
                val data = options.optString("data", "")
                if (data.isEmpty()) return@launch

                val connection = connections[role]
                val socket = connection?.socket
                if (socket == null || !socket.isConnected) {
                    Log.e(TAG, "[BT][JS][$role] Async write failed: Not connected")
                    handleRoleConnectionLost(role, connection?.device?.address, "not connected")
                    return@launch
                }

                socket.outputStream.write(data.toByteArray())
                socket.outputStream.flush()
            } catch (e: IOException) {
                val role = try { JSONObject(payload ?: "{}").optString("role", "scale") } catch(ex: Exception) { "scale" }
                val reason = e.message ?: "write failed"
                Log.e(TAG, "[BT][JS][$role] Async write failed, clearing stale socket: $reason", e)
                handleRoleConnectionLost(role, connections[role]?.device?.address, reason)
            }
        }
        JSONObject().put("success", true).put("initiated", true).put("fallback", true)
    }

    fun shutdown() {
        unregisterBluetoothReceiver()
        scope.cancel()
        disconnectRole("scale", notify = true)
        disconnectRole("printer", notify = true)
    }

    private suspend fun connectSocket(device: BluetoothDevice, insecureRequested: Boolean): BluetoothSocket = connectMutex.withLock {
        delay(200)

        val first = if (insecureRequested) {
            device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
        } else {
            device.createRfcommSocketToServiceRecord(SPP_UUID)
        }

        return try {
            first.connect()
            first
        } catch (firstError: IOException) {
            try { first.close() } catch (_: IOException) {}

            val msg = firstError.message ?: ""
            // Fail fast if remote device is completely unreachable / turned off to prevent multi-tier timeout locks
            if (msg.contains("socket might closed or timeout", ignoreCase = true) || msg.contains("Connection refused", ignoreCase = true)) {
                Log.w(TAG, "[BT][JS] Primary connect failed due to device offline/unreachable (${firstError.message}); skipping secondary fallbacks")
                throw firstError
            }

            Log.w(TAG, "[BT][JS] Secure connect failed (${firstError.message}), trying insecure fallback...")
            val fallback = try {
                device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
            } catch (e: Throwable) { null }

            if (fallback != null) {
                try {
                    fallback.connect()
                    return@withLock fallback
                } catch (fallbackError: IOException) {
                    try { fallback.close() } catch (_: IOException) {}
                    Log.w(TAG, "[BT][JS] Insecure connect failed (${fallbackError.message}), trying reflection port 1 fallback...")
                }
            }

            // Fallback: Reflection createRfcommSocket(1) for direct RFCOMM channel 1
            var reflectionSocket: BluetoothSocket? = null
            try {
                val m = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
                reflectionSocket = m.invoke(device, 1) as BluetoothSocket
                reflectionSocket.connect()
                reflectionSocket
            } catch (reflectionError: Throwable) {
                try { reflectionSocket?.close() } catch (_: Throwable) {}
                Log.e(TAG, "[BT][JS] Reflection fallback failed: ${reflectionError.message}")
                throw firstError
            }
        }
    }

    private fun startReading(role: String) {
        val connection = connections.getOrPut(role) { RoleConnection() }
        connection.reader?.interrupt()

        val stream = connection.inputStream ?: return
        val address = connection.device?.address
        val reader = Thread {
            val buffer = ByteArray(1024)
            while (!Thread.currentThread().isInterrupted && connection.socket?.isConnected == true) {
                try {
                    val bytes = stream.read(buffer)
                    if (bytes > 0) {
                        val data = String(buffer, 0, bytes, Charsets.ISO_8859_1)
                        Log.d(TAG, "[BT][JS][$role] Read $bytes bytes: '$data'")
                        emit("BluetoothClassic:dataReceived", JSONObject()
                            .put("data", data)
                            .put("role", role)
                            .put("address", address))
                    } else if (bytes < 0) {
                        val reason = "bt socket closed, read return: $bytes"
                        Log.e(TAG, "[BT][JS][$role] Read error: $reason")
                        handleRoleConnectionLost(role, address, reason)
                        break
                    }
                } catch (e: IOException) {
                    val reason = e.message ?: "Read error"
                    Log.e(TAG, "[BT][JS][$role] Read error: $reason")
                    handleRoleConnectionLost(role, address, reason)
                    break
                }
            }
        }
        reader.name = "BTClassic-$role-reader"
        reader.isDaemon = true
        connection.reader = reader
        reader.start()
    }

    private fun handleRoleConnectionLost(role: String, address: String?, error: String) {
        disconnectRole(role, notify = false)
        emit("BluetoothClassic:connectionLost", JSONObject()
            .put("error", error)
            .put("role", role)
            .put("address", address))
        emit("BluetoothClassic:connectionStateChanged", JSONObject()
            .put("connected", false)
            .put("role", role)
            .put("address", address)
            .put("error", error))
    }

    private fun disconnectRole(role: String, notify: Boolean) {
        val connection = connections.getOrPut(role) { RoleConnection() }
        val address = connection.device?.address
        connection.reader?.interrupt()
        connection.reader = null

        val socketToClose = connection.socket
        val streamToClose = connection.inputStream
        connection.inputStream = null
        connection.socket = null
        connection.device = null

        try { streamToClose?.close() } catch (_: Throwable) {}
        try { socketToClose?.close() } catch (_: Throwable) {}

        if (notify) {
            emit("BluetoothClassic:connectionStateChanged", JSONObject()
                .put("connected", false)
                .put("role", role)
                .put("address", address))
        }
    }

    private fun hasBluetoothPermissions(): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
    } else {
        true
    }

    private fun normalizeRole(role: String): String = if (role == "printer") "printer" else "scale"

    private fun safeJson(block: () -> JSONObject): String = try {
        block().toString()
    } catch (t: Throwable) {
        Log.e(TAG, "[BT][JS] Call failed: ${t.message}", t)
        JSONObject()
            .put("error", t.message ?: t.javaClass.simpleName)
            .put("fallback", true)
            .toString()
    }

    private var bluetoothReceiverRegistered = false
    private val bluetoothReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            val action = intent?.action ?: return
            when (action) {
                BluetoothAdapter.ACTION_STATE_CHANGED -> {
                    val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                    Log.d(TAG, "[BT][JS] BroadcastReceiver ACTION_STATE_CHANGED: state=$state")
                    if (state == BluetoothAdapter.STATE_TURNING_OFF || state == BluetoothAdapter.STATE_OFF) {
                        Log.w(TAG, "[BT][JS] Bluetooth adapter turning off or off — disconnecting all roles")
                        disconnectRole("scale", notify = true)
                        disconnectRole("printer", notify = true)
                    } else if (state == BluetoothAdapter.STATE_ON) {
                        Log.i(TAG, "[BT][JS] Bluetooth adapter turned ON — notifying listeners")
                        emit("BluetoothClassic:adapterStateChanged", JSONObject()
                            .put("enabled", true)
                            .put("state", state))
                    }
                }
                BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                    val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
                    val address = device?.address
                    Log.d(TAG, "[BT][JS] BroadcastReceiver ACTION_ACL_DISCONNECTED: device=${device?.name} ($address)")
                    if (address != null) {
                        connections.forEach { (role, conn) ->
                            if (conn.device?.address == address) {
                                Log.w(TAG, "[BT][JS][$role] Device ACL disconnected ($address)")
                                disconnectRole(role, notify = true)
                            }
                        }
                    }
                }
            }
        }
    }

    private fun registerBluetoothReceiver() {
        if (bluetoothReceiverRegistered) return
        try {
            val filter = IntentFilter().apply {
                addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
                addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
            }
            context.registerReceiver(bluetoothReceiver, filter)
            bluetoothReceiverRegistered = true
            Log.d(TAG, "[BT][JS] Registered Bluetooth state/ACL BroadcastReceiver")
        } catch (t: Throwable) {
            Log.e(TAG, "[BT][JS] Failed to register Bluetooth BroadcastReceiver: ${t.message}")
        }
    }

    private fun unregisterBluetoothReceiver() {
        if (!bluetoothReceiverRegistered) return
        try {
            context.unregisterReceiver(bluetoothReceiver)
            bluetoothReceiverRegistered = false
        } catch (_: Throwable) {}
    }

    private fun emit(eventName: String, detail: JSONObject) {
        val js = """
            (function(){
              var detail = ${detail};
              var eventName = ${JSONObject.quote(eventName)};
              var ev;
              try { ev = new CustomEvent(eventName, { detail: detail }); }
              catch (e) { ev = document.createEvent('CustomEvent'); ev.initCustomEvent(eventName, false, false, detail); }
              window.dispatchEvent(ev);
            })();
        """.trimIndent()

        webView.post {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                webView.evaluateJavascript(js, null)
            } else {
                webView.loadUrl("javascript:$js")
            }
        }
    }
}