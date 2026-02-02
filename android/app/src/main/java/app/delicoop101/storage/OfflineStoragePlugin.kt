package app.delicoop101.storage

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import app.delicoop101.database.DelicoopDatabase
import app.delicoop101.database.SyncRecord
import app.delicoop101.database.SyncRepository
import kotlinx.coroutines.*

/**
 * Capacitor plugin for native offline storage with SQLCipher encryption.
 * 
 * This plugin provides:
 * - Encrypted local storage for offline transactions
 * - Background sync queue management
 * - Conflict resolution for offline-first operations
 */
@CapacitorPlugin(name = "OfflineStorage")
class OfflineStoragePlugin : Plugin() {
    
    companion object {
        private const val TAG = "OfflineStorage"
    }
    
    private lateinit var database: DelicoopDatabase
    private lateinit var repository: SyncRepository
    private val gson = Gson()
    private val pluginScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    override fun load() {
        super.load()
        Log.d(TAG, "[Storage] OfflineStoragePlugin loading...")
        
        try {
            database = DelicoopDatabase.getInstance(context)
            repository = SyncRepository(database.syncRecordDao())
            Log.d(TAG, "[Storage] OfflineStoragePlugin initialized successfully")
        } catch (e: Exception) {
            Log.e(TAG, "[Storage] Failed to initialize database", e)
        }
    }
    
