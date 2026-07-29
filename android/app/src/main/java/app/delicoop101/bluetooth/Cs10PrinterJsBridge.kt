package app.delicoop101.bluetooth

import android.os.Build
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.io.File

/**
 * v2.11.23: CS10 printer bridge with strict firmware-compatibility gate.
 *
 * The generic Ciontek POS SDK (vpos.apipackage.PosApiHelper + libPosApi.so)
 * requires:
 *   - /vendor/lib64/libcustom_jni.so  (vendor JNI helper — ships on
 *     CS30Pro/A10 firmware, MISSING on the CS10 A26/Android 7 firmware
 *     we saw in the field: full_a26_6737m/NRD90M/1608967428)
 *   - com.android.server.bcr.IBCRService$Stub  (system barcode AIDL
 *     stub — same story, only present on newer Ciontek builds).
 *
 * If either is missing, PosApiHelper's static initializer walks off a NULL
 * function pointer inside libPosApi.so and the entire process dies with
 * SIGSEGV. Java-level try/catch cannot rescue a native crash triggered by
 * <clinit>, so the ONLY safe strategy is: never touch the PosApiHelper class
 * on unsupported firmware. We resolve it lazily via reflection AFTER the
 * gate passes so the class loader never fires <clinit> on this device.
 *
 * When the gate is closed we return structured JSON to the WebView so the
 * JS layer can fall back to the Classic Bluetooth SPP printer path.
 */
class Cs10PrinterJsBridge {
    companion object {
        private const val TAG = "CS10-PRINTER"

        // Compute once per process. Reading two small files + one class probe
        // is cheap and avoids repeating the risky work on every JS call.
        private val gateResult: GateResult by lazy { computeGate() }

        private fun computeGate(): GateResult {
            val model = Build.MODEL ?: ""
            val manufacturer = Build.MANUFACTURER ?: ""

            val vendorLibA = File("/vendor/lib64/libcustom_jni.so")
            val vendorLibB = File("/system/vendor/lib64/libcustom_jni.so")
            val vendorLibC = File("/vendor/lib/libcustom_jni.so")
            val vendorLibD = File("/system/vendor/lib/libcustom_jni.so")
            val hasVendorLib = vendorLibA.exists() || vendorLibB.exists() ||
                vendorLibC.exists() || vendorLibD.exists()

            val hasBcrStub = try {
                Class.forName(
                    "com.android.server.bcr.IBCRService\$Stub",
                    false,
                    Cs10PrinterJsBridge::class.java.classLoader
                )
                true
            } catch (t: Throwable) {
                false
            }

            val usable = hasVendorLib && hasBcrStub
            val reason = when {
                !hasVendorLib && !hasBcrStub ->
                    "missing libcustom_jni.so and IBCRService stub (firmware $model/${Build.VERSION.SDK_INT} not supported by bundled POS SDK)"
                !hasVendorLib ->
                    "missing /vendor/lib*/libcustom_jni.so on this firmware"
                !hasBcrStub ->
                    "missing com.android.server.bcr.IBCRService\$Stub on this firmware"
                else -> "ok"
            }

            Log.d(
                TAG,
                "Gate: usable=$usable model=$model mfr=$manufacturer sdk=${Build.VERSION.SDK_INT} reason=$reason"
            )
            return GateResult(usable, reason, model, manufacturer)
        }
    }

    private data class GateResult(
        val usable: Boolean,
        val reason: String,
        val model: String,
        val manufacturer: String,
    )

    @JavascriptInterface
    fun isAvailable(): String = safeJson {
        val g = gateResult
        JSONObject()
            .put("available", g.usable)
            .put("reason", if (g.usable) "ok" else g.reason)
            .put("model", g.model)
            .put("manufacturer", g.manufacturer)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("bridge", true)
    }

    @JavascriptInterface
    fun status(): String = safeJson {
        val g = gateResult
        if (!g.usable) {
            return@safeJson JSONObject()
                .put("ready", false)
                .put("error", "cs10-sdk-unavailable")
                .put("reason", g.reason)
                .put("bridge", true)
        }
        val status = PosSdkProxy.checkStatus()
        JSONObject()
            .put("status", status)
            .put("ready", status == 0)
            .put("bridge", true)
    }

    @JavascriptInterface
    fun printText(text: String?): String = safeJson {
        val g = gateResult
        if (!g.usable) {
            Log.w(TAG, "printText refused: ${g.reason}")
            return@safeJson JSONObject()
                .put("error", "cs10-sdk-unavailable")
                .put("reason", g.reason)
                .put("bridge", true)
        }
        val content = text ?: ""
        if (content.isBlank()) throw IllegalArgumentException("Print text is empty")
        PosSdkProxy.printText(content)
        Log.d(TAG, "Print started successfully")
        JSONObject()
            .put("success", true)
            .put("bridge", true)
    }

    private fun safeJson(block: () -> JSONObject): String = try {
        block().toString()
    } catch (t: Throwable) {
        Log.e(TAG, "Call failed: ${t.message}", t)
        JSONObject()
            .put("error", t.message ?: t.javaClass.simpleName)
            .put("bridge", true)
            .toString()
    }
}

/**
 * Reflective proxy for vpos.apipackage.PosApiHelper. All references to the
 * SDK class live inside this object so it is only class-loaded (and its
 * <clinit> only fires) after the compatibility gate has passed.
 */
private object PosSdkProxy {
    private const val TAG = "CS10-PRINTER"

    @Volatile private var helper: Any? = null

    private fun getHelper(): Any {
        helper?.let { return it }
        synchronized(this) {
            helper?.let { return it }
            val cls = Class.forName("vpos.apipackage.PosApiHelper")
            val instance = cls.getMethod("getInstance").invoke(null)
                ?: throw IllegalStateException("PosApiHelper.getInstance() returned null")
            helper = instance
            return instance
        }
    }

    fun checkStatus(): Int {
        val h = getHelper()
        val m = h.javaClass.getMethod("PrintCheckStatus")
        return (m.invoke(h) as? Int) ?: -1
    }

    fun printText(content: String) {
        val h = getHelper()
        val cls = h.javaClass
        val initStatus = cls.getMethod("PrintInit").invoke(h) as Int
        if (initStatus != 0) throw IllegalStateException("PrintInit failed: $initStatus")

        cls.getMethod("PrintSetAlign", Int::class.javaPrimitiveType).invoke(h, 0)
        cls.getMethod(
            "PrintSetFont",
            Byte::class.javaPrimitiveType,
            Byte::class.javaPrimitiveType,
            Byte::class.javaPrimitiveType
        ).invoke(h, 24.toByte(), 20.toByte(), 0.toByte())

        val printStr = cls.getMethod("PrintStr", String::class.java)
        val normalized = content.replace("\r\n", "\n").replace("\r", "\n")
        for (line in normalized.split("\n")) {
            val status = printStr.invoke(h, line + "\n") as Int
            if (status != 0) throw IllegalStateException("PrintStr failed: $status")
        }
        printStr.invoke(h, "\n\n\n")

        val startStatus = cls.getMethod("PrintStart").invoke(h) as Int
        if (startStatus != 0) throw IllegalStateException("PrintStart failed: $startStatus")

        try {
            cls.getMethod("PrintClose").invoke(h)
        } catch (t: Throwable) {
            Log.w(TAG, "PrintClose warning: ${t.message}")
        }
    }
}
