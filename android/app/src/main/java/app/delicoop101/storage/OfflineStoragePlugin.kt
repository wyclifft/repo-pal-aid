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
import org.json.JSONArray
import org.json.JSONObject

/**
 * Capacitor plugin for offline data storage.
 * Bridges the web layer to the native encrypted Room database.
 * 
 * CRITICAL: This plugin ensures NO DATA LOSS for OrgType C and D.
 * All records are persisted to encrypted SQLite before confirming success.
 */
@CapacitorPlugin(name = "OfflineStorage")
class OfflineStoragePlugin : Plugin() {

    companion object {
        private const val TAG = "OfflineStorage"
        private const val MAX_BATCH_SIZE = 50 // Process in chunks to prevent memory issues
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @PluginMethod
    fun saveRecord(call: PluginCall) {
        val referenceNo = call.getString("referenceNo")
        val recordType = call.getString("recordType")
        val payloadObj = call.getObject("payload")
        val userId = call.getString("userId")
        val deviceFingerprint = call.getString("deviceFingerprint")

        if (referenceNo.isNullOrBlank() || recordType.isNullOrBlank() || payloadObj == null) {
            Log.e(TAG, "[SAVE] Missing required fields: ref=$referenceNo, type=$recordType")
            call.reject("referenceNo, recordType, and payload are required")
            return
        }

        val payload = payloadObj.toString()

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                
                // Check for existing record to prevent duplicates
                val existing = db.syncRecordDao().getByReferenceNo(referenceNo)
                if (existing != null) {
                    Log.w(TAG, "[SAVE] Record already exists: $referenceNo, updating...")
                    DatabaseLogger.warn(TAG, "Duplicate save prevented", "ref=$referenceNo")
                    withContext(Dispatchers.Main) {
                        val result = JSObject()
                        result.put("success", true)
                        result.put("id", existing.id)
                        result.put("referenceNo", referenceNo)
                        result.put("duplicate", true)
                        call.resolve(result)
                    }
                    return@launch
                }
                
                val record = SyncRecord(
                    referenceNo = referenceNo,
                    recordType = recordType,
                    payload = payload,
                    userId = userId,
                    deviceFingerprint = deviceFingerprint
                )

                val id = db.syncRecordDao().insert(record)
                Log.d(TAG, "[SAVE] Record saved: $referenceNo (id=$id, type=$recordType)")
                DatabaseLogger.info(TAG, "Record saved to encrypted DB", "ref=$referenceNo, type=$recordType, id=$id")

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("id", id)
                    result.put("referenceNo", referenceNo)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[SAVE] Critical save failure: $referenceNo - ${e.message}", e)
                DatabaseLogger.error(TAG, "CRITICAL: Save failed - data at risk", "ref=$referenceNo, error=${e.message}")
                withContext(Dispatchers.Main) {
                    call.reject("Failed to save record: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun getUnsyncedRecords(call: PluginCall) {
        val recordType = call.getString("type")
        
        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val records = if (recordType != null) {
                    db.syncRecordDao().getUnsyncedByType(recordType)
                } else {
                    db.syncRecordDao().getUnsynced()
                }

                Log.d(TAG, "[GET] Found ${records.size} unsynced records")
                DatabaseLogger.info(TAG, "Retrieved unsynced records", "count=${records.size}")

                // Convert to JSON string for web layer
                val jsonArray = JSONArray()
                records.forEach { record ->
                    val obj = JSONObject()
                    obj.put("id", record.id)
                    obj.put("referenceNo", record.referenceNo)
                    obj.put("recordType", record.recordType)
                    obj.put("payload", record.payload)
                    obj.put("createdAt", record.createdAt)
                    obj.put("syncAttempts", record.syncAttempts)
                    obj.put("lastError", record.lastError ?: "")
                    jsonArray.put(obj)
                }

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("records", jsonArray.toString())
                    result.put("count", records.size)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[GET] Get unsynced failed: ${e.message}", e)
                DatabaseLogger.error(TAG, "Failed to get unsynced records", e.message)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to get unsynced records: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun markAsSynced(call: PluginCall) {
        val id = call.getInt("id")?.toLong()
        val referenceNo = call.getString("referenceNo")
        val backendId = call.getInt("backendId")?.toLong()

        if (id == null && referenceNo == null) {
            call.reject("Either id or referenceNo is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                
                val recordId = if (id != null) {
                    id
                } else {
                    // Find by reference number
                    val record = db.syncRecordDao().getByReferenceNo(referenceNo!!)
                    record?.id
                }
                
                if (recordId != null) {
                    db.syncRecordDao().markSynced(recordId, backendId = backendId)
                    Log.d(TAG, "[SYNC] Marked synced: id=$recordId, ref=$referenceNo")
                    DatabaseLogger.info(TAG, "Record confirmed synced", "id=$recordId, ref=$referenceNo, backendId=$backendId")

                    withContext(Dispatchers.Main) {
                        val result = JSObject()
                        result.put("success", true)
                        call.resolve(result)
                    }
                } else {
                    Log.w(TAG, "[SYNC] Record not found: id=$id, ref=$referenceNo")
                    withContext(Dispatchers.Main) {
                        val result = JSObject()
                        result.put("success", false)
                        result.put("error", "Record not found")
                        call.resolve(result)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "[SYNC] Mark synced failed: ${e.message}", e)
                DatabaseLogger.error(TAG, "Failed to mark synced", e.message)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to mark synced: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun markSyncFailed(call: PluginCall) {
        val id = call.getInt("id")?.toLong()
        val referenceNo = call.getString("referenceNo")
        val error = call.getString("error") ?: "Unknown error"

        if (id == null && referenceNo == null) {
            call.reject("Either id or referenceNo is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                
                val recordId = if (id != null) {
                    id
                } else {
                    val record = db.syncRecordDao().getByReferenceNo(referenceNo!!)
                    record?.id
                }
                
                if (recordId != null) {
                    db.syncRecordDao().markSyncFailed(recordId, error)
                    Log.w(TAG, "[SYNC] Marked sync failed: id=$recordId, error=$error")
                    DatabaseLogger.warn(TAG, "Sync attempt failed", "id=$recordId, error=$error")

                    withContext(Dispatchers.Main) {
                        val result = JSObject()
                        result.put("success", true)
                        call.resolve(result)
                    }
                } else {
                    withContext(Dispatchers.Main) {
                        val result = JSObject()
                        result.put("success", false)
                        result.put("error", "Record not found")
                        call.resolve(result)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "[SYNC] Mark failed failed: ${e.message}", e)
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
                Log.e(TAG, "[COUNT] Get count failed: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to get count: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun getStats(call: PluginCall) {
        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val dao = db.syncRecordDao()
                
                val unsynced = dao.getUnsyncedCount()
                val recent = dao.getRecent(1000)
                val synced = recent.count { it.isSynced }
                val total = recent.size
                
                Log.d(TAG, "[STATS] total=$total, synced=$synced, unsynced=$unsynced")

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("total", total)
                    result.put("synced", synced)
                    result.put("unsynced", unsynced)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[STATS] Get stats failed: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to get stats: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun triggerSync(call: PluginCall) {
        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val unsyncedCount = db.syncRecordDao().getUnsyncedCount()
                
                Log.d(TAG, "[TRIGGER] Sync triggered with $unsyncedCount pending records")
                DatabaseLogger.info(TAG, "Manual sync triggered", "pending=$unsyncedCount")

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("triggered", true)
                    result.put("pendingCount", unsyncedCount)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[TRIGGER] Trigger sync failed: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to trigger sync: ${e.message}")
                }
            }
        }
    }

    override fun handleOnDestroy() {
        // Flush logs before destroying
        DatabaseLogger.flush()
        scope.cancel()
        super.handleOnDestroy()
    }
}
