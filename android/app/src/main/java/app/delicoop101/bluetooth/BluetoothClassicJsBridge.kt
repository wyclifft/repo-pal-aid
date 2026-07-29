package app.delicoop101.bluetooth

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
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
        JSONObject()
            .put("granted", hasBluetoothPermissions())
            .put("legacyInstallTime", Build.VERSION.SDK_INT < Build.VERSION_CODES.S)
            .put("fallback", true)
    }

    @JavascriptInterface
    fun getPairedDevices(): String = safeJson {
        if (!hasBluetoothPermissions()) throw IllegalStateException("Bluetooth permissions not granted")

        val adapter = adapter() ?: throw IllegalStateException("Bluetooth adapter unavailable")
        if (!adapter.isEnabled) throw IllegalStateException("Bluetooth is disabled")

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
        val options = JSONObject(payload ?: "{}")
        val address = options.optString("address").trim()
        val role = normalizeRole(options.optString("role", "scale"))
        val insecureRequested = options.optBoolean("insecure", false)

        if (address.isEmpty()) throw IllegalArgumentException("Device address is required")
        if (!hasBluetoothPermissions()) throw IllegalStateException("Bluetooth permissions not granted")

        val adapter = adapter() ?: throw IllegalStateException("Bluetooth adapter unavailable")
        if (!adapter.isEnabled) throw IllegalStateException("Bluetooth is disabled")
        adapter.cancelDiscovery()

        disconnectRole(role, notify = false)
        val device = adapter.getRemoteDevice(address)
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

        Log.d(TAG, "[BT][JS][$role] Connected to ${device.name ?: "Unknown"} ($address)")
        JSONObject()
            .put("connected", true)
            .put("name", device.name ?: "Unknown")
            .put("address", device.address)
            .put("role", role)
            .put("fallback", true)
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
        val options = JSONObject(payload ?: "{}")
        val role = normalizeRole(options.optString("role", "scale"))
        val data = options.optString("data", "")
        if (data.isEmpty()) throw IllegalArgumentException("Data is required")

        val connection = connections[role]
        val socket = connection?.socket
        if (socket == null || !socket.isConnected) throw IllegalStateException("$role not connected")

        try {
            socket.outputStream.write(data.toByteArray())
            socket.outputStream.flush()
            JSONObject().put("success", true).put("role", role).put("fallback", true)
        } catch (e: IOException) {
            val reason = e.message ?: "write failed"
            Log.e(TAG, "[BT][JS][$role] Write failed, clearing stale socket: $reason", e)
            handleRoleConnectionLost(role, connection.device?.address, reason)
            JSONObject()
                .put("error", "$role socket closed: $reason")
                .put("disconnected", true)
                .put("role", role)
                .put("fallback", true)
        }
    }

    fun shutdown() {
        disconnectRole("scale", notify = true)
        disconnectRole("printer", notify = true)
    }

    private fun connectSocket(device: BluetoothDevice, insecureRequested: Boolean): BluetoothSocket {
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
            if (insecureRequested) throw firstError

            Log.w(TAG, "[BT][JS] Secure connect failed, trying insecure fallback: ${firstError.message}")
            val fallback = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID)
            fallback.connect()
            fallback
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
                        val data = String(buffer, 0, bytes)
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
        try { connection.inputStream?.close() } catch (_: IOException) {}
        try { connection.socket?.close() } catch (_: IOException) {}
        connection.inputStream = null
        connection.socket = null
        connection.device = null

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