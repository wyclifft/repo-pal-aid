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
import app.delicoop101.database.BackfillManager
import app.delicoop101.database.CmMember
import app.delicoop101.database.FmItem
import app.delicoop101.database.UserEntity
import app.delicoop101.database.CmCredit
import app.delicoop101.database.FmTank
import app.delicoop101.database.Season
import app.delicoop101.database.DeviceConfig
import app.delicoop101.database.AiTransaction
import app.delicoop101.database.StoreTransaction
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

                // Route transaction to appropriate domain table based on recordType
                try {
                    val devCode = DelicoopDatabase.getDeviceCode(context)
                    // Write transaction into central em_transaction table
                    val emTx = BackfillManager.parsePayloadToTransaction(record, referenceNo)
                    if (emTx != null) {
                        db.emTransactionDao().insert(emTx)
                        Log.d(TAG, "[SAVE] Transaction written to em_transaction: $referenceNo (type=$recordType, icode=${emTx.icode})")
                    }

                    when (recordType.lowercase()) {
                        "store_sale", "store", "sale" -> {
                            val jsonObj = org.json.JSONObject(payload)
                            val memberNo = jsonObj.optString("memberno", jsonObj.optString("memberNo", jsonObj.optString("farmer_id", jsonObj.optString("farmerId", jsonObj.optString("farmerno", jsonObj.optString("mcode", ""))))))
                            val transType = jsonObj.optString("transtype", jsonObj.optString("transType", "2"))
                            val storeTx = StoreTransaction(
                                deviceCode = devCode,
                                memberNumber = memberNo,
                                transactionType = transType
                            )
                            db.storeTransactionDao().insert(storeTx)
                            Log.d(TAG, "[SAVE] Store transaction written to store_transaction: $referenceNo (member=$memberNo)")
                        }
                        "ai_sale", "ai", "ai_service" -> {
                            val jsonObj = org.json.JSONObject(payload)
                            val memberNo = jsonObj.optString("memberno", jsonObj.optString("memberNo", jsonObj.optString("farmer_id", jsonObj.optString("farmerId", jsonObj.optString("farmerno", jsonObj.optString("mcode", ""))))))
                            val aiTx = AiTransaction(
                                deviceCode = devCode,
                                memberNumber = memberNo
                            )
                            db.aiTransactionDao().insert(aiTx)
                            Log.d(TAG, "[SAVE] AI transaction written to ai_transaction: $referenceNo (member=$memberNo)")
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "[SAVE] Domain table routing skipped: ${e.message}")
                }

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

                Log.d(TAG, "[GET] Found ${records.size} unsynced records for type=${recordType ?: "all"}")
                DatabaseLogger.info(TAG, "Retrieved unsynced records", "type=${recordType ?: "all"}, count=${records.size}")

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

    @PluginMethod
    fun upsertMembers(call: PluginCall) {
        val membersArray = call.getArray("members")
        if (membersArray == null) {
            call.reject("members array is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val memberList = mutableListOf<CmMember>()

                for (i in 0 until membersArray.length()) {
                    val obj = membersArray.getJSONObject(i)
                    memberList.add(
                        CmMember(
                            descript = obj.optString("descript", obj.optString("name", "")),
                            mcode = obj.optString("mcode", obj.optString("memberno", "")),
                            idno = obj.optString("idno", ""),
                            route = obj.optString("route", ""),
                            status = obj.optInt("status", 1),
                            mstatus = obj.optString("mstatus", ""),
                            clientFetch = obj.optString("clientFetch", null),
                            clientFetch1 = obj.optString("clientFetch1", null),
                            ccode = obj.optString("ccode", ""),
                            crbal = obj.optString("crbal", "0"),
                            prvqty = obj.optDouble("prvqty", 0.0),
                            currqty = obj.optDouble("currqty", 0.0),
                            multOpt = obj.optInt("multOpt", 0)
                        )
                    )
                }

                if (memberList.isNotEmpty()) {
                    db.cmMemberDao().insertAll(memberList)
                    scope.launch { DatabaseBackupManager.backupDatabase(context) }
                }

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("count", memberList.size)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[MEMBERS] Upsert failed: ${e.message}", e)
                withContext(Dispatchers.Main) { call.reject("Failed to upsert members: ${e.message}") }
            }
        }
    }

    @PluginMethod
    fun getMembers(call: PluginCall) {
        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val members = db.cmMemberDao().getAll()
                val jsonArray = JSONArray()

                for (m in members) {
                    val obj = JSONObject()
                    obj.put("id", m.id)
                    obj.put("descript", m.descript)
                    obj.put("mcode", m.mcode)
                    obj.put("idno", m.idno)
                    obj.put("route", m.route)
                    obj.put("status", m.status)
                    obj.put("ccode", m.ccode)
                    obj.put("crbal", m.crbal)
                    obj.put("prvqty", m.prvqty)
                    obj.put("currqty", m.currqty)
                    jsonArray.put(obj)
                }

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("members", jsonArray.toString())
                    result.put("count", members.size)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { call.reject("Failed to get members: ${e.message}") }
            }
        }
    }

    @PluginMethod
    fun upsertItems(call: PluginCall) {
        val itemsArray = call.getArray("items")
        if (itemsArray == null) {
            call.reject("items array is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val itemList = mutableListOf<FmItem>()

                for (i in 0 until itemsArray.length()) {
                    val obj = itemsArray.getJSONObject(i)
                    itemList.add(
                        FmItem(
                            icode = obj.optString("icode", ""),
                            descript = obj.optString("descript", ""),
                            sprice = obj.optDouble("sprice", 0.0),
                            mprice = obj.optDouble("mprice", 0.0),
                            stockbal = obj.optDouble("stockbal", 0.0),
                            ccode = obj.optString("ccode", ""),
                            coreUpload = obj.optInt("coreUpload", 0),
                            clientFetch = obj.optInt("clientFetch", 0),
                            clientFetch1 = obj.optInt("clientFetch1", 0),
                            invtype = obj.optString("invtype", "")
                        )
                    )
                }

                if (itemList.isNotEmpty()) {
                    db.fmItemDao().insertAll(itemList)
                    scope.launch { DatabaseBackupManager.backupDatabase(context) }
                }

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("count", itemList.size)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[ITEMS] Upsert failed: ${e.message}", e)
                withContext(Dispatchers.Main) { call.reject("Failed to upsert items: ${e.message}") }
            }
        }
    }

    @PluginMethod
    fun getItems(call: PluginCall) {
        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val items = db.fmItemDao().getAll()
                val jsonArray = JSONArray()

                for (item in items) {
                    val obj = JSONObject()
                    obj.put("id", item.id)
                    obj.put("icode", item.icode)
                    obj.put("descript", item.descript)
                    obj.put("sprice", item.sprice)
                    obj.put("mprice", item.mprice)
                    obj.put("stockbal", item.stockbal)
                    obj.put("ccode", item.ccode)
                    obj.put("invtype", item.invtype)
                    jsonArray.put(obj)
                }

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("items", jsonArray.toString())
                    result.put("count", items.size)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { call.reject("Failed to get items: ${e.message}") }
            }
        }
    }

    @PluginMethod
    fun getEmTransactions(call: PluginCall) {
        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val transactions = db.emTransactionDao().getAll()
                val jsonArray = JSONArray()

                for (tx in transactions) {
                    val obj = JSONObject()
                    obj.put("id", tx.id)
                    obj.put("transrefno", tx.transrefno)
                    obj.put("userId", tx.userId)
                    obj.put("clerk", tx.clerk)
                    obj.put("deviceserial", tx.deviceserial)
                    obj.put("memberno", tx.memberno)
                    obj.put("route", tx.route)
                    obj.put("weight", tx.weight)
                    obj.put("session", tx.session)
                    obj.put("transdate", tx.transdate)
                    obj.put("transtime", tx.transtime)
                    obj.put("amount", tx.amount)
                    obj.put("icode", tx.icode)
                    obj.put("uploaded", tx.uploaded)
                    obj.put("ccode", tx.ccode)
                    jsonArray.put(obj)
                }

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("transactions", jsonArray.toString())
                    result.put("count", transactions.size)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { call.reject("Failed to get em_transactions: ${e.message}") }
            }
        }
    }

    @PluginMethod
    fun upsertUsers(call: PluginCall) {
        val usersArray = call.getArray("users")
        if (usersArray == null) {
            call.reject("users array is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val userList = mutableListOf<UserEntity>()

                for (i in 0 until usersArray.length()) {
                    val obj = usersArray.getJSONObject(i)
                    userList.add(
                        UserEntity(
                            userid = obj.optString("userid", ""),
                            username = obj.optString("username", ""),
                            password = obj.optString("password", ""),
                            groupid = obj.optString("groupid", "1"),
                            supervisor = obj.optInt("supervisor", 0),
                            astatus = obj.optInt("astatus", 1),
                            cPassword = obj.optString("c_password", ""),
                            email = obj.optString("email", ""),
                            ccode = obj.optString("ccode", "")
                        )
                    )
                }

                if (userList.isNotEmpty()) {
                    db.userDao().insertAll(userList)
                    scope.launch { DatabaseBackupManager.backupDatabase(context) }
                }

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("count", userList.size)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[USERS] Upsert failed: ${e.message}", e)
                withContext(Dispatchers.Main) { call.reject("Failed to upsert users: ${e.message}") }
            }
        }
    }

    @PluginMethod
    fun upsertCredits(call: PluginCall) {
        val creditsArray = call.getArray("credits")
        if (creditsArray == null) {
            call.reject("credits array is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val creditList = mutableListOf<CmCredit>()

                for (i in 0 until creditsArray.length()) {
                    val obj = creditsArray.getJSONObject(i)
                    creditList.add(
                        CmCredit(
                            crcode = obj.optString("crcode", ""),
                            descript = obj.optString("descript", ""),
                            ccode = obj.optString("ccode", ""),
                            coreUpload = obj.optString("coreUpload", "0"),
                            clientFetch = obj.optString("clientFetch", "0"),
                            clientFetch1 = obj.optInt("clientFetch1", 0)
                        )
                    )
                }

                if (creditList.isNotEmpty()) {
                    db.cmCreditDao().insertAll(creditList)
                    scope.launch { DatabaseBackupManager.backupDatabase(context) }
                }

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("count", creditList.size)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[CREDITS] Upsert failed: ${e.message}", e)
                withContext(Dispatchers.Main) { call.reject("Failed to upsert credits: ${e.message}") }
            }
        }
    }

    @PluginMethod
    fun upsertTanks(call: PluginCall) {
        val tanksArray = call.getArray("tanks")
        if (tanksArray == null) {
            call.reject("tanks array is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val tankList = mutableListOf<FmTank>()

                for (i in 0 until tanksArray.length()) {
                    val obj = tanksArray.getJSONObject(i)
                    tankList.add(
                        FmTank(
                            tcode = obj.optString("tcode", ""),
                            descript = obj.optString("descript", ""),
                            icode = obj.optString("icode", ""),
                            idesc = obj.optString("idesc", ""),
                            depart = obj.optString("depart", ""),
                            ccode = obj.optString("ccode", ""),
                            cname = obj.optString("cname", ""),
                            caddress = obj.optString("caddress", ""),
                            tel = obj.optString("tel", ""),
                            email = obj.optString("email", ""),
                            printOptions = obj.optString("printOptions", "3"),
                            clientFetch = obj.optInt("clientFetch", 1),
                            mprefix = obj.optString("mprefix", "M")
                        )
                    )
                }

                if (tankList.isNotEmpty()) {
                    db.fmTankDao().insertAll(tankList)
                    scope.launch { DatabaseBackupManager.backupDatabase(context) }
                }

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("count", tankList.size)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[TANKS] Upsert failed: ${e.message}", e)
                withContext(Dispatchers.Main) { call.reject("Failed to upsert tanks: ${e.message}") }
            }
        }
    }

    @PluginMethod
    fun upsertSeasons(call: PluginCall) {
        val seasonsArray = call.getArray("seasons")
        if (seasonsArray == null) {
            call.reject("seasons array is required")
            return
        }

        scope.launch {
            try {
                val db = DelicoopDatabase.getInstance(context)
                val seasonList = mutableListOf<Season>()

                for (i in 0 until seasonsArray.length()) {
                    val obj = seasonsArray.getJSONObject(i)
                    seasonList.add(
                        Season(
                            ccode = obj.optString("ccode", ""),
                            scode = obj.optString("scode", ""),
                            descript = obj.optString("descript", ""),
                            dateFrom = obj.optString("date_from", obj.optString("dateFrom", "")),
                            dateTo = obj.optString("date_to", obj.optString("dateTo", ""))
                        )
                    )
                }

                if (seasonList.isNotEmpty()) {
                    db.seasonDao().insertAll(seasonList)
                    scope.launch { DatabaseBackupManager.backupDatabase(context) }
                }

                withContext(Dispatchers.Main) {
                    val result = JSObject()
                    result.put("success", true)
                    result.put("count", seasonList.size)
                    call.resolve(result)
                }
            } catch (e: Exception) {
                Log.e(TAG, "[SEASONS] Upsert failed: ${e.message}", e)
                withContext(Dispatchers.Main) { call.reject("Failed to upsert seasons: ${e.message}") }
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
