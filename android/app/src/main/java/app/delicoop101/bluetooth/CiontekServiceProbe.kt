package app.delicoop101.bluetooth

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.IBinder
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * v2.11.26: Discovery probe for the Ciontek PosManagerProvider system app
 * that ships in `/system/priv-app/PosManagerProvider/` on CS10 A26 firmware.
 *
 * Runs INSIDE the isolated `:posprobe` process (see Cs10PrinterProbeService)
 * so any misbehaving native code the vendor service loads in-process during
 * binding cannot take down the main app.
 *
 * The probe does NOT touch the (wrong) bundled `vpos.apipackage` JNI SDK.
 * It only asks the OS: is `com.ciontek.posmanagerprovider` installed, what
 * services does it export, and can we bind to any of the known Ciontek AIDL
 * interface names?
 */
object CiontekServiceProbe {

    private const val TAG = "CS10-PROBE"
    private const val PROVIDER_PKG = "com.ciontek.posmanagerprovider"
    private const val BIND_TIMEOUT_MS = 3000L

    /** Well-known Ciontek AIDL interface names, tried in priority order. */
    private val KNOWN_INTERFACES = listOf(
        "com.ciontek.ciontekposservice.ICiontekPosService",
        "com.ciontek.sdk.IPosService",
        "com.ctk.sdk.IPosService",
        "com.pos.device.IPosService"
    )

    fun run(context: Context): JSONObject {
        val result = JSONObject()
        result.put("provider", inspectProvider(context))

        val bindReport = JSONArray()
        var bound = false
        var boundInterface: String? = null
        for (iface in KNOWN_INTERFACES) {
            val r = tryBind(context, iface)
            bindReport.put(r)
            if (!bound && r.optString("result") == "success") {
                bound = true
                boundInterface = iface
            }
        }
        result.put("bindAttempts", bindReport)
        result.put("ok", bound)
        result.put("stage", if (bound) "bind" else "bind-all-failed")
        if (bound) {
            result.put("boundInterface", boundInterface)
            result.put("message", "Bound to $boundInterface")
        } else {
            result.put("message", "Could not bind to any known Ciontek interface")
        }
        return result
    }

    private fun inspectProvider(context: Context): JSONObject {
        val out = JSONObject().put("package", PROVIDER_PKG)
        val pm = context.packageManager
        try {
            val pi = pm.getPackageInfo(
                PROVIDER_PKG,
                PackageManager.GET_SERVICES or PackageManager.GET_META_DATA
            )
            out.put("installed", true)
            out.put("versionName", pi.versionName ?: "")
            @Suppress("DEPRECATION")
            out.put("versionCode", pi.versionCode)
            val services = JSONArray()
            pi.services?.forEach { s ->
                val obj = JSONObject()
                    .put("name", s.name ?: "")
                    .put("exported", s.exported)
                    .put("permission", s.permission ?: "")
                    .put("processName", s.processName ?: "")
                services.put(obj)
            }
            out.put("services", services)
        } catch (t: Throwable) {
            out.put("installed", false)
            out.put("exception", t.javaClass.name)
            out.put("message", t.message ?: "")
        }
        return out
    }

    private fun tryBind(context: Context, action: String): JSONObject {
        val report = JSONObject().put("interface", action)
        val latch = CountDownLatch(1)
        var descriptor: String? = null
        var connectException: String? = null
        val conn = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                try {
                    descriptor = service?.interfaceDescriptor ?: ""
                } catch (t: Throwable) {
                    connectException = "${t.javaClass.name}: ${t.message}"
                }
                latch.countDown()
            }
            override fun onServiceDisconnected(name: ComponentName?) {}
        }
        val intent = Intent(action).setPackage(PROVIDER_PKG)
        val started: Boolean = try {
            context.bindService(intent, conn, Context.BIND_AUTO_CREATE)
        } catch (t: SecurityException) {
            report.put("result", "security")
            report.put("exception", t.javaClass.name)
            report.put("message", t.message ?: "")
            return report
        } catch (t: Throwable) {
            report.put("result", "error")
            report.put("exception", t.javaClass.name)
            report.put("message", t.message ?: "")
            return report
        }
        if (!started) {
            try { context.unbindService(conn) } catch (_: Throwable) {}
            report.put("result", "not-found")
            report.put("message", "bindService returned false (no matching service exported)")
            return report
        }
        val ok = try { latch.await(BIND_TIMEOUT_MS, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { false }
        try { context.unbindService(conn) } catch (_: Throwable) {}
        if (!ok) {
            report.put("result", "timeout")
            report.put("message", "onServiceConnected did not fire within ${BIND_TIMEOUT_MS}ms")
            return report
        }
        report.put("result", "success")
        report.put("descriptor", descriptor ?: "")
        connectException?.let { report.put("descriptorError", it) }
        Log.d(TAG, "bind success interface=$action descriptor=$descriptor")
        return report
    }
}
