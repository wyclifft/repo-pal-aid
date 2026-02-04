package app.delicoop101.storage

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import app.delicoop101.database.DelicoopDatabase
import app.delicoop101.database.SyncRecord
import app.delicoop101.database.DatabaseLogger
import kotlinx.coroutines.*
import com.google.gson.Gson

/**
 * Capacitor plugin for offline data storage.
 * Bridges the web layer to the native encrypted Room database.
 */
@CapacitorPlugin(name = "OfflineStorage")
class OfflineStoragePlugin : Plugin() {

    companion object {
        private const val TAG = "OfflineStorage"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val gson = Gson()

    @PluginMethod
    fun saveRecord(call: PluginCall) {
        val referenceNo = call.getString("referenceNo")
        val recordType = call.getString("recordType")
        val payload = call.getString("payload")
        val userId = call.getString("userId")
        val deviceFingerprint = call.getString("deviceFingerprint")

        if (referenceNo.isNullOrBlank() || recordType.isNullOrBlank() || payload.isNullOrBlank()) {
            call.reject("referenceNo, recordType, and payload are required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val record = SyncRecord(
                    referenceNo = referenceNo,
                    recordType = recordType,
                    payload = payload,
                    userId = userId,
                    deviceFingerprint = deviceFingerprint
                )

                val id = db.syncRecordDao().insert(record)
                Log.d(TAG, "[STORAGE] Saved record: $referenceNo (id=$id)")
                DatabaseLogger.info(TAG, "Record saved: $referenceNo", "type=$recordType")

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("id", id)
                    result.put("referenceNo", referenceNo)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[STORAGE] Save failed: ${e.message}")
                DatabaseLogger.error(TAG, "Save failed: $referenceNo", e.message)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to save record: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun getUnsyncedRecords(call: PluginCall) {
        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val records = db.syncRecordDao().getUnsynced()

                val jsonRecords = records.map { record ->
                    JSObject().apply {
                        put("id", record.id)
                        put("referenceNo", record.referenceNo)
                        put("recordType", record.recordType)
                        put("payload", record.payload)
                        put("createdAt", record.createdAt)
                        put("syncAttempts", record.syncAttempts)
                        put("lastError", record.lastError)
                    }
                }

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("records", jsonRecords)
                    result.put("count", records.size)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[STORAGE] Get unsynced failed: ${e.message}")
                withContext(Dispatchers.Main) {
                    call.reject("Failed to get unsynced records: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun markSynced(call: PluginCall) {
        val id = call.getInt("id")?.toLong()
        val backendId = call.getInt("backendId")?.toLong()

        if (id == null) {
            call.reject("id is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                db.syncRecordDao().markSynced(id, backendId = backendId)
                Log.d(TAG, "[STORAGE] Marked synced: id=$id")
                DatabaseLogger.info(TAG, "Record synced: id=$id", "backendId=$backendId")

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[STORAGE] Mark synced failed: ${e.message}")
                withContext(Dispatchers.Main) {
                    call.reject("Failed to mark synced: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun markSyncFailed(call: PluginCall) {
        val id = call.getInt("id")?.toLong()
        val error = call.getString("error") ?: "Unknown error"

        if (id == null) {
            call.reject("id is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                db.syncRecordDao().markSyncFailed(id, error)
                Log.d(TAG, "[STORAGE] Marked sync failed: id=$id")

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[STORAGE] Mark failed failed: ${e.message}")
                withContext(Dispatchers.Main) {
                    call.reject("Failed to mark sync failed: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun getUnsyncedCount(call: PluginCall) {
        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val count = db.syncRecordDao().getUnsyncedCount()

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("count", count)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[STORAGE] Get count failed: ${e.message}")
                withContext(Dispatchers.Main) {
                    call.reject("Failed to get count: ${e.message}")
                }
            }
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }
}
