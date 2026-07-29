package app.delicoop101

import android.os.Bundle
import android.util.Log
import android.webkit.WebView
import com.getcapacitor.BridgeActivity
import com.getcapacitor.WebViewListener
import app.delicoop101.bluetooth.BluetoothClassicPlugin
import app.delicoop101.bluetooth.BluetoothClassicJsBridge
import app.delicoop101.bluetooth.Cs10PrinterJsBridge
import app.delicoop101.storage.OfflineStoragePlugin


import app.delicoop101.sync.SyncWorker
import app.delicoop101.database.DelicoopDatabase
import app.delicoop101.database.DatabaseLogger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Main Activity for the DeliCoop101 Capacitor application
 * Registers custom plugins for Bluetooth and Offline Storage
 * Initializes encrypted database and async logger on startup
 */
class MainActivity : BridgeActivity() {
    
    companion object {
        private const val TAG = "MainActivity"
    }
    
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var bluetoothClassicJsBridge: BluetoothClassicJsBridge? = null
    private var cs10PrinterJsBridge: Cs10PrinterJsBridge? = null
    
    override fun onCreate(savedInstanceState: Bundle?) {
        // v2.11.22: Install direct JS bridges as early as Capacitor exposes the
        // WebView. WebView 51 can execute app JS before post-super setup wins
        // the race, which left BluetoothClassicAndroid missing at first call.
        bridgeBuilder.addWebViewListener(object : WebViewListener() {
            override fun onPageStarted(webView: WebView) {
                installDirectJsBridges(webView)
            }

            override fun onPageLoaded(webView: WebView) {
                installDirectJsBridges(webView)
            }
        })

        // Register custom plugins before calling super.onCreate
        Log.d(TAG, "[INIT] Registering native BluetoothClassic plugin")
        registerPlugin(BluetoothClassicPlugin::class.java)
        Log.d(TAG, "[INIT] Registering native OfflineStorage plugin")
        registerPlugin(OfflineStoragePlugin::class.java)
        // v2.11.21: BluetoothLe is auto-registered by Capacitor via
        // capacitor.plugins.json — a second manual registerPlugin() call
        // corrupts the bridge plugin map on WebView 51 and caused
        // BluetoothClassic to return UNIMPLEMENTED. Removed intentionally.

        super.onCreate(savedInstanceState)

        // v2.11.21: log the full plugin map that the bridge published so we
        // can verify BluetoothClassic / OfflineStorage / BluetoothLe are all
        // present at runtime on legacy WebViews. Uses reflection because the
        // Bridge#plugins map is not part of the public Capacitor API surface.
        try {
            val b: Any? = bridge
            if (b != null) {
                val field = b.javaClass.getDeclaredField("plugins")
                field.isAccessible = true
                val map = field.get(b) as? Map<*, *>
                val names = map?.keys?.joinToString(", ") ?: "none"
                Log.d(TAG, "[BRIDGE] Registered plugins: $names")
            }
        } catch (e: Throwable) {
            Log.w(TAG, "[BRIDGE] Failed to enumerate plugins: ${e.message}")
        }


        bridge?.webView?.let { webView -> installDirectJsBridges(webView) }

        
        // Initialize encrypted database on a background thread.
        // getInstance() now forces the DB file open eagerly (not lazily),
        // so the database is guaranteed ready before any DAO calls.
        appScope.launch(Dispatchers.IO) {
            try {
                Log.d(TAG, "[INIT] Starting encrypted database initialization...")
                
                // Step 1: Initialize + force-open the encrypted Room database
                val db = DelicoopDatabase.getInstance(applicationContext)
                
                // Step 2: Verify the DB is truly open by running a quick read
                val logCount = db.appLogDao().getLogCount()
                Log.d(TAG, "[INIT] Database verified open. Existing logs: $logCount")
                
                // Step 3: Initialize the async DatabaseLogger
                DatabaseLogger.initialize(applicationContext)
                Log.d(TAG, "[INIT] DatabaseLogger initialized")
                
                // Step 4: Log app startup (this will be batched and persisted)
                DatabaseLogger.log("INFO", TAG, "DeliCoop101 app started")
                
                Log.d(TAG, "[INIT] App initialization complete")
            } catch (e: Exception) {
                Log.e(TAG, "[INIT] Failed to initialize database: ${e.message}", e)
            }
        }
        
        // Schedule background sync on app start
        SyncWorker.schedulePeriodicSync(this)
    }
    
    override fun onDestroy() {
        // Flush all pending logs SYNCHRONOUSLY before process exit
        // This is now a blocking call that waits for writes to complete
        // v2.11.21: copy the mutable field into a local val to satisfy
        // Kotlin's smart-cast rules (mutable properties cannot be smart-cast).
        val jsBridge = bluetoothClassicJsBridge
        jsBridge?.shutdown()
        DatabaseLogger.flush()
        super.onDestroy()
    }

    private fun installDirectJsBridges(webView: WebView) {
        if (bluetoothClassicJsBridge == null) {
            val bridgeInstance = BluetoothClassicJsBridge(applicationContext, webView)
            bluetoothClassicJsBridge = bridgeInstance
            webView.addJavascriptInterface(bridgeInstance, "BluetoothClassicAndroid")
            Log.d(TAG, "[INIT] Registered BluetoothClassicAndroid JS fallback bridge")
        }

        if (cs10PrinterJsBridge == null) {
            val printerBridge = Cs10PrinterJsBridge()
            cs10PrinterJsBridge = printerBridge
            webView.addJavascriptInterface(printerBridge, "Cs10PrinterAndroid")
            Log.d(TAG, "[INIT] Registered Cs10PrinterAndroid JS bridge")
        }
    }
}

