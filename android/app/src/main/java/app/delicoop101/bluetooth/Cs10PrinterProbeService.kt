package app.delicoop101.bluetooth

import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.Process
import android.util.Log
import org.json.JSONObject
import java.io.File

/**
 * v2.11.26: Isolated Ciontek POS service discovery probe.
 *
 * Previous versions (v2.11.25) loaded the wrong `vpos.apipackage` JNI SDK in
 * this process, which SIGSEGV'd on CS10 A26 firmware. The active plan drops
 * that path entirely — the correct integration is an AIDL bind to the
 * `com.ciontek.posmanagerprovider` system service that owns the built-in
 * thermal head.
 *
 * This service now delegates to {@link CiontekServiceProbe}. It stays in
 * the ":posprobe" child process so that if the vendor service happens to
 * load misbehaving native code in-process during bind, only this child
 * dies — the main app keeps running.
 */
class Cs10PrinterProbeService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val resultFile = File(filesDir, RESULT_FILE)
        val stageFile = File(filesDir, STAGE_FILE)
        try {
            writeText(stageFile, "ciontek-service-probe")
            val report = CiontekServiceProbe.run(applicationContext)
            writeJson(resultFile, report)
        } catch (t: Throwable) {
            writeJson(resultFile, JSONObject()
                .put("ok", false)
                .put("stage", safeRead(stageFile) ?: "unknown")
                .put("exception", t.javaClass.name)
                .put("message", t.message ?: "")
            )
        }
        stopSelf()
        Process.killProcess(Process.myPid())
        return START_NOT_STICKY
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

    companion object {
        const val TAG = "CS10-PROBE"
        const val RESULT_FILE = "cs10_probe_result.json"
        const val STAGE_FILE = "cs10_probe_stage.txt"
    }
}
