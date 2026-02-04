package app.delicoop101

import android.os.Bundle
import android.util.Log
import com.getcapacitor.BridgeActivity
import app.delicoop101.bluetooth.BluetoothClassicPlugin
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
    
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register custom plugins before calling super.onCreate
        registerPlugin(BluetoothClassicPlugin::class.java)
        registerPlugin(OfflineStoragePlugin::class.java)
        
        super.onCreate(savedInstanceState)
        
        // Initialize encrypted database immediately on a background thread
        // This ensures the database is ready before any transaction occurs
        appScope.launch(Dispatchers.IO) {
            try {
                Log.d(TAG, "[INIT] Starting encrypted database initialization...")
                
                // Step 1: Initialize the encrypted Room database
                val db = DelicoopDatabase.getInstance(applicationContext)
                Log.d(TAG, "[INIT] Encrypted database initialized successfully")
                
                // Step 2: Initialize the async DatabaseLogger
                DatabaseLogger.initialize(applicationContext)
                Log.d(TAG, "[INIT] DatabaseLogger initialized")
                
                // Step 3: Log app startup
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
        super.onDestroy()
        // Flush any pending logs before app terminates
        DatabaseLogger.flush()
    }
}
