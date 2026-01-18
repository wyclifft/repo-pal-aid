package app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.bluetooth.BluetoothClassicPlugin
import app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.storage.OfflineStoragePlugin
import app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.sync.SyncWorker

/**
 * Main Activity for the Capacitor application
 * Registers custom plugins for Bluetooth and Offline Storage
 */
class MainActivity : BridgeActivity() {
    
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register custom plugins before calling super.onCreate
        registerPlugin(BluetoothClassicPlugin::class.java)
        registerPlugin(OfflineStoragePlugin::class.java)
        
        super.onCreate(savedInstanceState)
        
        // Schedule background sync on app start
        SyncWorker.schedulePeriodicSync(this)
    }
}
