package app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.storage

import android.util.Log
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.database.SyncRepository
import app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.sync.SyncWorker
import com.google.gson.Gson
import kotlinx.coroutines.*

/**
 * Capacitor plugin to expose Room database operations to the web layer.
 * Provides offline-first storage with automatic background sync.
 */
@CapacitorPlugin(name = "OfflineStorage")
class OfflineStoragePlugin : Plugin() {
    
    companion object {
        private const val TAG = "OfflineStoragePlugin"
    }
    
    private lateinit var repository: SyncRepository
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val gson = Gson()
    
    override fun load() {
        super.load()
        repository = SyncRepository.getInstance(context)
        SyncWorker.schedulePeriodicSync(context)
        Log.d(TAG, "[STORAGE] Plugin loaded, sync scheduled")
    }
    
    @PluginMethod
    fun saveRecord(call: PluginCall) {
        val referenceNo = call.getString("referenceNo") ?: return call.reject("Missing referenceNo")
        val recordType = call.getString("recordType") ?: return call.reject("Missing recordType")
        val payload = call.getObject("payload")?.toString() ?: return call.reject("Missing payload")
        val userId = call.getString("userId")
        val deviceFingerprint = call.getString("deviceFingerprint")
        
        scope.launch {
            try {
                val id = repository.saveRecord(referenceNo, recordType, payload, userId, deviceFingerprint)
                call.resolve(JSObject().put("id", id).put("success", true))
            } catch (e: Exception) {
                call.reject("Save failed: ${e.message}")
            }
        }
    }
    
    @PluginMethod
    fun getUnsyncedRecords(call: PluginCall) {
        val type = call.getString("type")
        
        scope.launch {
            try {
                val records = if (type != null) {
                    repository.getUnsyncedRecordsByType(type)
                } else {
                    repository.getUnsyncedRecords()
                }
                val jsonArray = gson.toJson(records)
                call.resolve(JSObject().put("records", jsonArray))
            } catch (e: Exception) {
                call.reject("Query failed: ${e.message}")
            }
        }
    }
    
    @PluginMethod
    fun getUnsyncedCount(call: PluginCall) {
        scope.launch {
            try {
                val count = repository.getUnsyncedCount()
                call.resolve(JSObject().put("count", count))
            } catch (e: Exception) {
                call.reject("Count failed: ${e.message}")
            }
        }
    }
    
    @PluginMethod
    fun markAsSynced(call: PluginCall) {
        val id = call.getLong("id")
        val referenceNo = call.getString("referenceNo")
        val backendId = call.getLong("backendId")
        
        scope.launch {
            try {
                when {
                    id != null -> repository.markAsSynced(id, backendId)
                    referenceNo != null -> repository.markAsSyncedByRef(referenceNo, backendId)
                    else -> return@launch call.reject("Missing id or referenceNo")
                }
                call.resolve(JSObject().put("success", true))
            } catch (e: Exception) {
                call.reject("Mark synced failed: ${e.message}")
            }
        }
    }
    
    @PluginMethod
    fun triggerSync(call: PluginCall) {
        SyncWorker.triggerImmediateSync(context)
        call.resolve(JSObject().put("triggered", true))
    }
    
    @PluginMethod
    fun getStats(call: PluginCall) {
        scope.launch {
            try {
                val stats = repository.getStats()
                call.resolve(JSObject()
                    .put("total", stats.totalRecords)
                    .put("synced", stats.syncedRecords)
                    .put("unsynced", stats.unsyncedRecords))
            } catch (e: Exception) {
                call.reject("Stats failed: ${e.message}")
            }
        }
    }
    
    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }
}
