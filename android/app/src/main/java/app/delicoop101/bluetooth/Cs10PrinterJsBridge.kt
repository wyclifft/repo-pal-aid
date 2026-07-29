package app.delicoop101.bluetooth

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.io.File

/**
 * v2.11.25: CS10 internal printer JS bridge — REAL initialization, no permanent gate.
 *
 * Previous versions (v2.11.23/24) probed for /vendor/lib*/libcustom_jni.so and
 * IBCRService$Stub and refused to touch the SDK if either was missing. Field
 * evidence shows other software prints successfully on the CS10 A26 firmware,
 * so a hard gate is wrong.
 *
 * The new design:
 *   1. Never load PosApiHelper in the main process before we've verified it.
 *   2. Run an isolated init probe in ":posprobe" (Cs10PrinterProbeService). If
 *      libPosApi.so SIGSEGVs, only that child process dies — the main app stays
 *      up and we still get the JSON diagnostic (stage/exception/missing lib).
 *   3. If the probe succeeds, load the SDK in-process on demand and cache it.
 *   4. On failure return a rich diagnostic to the WebView (stage, missing
 *      library, exception message, logcat tail) so the user sees the real
 *      reason instead of "not supported".
 *
 * Caller may retry: {@link #retryProbe()} clears the cached result.
 */
class Cs10PrinterJsBridge(private val context: Context) {

    companion object {
        private const val TAG = "CS10-PRINTER"
        private const val PROBE_TIMEOUT_MS = 6000L
        private const val PROBE_POLL_MS = 100L
    }

    @Volatile private var cachedProbe: JSONObject? = null
    @Volatile private var helper: Any? = null

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
        val h = getHelperOrLoad()
        val checkStatus = try {
            h.javaClass.getMethod("PrintCheckStatus").invoke(h) as? Int ?: -1
        } catch (t: Throwable) {
            base.put("stage", "printCheckStatus")
                .put("exception", t.javaClass.name)
                .put("message", t.message ?: "")
            return@safeJson base.put("ready", false)
        }
        base.put("ready", checkStatus == 0).put("checkStatus", checkStatus)
    }

    @JavascriptInterface
    fun printText(text: String?): String = safeJson {
        val probe = ensureProbe()
        val base = buildBase(probe)
        if (!probe.optBoolean("ok")) {
            base.put("error", "cs10-sdk-init-failed")
            return@safeJson base
        }
        val content = text ?: ""
        if (content.isBlank()) throw IllegalArgumentException("Print text is empty")

        val h = getHelperOrLoad()
        val cls = h.javaClass

        val initStatus = cls.getMethod("PrintInit").invoke(h) as? Int ?: -1
        if (initStatus != 0) {
            base.put("stage", "printInit").put("initStatus", initStatus)
            base.put("error", "PrintInit failed: $initStatus")
            return@safeJson base
        }

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
            val s = printStr.invoke(h, line + "\n") as? Int ?: -1
            if (s != 0) {
                base.put("stage", "printStr").put("error", "PrintStr failed: $s")
                return@safeJson base
            }
        }
        printStr.invoke(h, "\n\n\n")

        val startStatus = cls.getMethod("PrintStart").invoke(h) as? Int ?: -1
        if (startStatus != 0) {
            base.put("stage", "printStart").put("error", "PrintStart failed: $startStatus")
            return@safeJson base
        }
        try { cls.getMethod("PrintClose").invoke(h) } catch (t: Throwable) {
            Log.w(TAG, "PrintClose warning: ${t.message}")
        }
        base.put("success", true)
    }

    /**
     * Clear cached probe result and helper so the next isAvailable/print call
     * re-runs the isolated probe. Exposed to JS for a manual "retry" button.
     */
    @JavascriptInterface
    fun retryProbe(): String = safeJson {
        cachedProbe = null
        helper = null
        JSONObject().put("cleared", true)
    }

    // ------------------------------------------------------------------------

    private fun buildBase(probe: JSONObject): JSONObject {
        val ok = probe.optBoolean("ok")
        val base = JSONObject()
            .put("available", ok)
            .put("stage", probe.optString("stage", "unknown"))
            .put("exception", probe.optString("exception", ""))
            .put("message", probe.optString("message", ""))
            .put("missingLibrary", probe.optString("missingLibrary", ""))
            .put("initStatus", probe.opt("initStatus") ?: JSONObject.NULL)
            .put("checkStatus", probe.opt("checkStatus") ?: JSONObject.NULL)
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

        Log.d(TAG, "Starting isolated init probe in :posprobe process")
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

        // Timeout OR probe process died before writing result.
        val lastStage = try { if (stageFile.exists()) stageFile.readText() else "unknown" } catch (_: Throwable) { "unknown" }
        Log.w(TAG, "Probe did not return in ${PROBE_TIMEOUT_MS}ms; last stage=$lastStage")
        return JSONObject()
            .put("ok", false)
            .put("stage", lastStage)
            .put("exception", "NativeCrashOrTimeout")
            .put("message", "Probe process exited before completing '$lastStage' (likely SIGSEGV in libPosApi.so or dependent .so)")
    }

    @Synchronized
    private fun getHelperOrLoad(): Any {
        helper?.let { return it }
        val cls = Class.forName("vpos.apipackage.PosApiHelper")
        val instance = cls.getMethod("getInstance").invoke(null)
            ?: throw IllegalStateException("PosApiHelper.getInstance() returned null")
        helper = instance
        return instance
    }

    private fun tailLogcat(): String {
        return try {
            val p = Runtime.getRuntime().exec(arrayOf("logcat", "-d", "-t", "120"))
            val out = p.inputStream.bufferedReader().readText()
            val keep = out.lineSequence().filter {
                it.contains("libPosApi") || it.contains("PosApiHelper") ||
                it.contains("DEBUG") || it.contains("SIGSEGV") ||
                it.contains("CS10-PROBE") || it.contains("CS10-PRINTER") ||
                it.contains("dlopen") || it.contains("UnsatisfiedLinkError")
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
