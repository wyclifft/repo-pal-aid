package app.delicoop101.bluetooth

import android.os.Build
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject
import vpos.apipackage.PosApiHelper

/**
 * v2.11.22: Direct WebView bridge for the Ciontek CS10/Z100 internal printer.
 *
 * The built-in printer is not a Bluetooth SPP device, so it will never appear
 * as a paired Bluetooth printer. It is driven by the vendor POS SDK instead.
 */
class Cs10PrinterJsBridge {
    companion object {
        private const val TAG = "CS10-PRINTER"
        private const val NOT_INIT = 9998
    }

    private var printer: PosApiHelper? = null

    @JavascriptInterface
    fun isAvailable(): String = safeJson {
        val model = Build.MODEL ?: ""
        val manufacturer = Build.MANUFACTURER ?: ""
        val looksLikeCs10 = model.uppercase().contains("CS10") || model.uppercase().contains("Z100")
        JSONObject()
            .put("available", looksLikeCs10 || canInitialize())
            .put("model", model)
            .put("manufacturer", manufacturer)
            .put("sdk", Build.VERSION.SDK_INT)
            .put("bridge", true)
    }

    @JavascriptInterface
    fun status(): String = safeJson {
        val p = ensurePrinter()
        val status = p.PrintCheckStatus()
        JSONObject()
            .put("status", status)
            .put("ready", status == 0)
            .put("bridge", true)
    }

    @JavascriptInterface
    fun printText(text: String?): String = safeJson {
        val content = text ?: ""
        if (content.isBlank()) throw IllegalArgumentException("Print text is empty")

        val p = ensurePrinter()
        val initStatus = p.PrintInit()
        if (initStatus != 0) throw IllegalStateException("PrintInit failed: $initStatus")

        p.PrintSetAlign(0)
        p.PrintSetFont(24.toByte(), 20.toByte(), 0.toByte())

        val normalized = content.replace("\r\n", "\n").replace("\r", "\n")
        val lines = normalized.split("\n")
        for (line in lines) {
            val status = p.PrintStr(line + "\n")
            if (status != 0) throw IllegalStateException("PrintStr failed: $status")
        }
        p.PrintStr("\n\n\n")

        val startStatus = p.PrintStart()
        if (startStatus != 0) throw IllegalStateException("PrintStart failed: $startStatus")

        try {
            p.PrintClose()
        } catch (t: Throwable) {
            Log.w(TAG, "PrintClose warning: ${t.message}")
        }

        Log.d(TAG, "Print started successfully")
        JSONObject()
            .put("success", true)
            .put("bridge", true)
    }

    private fun canInitialize(): Boolean = try {
        ensurePrinter()
        true
    } catch (t: Throwable) {
        Log.w(TAG, "Availability probe failed: ${t.message}")
        false
    }

    private fun ensurePrinter(): PosApiHelper {
        val existing = printer
        if (existing != null) return existing
        val created = PosApiHelper.getInstance()
            ?: throw IllegalStateException("POS printer SDK unavailable: $NOT_INIT")
        printer = created
        return created
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