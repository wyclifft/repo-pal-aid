package app.delicoop101.bluetooth

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.Process
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * v2.11.25: Isolated CS10 POS SDK initialization probe.
 *
 * Runs in the ":posprobe" child process (see AndroidManifest.xml). Attempts
 * every stage of the native SDK initialization sequence. Each stage writes a
 * JSON result file to internal storage BEFORE it runs the risky call, so that
 * if libPosApi.so crashes the JVM with SIGSEGV the main process can still tell
 * exactly which stage killed it. On success the final JSON is written and the
 * probe process exits cleanly. The main app never links against PosApiHelper
 * directly — it only reads the file this service produces.
 *
 * IMPORTANT: never call anything that touches vpos/apipackage classes from the
 * main process before this probe has returned success.
 */
class Cs10PrinterProbeService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val resultFile = File(filesDir, RESULT_FILE)
        val stageFile = File(filesDir, STAGE_FILE)
        try {
            runProbe(resultFile, stageFile)
        } catch (t: Throwable) {
            // Any pure-Java failure: record and continue exiting cleanly.
            writeJson(resultFile, JSONObject()
                .put("ok", false)
                .put("stage", safeRead(stageFile) ?: "unknown")
                .put("exception", t.javaClass.name)
                .put("message", t.message ?: "")
            )
        }
        // Terminate the isolated process so the next probe starts fresh.
        stopSelf()
        Process.killProcess(Process.myPid())
        return START_NOT_STICKY
    }

    private fun runProbe(resultFile: File, stageFile: File) {
        // Stage 1: load native library
        writeText(stageFile, "loadLibrary")
        try {
            System.loadLibrary("PosApi")
        } catch (t: UnsatisfiedLinkError) {
            writeJson(resultFile, JSONObject()
                .put("ok", false)
                .put("stage", "loadLibrary")
                .put("exception", t.javaClass.name)
                .put("message", t.message ?: "")
                .put("missingLibrary", extractMissingLibrary(t.message))
            )
            return
        }

        // Stage 2: class-load PosApiHelper (fires <clinit>, may native-crash)
        writeText(stageFile, "classForName")
        val cls = Class.forName("vpos.apipackage.PosApiHelper")

        // Stage 3: getInstance
        writeText(stageFile, "getInstance")
        val instance = cls.getMethod("getInstance").invoke(null)
            ?: run {
                writeJson(resultFile, JSONObject()
                    .put("ok", false)
                    .put("stage", "getInstance")
                    .put("message", "PosApiHelper.getInstance() returned null")
                )
                return
            }

        // Stage 4: PrintInit
        writeText(stageFile, "printInit")
        val initStatus = cls.getMethod("PrintInit").invoke(instance) as? Int ?: -1

        // Stage 5: PrintCheckStatus
        writeText(stageFile, "printCheckStatus")
        val checkStatus = cls.getMethod("PrintCheckStatus").invoke(instance) as? Int ?: -1

        writeJson(resultFile, JSONObject()
            .put("ok", initStatus == 0)
            .put("stage", "printCheckStatus")
            .put("initStatus", initStatus)
            .put("checkStatus", checkStatus)
            .put("message", if (initStatus == 0) "ok" else "PrintInit returned $initStatus")
        )
    }

    private fun writeJson(file: File, obj: JSONObject) {
        try {
            file.writeText(obj.toString())
            Log.d(TAG, "probe result: $obj")
        } catch (t: Throwable) {
            Log.e(TAG, "failed to write probe result: ${t.message}", t)
        }
    }

    private fun writeText(file: File, text: String) {
        try { file.writeText(text) } catch (_: Throwable) {}
    }

    private fun safeRead(file: File): String? = try {
        if (file.exists()) file.readText() else null
    } catch (_: Throwable) { null }

    private fun extractMissingLibrary(msg: String?): String {
        if (msg.isNullOrEmpty()) return ""
        // Typical: dlopen failed: library "libcustom_jni.so" not found
        val m = Regex("""library "([^"]+)" not found""").find(msg)
        if (m != null) return m.groupValues[1]
        val m2 = Regex("""cannot locate symbol "([^"]+)"""").find(msg)
        if (m2 != null) return m2.groupValues[1]
        return ""
    }

    companion object {
        const val TAG = "CS10-PROBE"
        const val RESULT_FILE = "cs10_probe_result.json"
        const val STAGE_FILE = "cs10_probe_stage.txt"
    }
}
