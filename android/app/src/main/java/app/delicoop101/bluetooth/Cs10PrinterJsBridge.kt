package app.delicoop101.bluetooth

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * v2.11.26: CS10 internal printer JS bridge.
 *
 * Retires the wrong `vpos.apipackage` JNI path. The real integration on
 * this CS10 A26 firmware is an AIDL bind to `com.ciontek.posmanagerprovider`.
 * See:
 *   - Cs10PrinterProbeService (runs discovery in the isolated :posprobe process)
 *   - CiontekServiceProbe     (queries PackageManager + attempts binds)
 *   - CiontekPrinterBridge    (real printer bridge in-process)
 *
 * The JS-facing method surface (`isAvailable`, `status`, `printText`,
 * `retryProbe`) is unchanged so PrinterConnectionDialog.tsx needs no edit.
 * All returned JSON now includes a `provider` block with PosManagerProvider
 * details and per-interface bind attempts, so /debug shows exactly why
 * printing did/did-not work.
 */
class Cs10PrinterJsBridge(private val context: Context) {

    companion object {
        private const val TAG = "CS10-PRINTER"
        private const val PROBE_TIMEOUT_MS = 6000L
        private const val PROBE_POLL_MS = 100L
    }

    @Volatile private var cachedProbe: JSONObject? = null
    private val printer: CiontekPrinterBridge by lazy { CiontekPrinterBridge(context) }

    @JavascriptInterface
    fun isAvailable(): String = safeJson {
        val probe = ensureProbe()
        buildBase(probe)
    }

    @JavascriptInterface
    fun status(): String = safeJson {
        val probe = ensureProbe()
        val base = buildBase(probe)
        if (!probe.optBoolean("ok")) return@safeJson base
        val out = printer.checkStatus()
        base.put("stage", out.stage)
             .put("message", out.message)
             .put("ready", out.ok)
        out.extra.forEach { (k, v) -> base.put(k, v ?: JSONObject.NULL) }
        base
    }

    @JavascriptInterface
    fun printText(text: String?): String = safeJson {
        val probe = ensureProbe()
        val base = buildBase(probe)
        val content = text ?: ""
        if (content.isBlank()) throw IllegalArgumentException("Print text is empty")
        if (!probe.optBoolean("ok")) {
            base.put("error", "ciontek-bind-failed")
            return@safeJson base
        }
        val out = printer.printText(content)
        base.put("stage", out.stage)
            .put("message", out.message)
            .put("success", out.ok)
        if (!out.ok) base.put("error", out.message)
        out.extra.forEach { (k, v) -> base.put(k, v ?: JSONObject.NULL) }
        base
    }

    @JavascriptInterface
    fun retryProbe(): String = safeJson {
        cachedProbe = null
        printer.reset()
        JSONObject().put("cleared", true)
    }

    // ------------------------------------------------------------------------

    private fun buildBase(probe: JSONObject): JSONObject {
        val ok = probe.optBoolean("ok")
        val base = JSONObject()
            .put("available", ok)
            .put("stage", probe.optString("stage", "unknown"))
            .put("message", probe.optString("message", ""))
            .put("boundInterface", probe.opt("boundInterface") ?: JSONObject.NULL)
            .put("provider", probe.opt("provider") ?: JSONObject.NULL)
            .put("bindAttempts", probe.opt("bindAttempts") ?: JSONArray())
            .put("model", Build.MODEL ?: "")
            .put("manufacturer", Build.MANUFACTURER ?: "")
            .put("device", Build.DEVICE ?: "")
            .put("fingerprint", Build.FINGERPRINT ?: "")
            .put("sdk", Build.VERSION.SDK_INT)
            .put("bridge", true)
        if (!ok) base.put("logcatTail", tailLogcat())
        return base
    }

    @Synchronized
    private fun ensureProbe(): JSONObject {
        cachedProbe?.let { return it }
        val result = runProbe()
        cachedProbe = result
        return result
    }

    private fun runProbe(): JSONObject {
        val resultFile = File(context.filesDir, Cs10PrinterProbeService.RESULT_FILE)
        val stageFile = File(context.filesDir, Cs10PrinterProbeService.STAGE_FILE)
        try { resultFile.delete() } catch (_: Throwable) {}
        try { stageFile.delete() } catch (_: Throwable) {}

        Log.d(TAG, "Starting Ciontek service discovery probe in :posprobe")
        try {
            val intent = Intent(context, Cs10PrinterProbeService::class.java)
            context.startService(intent)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to start probe service: ${t.message}", t)
            return JSONObject()
                .put("ok", false)
                .put("stage", "startProbeService")
                .put("exception", t.javaClass.name)
                .put("message", t.message ?: "")
        }

        val deadline = System.currentTimeMillis() + PROBE_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            if (resultFile.exists() && resultFile.length() > 0) {
                return try {
                    JSONObject(resultFile.readText())
                } catch (t: Throwable) {
                    JSONObject()
                        .put("ok", false)
                        .put("stage", "parseProbeResult")
                        .put("message", t.message ?: "")
                }
            }
            try { Thread.sleep(PROBE_POLL_MS) } catch (_: InterruptedException) {}
        }

        val lastStage = try { if (stageFile.exists()) stageFile.readText() else "unknown" } catch (_: Throwable) { "unknown" }
        Log.w(TAG, "Probe did not return in ${PROBE_TIMEOUT_MS}ms; last stage=$lastStage")
        return JSONObject()
            .put("ok", false)
            .put("stage", lastStage)
            .put("exception", "ProbeTimeoutOrCrash")
            .put("message", "Probe process exited before completing '$lastStage'")
    }

    private fun tailLogcat(): String {
        return try {
            val p = Runtime.getRuntime().exec(arrayOf("logcat", "-d", "-t", "120"))
            val out = p.inputStream.bufferedReader().readText()
            val keep = out.lineSequence().filter {
                it.contains("ciontek", ignoreCase = true) ||
                it.contains("PosManagerProvider", ignoreCase = true) ||
                it.contains("PosApiHelper") ||
                it.contains("CS10-PROBE") || it.contains("CS10-PRINTER") ||
                it.contains("SIGSEGV") || it.contains("DEBUG")
            }.toList()
            keep.takeLast(40).joinToString("\n")
        } catch (t: Throwable) {
            "logcat unavailable: ${t.message}"
        }
    }

    private fun safeJson(block: () -> JSONObject): String = try {
        block().toString()
    } catch (t: Throwable) {
        Log.e(TAG, "Bridge call failed: ${t.message}", t)
        JSONObject()
            .put("available", false)
            .put("error", t.message ?: t.javaClass.simpleName)
            .put("exception", t.javaClass.name)
            .put("stage", "bridge")
            .put("bridge", true)
            .toString()
    }
}
