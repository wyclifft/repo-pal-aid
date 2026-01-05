package app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.bluetooth.BluetoothClassicPlugin

/**
 * Main Activity for the Capacitor application
 * Registers the custom BluetoothClassic plugin for Classic Bluetooth SPP support
 */
class MainActivity : BridgeActivity() {
    
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register custom plugins before calling super.onCreate
        registerPlugin(BluetoothClassicPlugin::class.java)
        
        super.onCreate(savedInstanceState)
    }
}
