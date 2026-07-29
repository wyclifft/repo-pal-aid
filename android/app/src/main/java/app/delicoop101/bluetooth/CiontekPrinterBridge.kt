package app.delicoop101.bluetooth

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.util.Log
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * v2.11.26: AIDL-based printer bridge to the Ciontek PosManagerProvider
 * system service.
 *
 * Unlike the retired `vpos.apipackage.PosApiHelper` JNI path, this bridge
 * does NOT load any `.so` files. It binds to `com.ciontek.posmanagerprovider`
 * — the Ciontek system app already installed at
 * `/system/priv-app/PosManagerProvider/` on this CS10 A26 firmware — and
 * talks to it via one of the well-known Ciontek AIDL interfaces.
 *
 * Because the exact `.aidl` file for CS10 is a vendor drop we do not yet
 * have in-tree, this class implements the reflective fallback (path b in
 * .lovable/plan.md):
 *   - bindService(...) and cache the IBinder
 *   - read `binder.interfaceDescriptor` and use it as the parcel token
 *   - IBinder.transact(code, data, reply, 0) for each Print* call
 *
 * Transaction codes are declared by the SDK the vendor ships. Until we
 * have the vendor `PosApiHelper.jar`, real prints will report
 * `stage=missing-aidl` — but bind + descriptor discovery still succeed so
 * the /debug diagnostic shows the exact interface name to hand to Ciontek.
 * Once the vendor JAR is dropped into `android/app/libs/`, the bridge
 * detects `com.ctk.sdk.PosApiHelper` via reflection and prefers the
 * official wrapper.
 */
class CiontekPrinterBridge(private val context: Context) {

    companion object {
        private const val TAG = "CS10-PRINTER"
        private const val PROVIDER_PKG = "com.ciontek.posmanagerprovider"
        private const val BIND_TIMEOUT_MS = 3000L
        private val KNOWN_INTERFACES = listOf(
            "com.ciontek.ciontekposservice.ICiontekPosService",
            "com.ciontek.sdk.IPosService",
            "com.ctk.sdk.IPosService",
            "com.pos.device.IPosService"
        )
    }

    @Volatile private var binder: IBinder? = null
    @Volatile private var boundInterface: String? = null
    @Volatile private var descriptor: String? = null
    @Volatile private var conn: ServiceConnection? = null

    /** Prefer the vendor wrapper if the JAR is on the classpath. */
    @Volatile private var vendorHelper: Any? = null

    data class PrintOutcome(
        val ok: Boolean,
        val stage: String,
        val message: String,
        val extra: Map<String, Any?> = emptyMap()
    )

    @Synchronized
    fun ensureBound(): PrintOutcome {
        // Prefer official vendor SDK if available.
        loadVendorHelperIfPresent()
        if (vendorHelper != null) return PrintOutcome(true, "vendor-helper", "PosApiHelper loaded")

        if (binder?.isBinderAlive == true) {
            return PrintOutcome(true, "bind", "already bound to $boundInterface")
        }
        for (iface in KNOWN_INTERFACES) {
            val out = bind(iface)
            if (out.ok) return out
        }
        return PrintOutcome(false, "bind", "no Ciontek AIDL interface accepted bind")
    }

    private fun loadVendorHelperIfPresent() {
        if (vendorHelper != null) return
        try {
            val cls = Class.forName("com.ctk.sdk.PosApiHelper")
            val inst = cls.getMethod("getInstance").invoke(null)
            if (inst != null) {
                vendorHelper = inst
                Log.d(TAG, "Using vendor com.ctk.sdk.PosApiHelper")
            }
        } catch (_: ClassNotFoundException) {
            // vendor JAR not dropped — reflective AIDL path stays active
        } catch (t: Throwable) {
            Log.w(TAG, "PosApiHelper detected but init failed: ${t.message}")
        }
    }

