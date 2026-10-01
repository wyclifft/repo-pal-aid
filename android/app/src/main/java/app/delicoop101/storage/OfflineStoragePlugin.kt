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
import app.delicoop101.database.DatabaseBackupManager
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

                // Asynchronously trigger backup to external storage
                scope.launch {
                    DatabaseBackupManager.backupDatabase(context)
                }

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
                if (records.isNotEmpty()) {
                    records.forEach { 
                        Log.d(TAG, "[GET] PENDING DETECTED: ref=${it.referenceNo}, type=${it.recordType}, id=${it.id}")
                    }
                }
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
        val referenceNo = call.getString("referenceNo")?.trim()
        val backendId = call.getInt("backendId")?.toLong()

        if (id == null && referenceNo.isNullOrEmpty()) {
            call.reject("Either id or referenceNo is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                
                Log.d(TAG, "[SYNC] Attempting to mark synced: id=$id, ref=$referenceNo, backendId=$backendId")

                val updatedCount = if (id != null) {
                    db.syncRecordDao().markSynced(id, backendId = backendId)
                } else {
                    db.syncRecordDao().markSyncedByReference(referenceNo!!, backendId = backendId)
                }
                
                if (updatedCount > 0) {
                    Log.d(TAG, "[SYNC] MARK SYNCED SUCCESS: id=$id, ref=$referenceNo, count=$updatedCount, backendId=$backendId")
                    DatabaseLogger.info(TAG, "Record confirmed synced in native DB", "id=$id, ref=$referenceNo, count=$updatedCount, backendId=$backendId")

                    withContext(Dispatchers.Main) {
                        val result = JSObject()
                        result.put("success", true)
                        result.put("updatedCount", updatedCount)
                        call.resolve(result)
                    }
                } else {
                    Log.w(TAG, "[SYNC] MARK SYNCED FAILED: Record not found in native storage: id=$id, ref=$referenceNo")
                    withContext(Dispatchers.Main) {
                        val result = JSObject()
                        result.put("success", false)
                        result.put("error", "Record not found in native storage")
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
        val referenceNo = call.getString("referenceNo")?.trim()
        val error = call.getString("error") ?: "Unknown error"

        if (id == null && referenceNo.isNullOrEmpty()) {
            call.reject("Either id or referenceNo is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                
                val updatedCount = if (id != null) {
                    db.syncRecordDao().markSyncFailed(id, error)
                } else {
                    db.syncRecordDao().markSyncFailedByReference(referenceNo!!, error)
                }
                
                if (updatedCount > 0) {
                    Log.w(TAG, "[SYNC] Marked sync failed: id=$id, ref=$referenceNo, count=$updatedCount, error=$error")
                    DatabaseLogger.warn(TAG, "Sync attempt failed", "id=$id, ref=$referenceNo, error=$error")

                    withContext(Dispatchers.Main) {
                        val result = JSObject()
                        result.put("success", true)
                        result.put("updatedCount", updatedCount)
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

    @PluginMethod
    fun pruneOldRecords(call: PluginCall) {
        val days = call.getInt("days") ?: 60
        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                db.pruneOldTransactions(days)
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("daysPruned", days)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[PRUNE] Prune failed: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to prune old records: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun setDeviceCode(call: PluginCall) {
        val devCode = call.getString("devCode") ?: call.getString("devcode")
        if (devCode.isNullOrBlank()) {
            call.reject("devCode is required")
            return
        }
        try {
            DelicoopDatabase.setDeviceCode(context, devCode)
            val dbName = DelicoopDatabase.getDatabaseName(context)
            val result = JSObject()
            result.put("success", true)
            result.put("deviceCode", DelicoopDatabase.getDeviceCode(context))
            result.put("databaseName", dbName)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to set device code: ${e.message}")
        }
    }

    @PluginMethod
    fun getDatabaseInfo(call: PluginCall) {
        try {
            val devCode = DelicoopDatabase.getDeviceCode(context)
            val dbName = DelicoopDatabase.getDatabaseName(context)
            val result = JSObject()
            result.put("deviceCode", devCode)
            result.put("databaseName", dbName)
            result.put("encrypted", false)
            result.put("journalMode", "TRUNCATE")
            result.put("singleFile", true)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("Failed to get database info: ${e.message}")
        }
    }

    @PluginMethod
    fun backupDatabase(call: PluginCall) {
        scope.launch {
            try {
                val success = DatabaseBackupManager.backupDatabase(context)
                val backupFile = DatabaseBackupManager.getBackupFile(context)
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", success)
                    result.put("backupPath", backupFile.absolutePath)
                    result.put("sizeBytes", if (backupFile.exists()) backupFile.length() else 0L)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[BACKUP] Backup failed: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to backup database: ${e.message}")
                }
            }
        }
    }

    @PluginMethod
    fun restoreDatabase(call: PluginCall) {
        scope.launch {
            try {
                val restored = DatabaseBackupManager.restoreIfNeeded(context)
                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("restored", restored)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[RESTORE] Restore failed: ${e.message}", e)
                withContext(Dispatchers.Main) {
                    call.reject("Failed to restore database: ${e.message}")
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
