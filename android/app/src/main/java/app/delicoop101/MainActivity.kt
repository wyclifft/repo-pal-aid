package app.delicoop101

import android.os.Bundle
import android.util.Log
import com.getcapacitor.BridgeActivity
import app.delicoop101.bluetooth.BluetoothClassicPlugin
import app.delicoop101.storage.OfflineStoragePlugin
import app.delicoop101.database.DelicoopDatabase
import app.delicoop101.database.DatabaseLogger

class MainActivity : BridgeActivity() {
    
    companion object {
        private const val TAG = "MainActivity"
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register custom plugins before super.onCreate()
        registerPlugin(BluetoothClassicPlugin::class.java)
        registerPlugin(OfflineStoragePlugin::class.java)
        
        super.onCreate(savedInstanceState)
        
        // Initialize database immediately on app launch (async, non-blocking)
        initializeDatabase()
    }
    
    /**
     * Initialize the database and logger on app startup.
     * This ensures the database files exist before any transactions.
     * Runs on a background thread to avoid blocking the UI.
     */
    private fun initializeDatabase() {
        Log.d(TAG, "[APP] Initializing database on startup...")
        
        // Initialize the database asynchronously
        DelicoopDatabase.initializeAsync(applicationContext) { success ->
            if (success) {
                Log.d(TAG, "[APP] Database initialized successfully")
                
                // Initialize the async logger after database is ready
                DatabaseLogger.initialize(applicationContext)
                
                // Log app startup
                DatabaseLogger.i(TAG, "DeliCoop101 app started")
            } else {
                Log.e(TAG, "[APP] Failed to initialize database")
            }
        }
    }
    
    override fun onDestroy() {
        super.onDestroy()
        
        // Shutdown logger to flush pending logs
        DatabaseLogger.shutdown()
        
        Log.d(TAG, "[APP] MainActivity destroyed")
    }
}