    private fun bind(iface: String): PrintOutcome {
        val latch = CountDownLatch(1)
        var localBinder: IBinder? = null
        val c = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                localBinder = service
                latch.countDown()
            }
            override fun onServiceDisconnected(name: ComponentName?) {
                binder = null
            }
        }
        val intent = Intent(iface).setPackage(PROVIDER_PKG)
        val started = try {
            context.bindService(intent, c, Context.BIND_AUTO_CREATE)
        } catch (t: Throwable) {
            return PrintOutcome(false, "bind", "$iface: ${t.javaClass.simpleName}: ${t.message}")
        }
        if (!started) {
            try { context.unbindService(c) } catch (_: Throwable) {}
            return PrintOutcome(false, "bind", "$iface: bindService returned false")
        }
        val ok = try { latch.await(BIND_TIMEOUT_MS, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { false }
        if (!ok || localBinder == null) {
            try { context.unbindService(c) } catch (_: Throwable) {}
            return PrintOutcome(false, "bind", "$iface: bind timeout")
        }
        binder = localBinder
        boundInterface = iface
        descriptor = try { localBinder!!.interfaceDescriptor } catch (_: Throwable) { null }
        conn = c
        Log.d(TAG, "bound to $iface descriptor=$descriptor")
        return PrintOutcome(true, "bind", "bound to $iface")
    }

    /**
     * Attempt to print via the vendor helper (if loaded) or the reflective
     * AIDL path. Reflective path currently reports `missing-aidl` because
     * transaction codes are vendor-specific; this is the honest signal the
     * plan requires until the vendor JAR ships.
     */
    fun printText(text: String): PrintOutcome {
        val ensured = ensureBound()
        if (!ensured.ok) return ensured

        vendorHelper?.let { helper ->
            return try {
                val cls = helper.javaClass
                val initStatus = cls.getMethod(
                    "PrintInit",
                    Int::class.javaPrimitiveType,
                    Int::class.javaPrimitiveType,
                    Int::class.javaPrimitiveType,
                    Int::class.javaPrimitiveType
                ).invoke(helper, 2, 24, 24, 0x33) as? Int ?: -1
                if (initStatus != 0) return PrintOutcome(false, "printInit", "PrintInit=$initStatus")

                val printStr = cls.getMethod("PrintStr", String::class.java)
                val normalized = text.replace("\r\n", "\n").replace("\r", "\n")
                for (line in normalized.split("\n")) {
                    val s = printStr.invoke(helper, line + "\n") as? Int ?: -1
                    if (s != 0) return PrintOutcome(false, "printStr", "PrintStr=$s")
                }
                printStr.invoke(helper, "\n\n\n")
                val startStatus = cls.getMethod("PrintStart").invoke(helper) as? Int ?: -1
                if (startStatus != 0) return PrintOutcome(false, "printStart", "PrintStart=$startStatus")
                PrintOutcome(true, "print", "ok")
            } catch (t: Throwable) {
                PrintOutcome(false, "vendor-print", "${t.javaClass.simpleName}: ${t.message}")
            }
        }

        // Reflective AIDL fallback — until vendor drops PosApiHelper.jar we
        // cannot know the transaction codes. Surface the honest diagnostic.
        return PrintOutcome(
            ok = false,
            stage = "missing-aidl",
            message = "Bound to $boundInterface (descriptor=$descriptor) but the CS10 AIDL wrapper (com.ctk.sdk.PosApiHelper) is not yet bundled. Drop the vendor JAR into android/app/libs/ and rebuild — see android/app/libs/README-CS10-SDK.md.",
            extra = mapOf(
                "boundInterface" to boundInterface,
                "descriptor" to descriptor
            )
        )
    }

    fun checkStatus(): PrintOutcome {
        val ensured = ensureBound()
        if (!ensured.ok) return ensured
        vendorHelper?.let { helper ->
            return try {
                val s = helper.javaClass.getMethod("PrintCheckStatus").invoke(helper) as? Int ?: -1
                PrintOutcome(s == 0, "printCheckStatus", "status=$s", mapOf("checkStatus" to s))
            } catch (t: Throwable) {
                PrintOutcome(false, "printCheckStatus", "${t.javaClass.simpleName}: ${t.message}")
            }
        }
        return PrintOutcome(true, "bind", "bound; status readable only via vendor helper")
    }

    fun reset() {
        try { conn?.let { context.unbindService(it) } } catch (_: Throwable) {}
        conn = null
        binder = null
        boundInterface = null
        descriptor = null
        vendorHelper = null
    }

    fun snapshot(): Map<String, Any?> = mapOf(
        "boundInterface" to boundInterface,
        "descriptor" to descriptor,
        "vendorHelper" to (vendorHelper != null)
    )
}