    /**
     * Store a record for offline sync
     */
    @PluginMethod
    fun storeRecord(call: PluginCall) {
        val referenceNo = call.getString("referenceNo")
        val recordType = call.getString("recordType")
        val payload = call.getObject("payload")
        val userId = call.getString("userId")
        val deviceFingerprint = call.getString("deviceFingerprint")
        
        if (referenceNo.isNullOrEmpty()) {
            call.reject("Reference number is required")
            return
        }
        
        if (recordType.isNullOrEmpty()) {
            call.reject("Record type is required")
            return
        }
        
        if (payload == null) {
            call.reject("Payload is required")
            return
        }
        
        Log.d(TAG, "[Storage] Storing record: $referenceNo ($recordType)")
        
        pluginScope.launch {
            try {
                val record = SyncRecord(
                    referenceNo = referenceNo,
                    recordType = recordType,
                    payload = payload.toString(),
                    createdAt = System.currentTimeMillis(),
                    updatedAt = System.currentTimeMillis(),
                    isSynced = false,
                    userId = userId,
                    deviceFingerprint = deviceFingerprint
                )
                
                val id = repository.insertRecord(record)
                
                Log.d(TAG, "[Storage] Record stored with ID: $id")
                
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("id", id)
                    result.put("referenceNo", referenceNo)
                    call.resolve(result)
                }
                
            } catch (e: Exception) {
                Log.e(TAG, "[Storage] Failed to store record", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to store record: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Get all unsynced records
     */
    @PluginMethod
    fun getUnsyncedRecords(call: PluginCall) {
        val recordType = call.getString("recordType")
        
        Log.d(TAG, "[Storage] Getting unsynced records" + if (recordType != null) " of type: $recordType" else "")
        
        pluginScope.launch {
            try {
                val records = if (recordType != null) {
                    repository.getUnsyncedRecordsByType(recordType)
                } else {
                    repository.getUnsyncedRecords()
                }
                
                val recordsArray = JSArray()
                for (record in records) {
                    val recordObj = JSObject()
                    recordObj.put("id", record.id)
                    recordObj.put("referenceNo", record.referenceNo)
                    recordObj.put("recordType", record.recordType)
                    recordObj.put("payload", JSObject(record.payload))
                    recordObj.put("createdAt", record.createdAt)
                    recordObj.put("updatedAt", record.updatedAt)
                    recordObj.put("syncAttempts", record.syncAttempts)
                    recordObj.put("lastError", record.lastError)
                    recordsArray.put(recordObj)
                }
                
                Log.d(TAG, "[Storage] Found ${records.size} unsynced records")
                
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("records", recordsArray)
                    result.put("count", records.size)
                    call.resolve(result)
                }
                
            } catch (e: Exception) {
                Log.e(TAG, "[Storage] Failed to get unsynced records", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to get records: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Mark a record as synced
     */
    @PluginMethod
    fun markAsSynced(call: PluginCall) {
        val referenceNo = call.getString("referenceNo")
        val backendId = call.getInt("backendId")
        
        if (referenceNo.isNullOrEmpty()) {
            call.reject("Reference number is required")
            return
        }
        
        Log.d(TAG, "[Storage] Marking as synced: $referenceNo")
        
        pluginScope.launch {
            try {
                repository.markAsSynced(referenceNo, backendId?.toLong())
                
                Log.d(TAG, "[Storage] Record marked as synced: $referenceNo")
                
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("referenceNo", referenceNo)
                    call.resolve(result)
                }
                
            } catch (e: Exception) {
                Log.e(TAG, "[Storage] Failed to mark as synced", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to mark as synced: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Update sync error for a record
     */
    @PluginMethod
    fun updateSyncError(call: PluginCall) {
        val referenceNo = call.getString("referenceNo")
        val error = call.getString("error")
        
        if (referenceNo.isNullOrEmpty()) {
            call.reject("Reference number is required")
            return
        }
        
        Log.d(TAG, "[Storage] Updating sync error for: $referenceNo")
        
        pluginScope.launch {
            try {
                repository.updateSyncError(referenceNo, error ?: "Unknown error")
                
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    call.resolve(result)
                }
                
            } catch (e: Exception) {
                Log.e(TAG, "[Storage] Failed to update sync error", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to update error: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Get record by reference number
     */
    @PluginMethod
    fun getRecordByReference(call: PluginCall) {
        val referenceNo = call.getString("referenceNo")
        
        if (referenceNo.isNullOrEmpty()) {
            call.reject("Reference number is required")
            return
        }
        
        pluginScope.launch {
            try {
                val record = repository.getRecordByReference(referenceNo)
                
                withContext(Dispatchers.Main) {
                    if (record != null) {
                        val result = JSObject()
                        result.put("found", true)
                        result.put("id", record.id)
                        result.put("referenceNo", record.referenceNo)
                        result.put("recordType", record.recordType)
                        result.put("payload", JSObject(record.payload))
                        result.put("isSynced", record.isSynced)
                        result.put("createdAt", record.createdAt)
                        call.resolve(result)
                    } else {
                        val result = JSObject()
                        result.put("found", false)
                        call.resolve(result)
                    }
                }
                
            } catch (e: Exception) {
                Log.e(TAG, "[Storage] Failed to get record", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to get record: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Delete synced records older than specified days
     */
    @PluginMethod
    fun cleanupOldRecords(call: PluginCall) {
        val daysOld = call.getInt("daysOld", 30)
        
        Log.d(TAG, "[Storage] Cleaning up records older than $daysOld days")
        
        pluginScope.launch {
            try {
                val cutoffTime = System.currentTimeMillis() - (daysOld!! * 24 * 60 * 60 * 1000L)
                val deleted = repository.deleteOldSyncedRecords(cutoffTime)
                
                Log.d(TAG, "[Storage] Deleted $deleted old records")
                
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("deletedCount", deleted)
                    call.resolve(result)
                }
                
            } catch (e: Exception) {
                Log.e(TAG, "[Storage] Failed to cleanup records", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to cleanup: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Get sync statistics
     */
    @PluginMethod
    fun getSyncStats(call: PluginCall) {
        pluginScope.launch {
            try {
                val totalCount = repository.getTotalRecordCount()
                val unsyncedCount = repository.getUnsyncedCount()
                val syncedCount = totalCount - unsyncedCount
                val failedCount = repository.getFailedSyncCount()
                
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("total", totalCount)
                    result.put("synced", syncedCount)
                    result.put("unsynced", unsyncedCount)
                    result.put("failed", failedCount)
                    call.resolve(result)
                }
                
            } catch (e: Exception) {
                Log.e(TAG, "[Storage] Failed to get sync stats", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to get stats: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Check if database is ready
     */
    @PluginMethod
    fun isReady(call: PluginCall) {
        val result = JSObject()
        result.put("ready", DelicoopDatabase.isInitialized())
        call.resolve(result)
    }
    
    override fun handleOnDestroy() {
        Log.d(TAG, "[Storage] Plugin destroyed")
        pluginScope.cancel()
        super.handleOnDestroy()
    }
}
