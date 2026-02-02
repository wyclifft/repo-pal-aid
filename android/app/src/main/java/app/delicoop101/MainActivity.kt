package app.delicoop101

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import app.delicoop101.bluetooth.BluetoothClassicPlugin
import app.delicoop101.storage.OfflineStoragePlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register custom plugins before super.onCreate()
        registerPlugin(BluetoothClassicPlugin::class.java)
        registerPlugin(OfflineStoragePlugin::class.java)
        
        super.onCreate(savedInstanceState)
    }
}
