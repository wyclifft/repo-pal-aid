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
        DatabaseLogger.flush()
        super.onDestroy()
    }
}
