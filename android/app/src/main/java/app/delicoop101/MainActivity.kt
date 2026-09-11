package app.delicoop101

import android.os.Bundle
import android.util.Log
import android.webkit.WebView
import com.getcapacitor.BridgeActivity
import com.getcapacitor.WebViewListener
import app.delicoop101.bluetooth.BluetoothClassicPlugin
import app.delicoop101.bluetooth.BluetoothClassicJsBridge
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
    
    override fun onCreate(savedInstanceState: Bundle?) {
        disableChromiumMultiProcess()

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
        // v2.11.27: Cs10PrinterAndroid JS bridge retired. Internal printing now
        // flows through the PosApi Capacitor plugin registered above.
    }

    private fun disableChromiumMultiProcess() {
        // Force Chromium WebView to run in single-process mode on legacy Android 7 (Nougat) ROMs
        // where SandboxedProcessService0 lacks android:externalService="true", preventing
        // BIND_EXTERNAL_SERVICE SecurityExceptions and SIGABRT crashes in ChildProcessLauncher.
        val webViewPackages = listOf("com.android.webview", "com.google.android.webview", "com.android.chrome")
        val possibleCommandLineClasses = listOf(
            "org.chromium.base.CommandLine",
            "com.android.webview.chromium.CommandLine"
        )

        try {
            val classLoaders = mutableListOf<ClassLoader>()

            // Strategy 1: Create PackageContext for WebView package to obtain its ClassLoader BEFORE WebView init
            for (pkg in webViewPackages) {
                try {
                    val pkgContext = createPackageContext(pkg, android.content.Context.CONTEXT_INCLUDE_CODE or android.content.Context.CONTEXT_IGNORE_SECURITY)
                    val cl = pkgContext?.classLoader
                    if (cl is ClassLoader) {
                        classLoaders.add(cl)
                        Log.i(TAG, "[INIT] Obtained ClassLoader for package $pkg")
                    }
                } catch (e: Throwable) {
                    // ignore if package not found
                }
            }

            // Strategy 2: Reflect on WebViewFactory / WebViewFactoryProvider
            try {
                val webViewFactoryClass = Class.forName("android.webkit.WebViewFactory")
                val getProviderMethod = webViewFactoryClass.getDeclaredMethod("getProvider")
                getProviderMethod.isAccessible = true
                val provider = getProviderMethod.invoke(null)
                if (provider != null) {
                    val cl: Any? = provider.javaClass.classLoader
                    if (cl is ClassLoader) {
                        classLoaders.add(cl)
                        Log.i(TAG, "[INIT] Obtained ClassLoader from WebViewFactory.getProvider(): $cl")
                    }
                }
            } catch (e: Throwable) {
                Log.w(TAG, "[INIT] Could not invoke WebViewFactory.getProvider(): ${e.message}")
            }

            classLoaders.add(MainActivity::class.java.classLoader)
            classLoaders.add(ClassLoader.getSystemClassLoader())

            var configured = false
            for (cl in classLoaders) {
                for (className in possibleCommandLineClasses) {
                    try {
                        val commandLineClass = Class.forName(className, true, cl)
                        Log.i(TAG, "[INIT] Found $className in ClassLoader $cl")

                        val isInitializedMethod = commandLineClass.getMethod("isInitialized")
                        val isInit = isInitializedMethod.invoke(null) as Boolean

                        if (!isInit) {
                            val initMethod = commandLineClass.getMethod("init", Array<String>::class.java)
                            initMethod.invoke(null, arrayOf("placeholder", "--single-process", "--no-sandbox"))
                            Log.i(TAG, "[INIT] Initialized $className with --single-process --no-sandbox")
                        } else {
                            val getInstanceMethod = commandLineClass.getMethod("getInstance")
                            val commandLineObj = getInstanceMethod.invoke(null)
                            val appendSwitchMethod = commandLineClass.getMethod("appendSwitch", String::class.java)
                            appendSwitchMethod.invoke(commandLineObj, "single-process")
                            appendSwitchMethod.invoke(commandLineObj, "no-sandbox")
                            Log.i(TAG, "[INIT] Appended --single-process --no-sandbox to existing $className")
                        }
                        configured = true
                        break
                    } catch (e: ClassNotFoundException) {
                        // try next class
                    } catch (e: Throwable) {
                        Log.e(TAG, "[INIT] Error applying switches to $className", e)
                    }
                }
                if (configured) break
            }

            if (!configured) {
                Log.w(TAG, "[INIT] Could not find CommandLine class in any loaded ClassLoader")
            }
        } catch (e: Throwable) {
            Log.e(TAG, "[INIT] Failed to configure Chromium single-process mode", e)
        }
    }
}

