package app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.database

import android.content.Context
import android.util.Log
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Repository for managing offline-first data storage.
 * Provides a clean API for saving, retrieving, and syncing records.
 */
class SyncRepository private constructor(context: Context) {
    
    companion object {
        internal const val TAG = "SyncRepository"
        
        @Volatile
        private var INSTANCE: SyncRepository? = null
        
        fun getInstance(context: Context): SyncRepository {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: SyncRepository(context.applicationContext).also { INSTANCE = it }
            }
        }
    }
    
    private val database = DelicoopDatabase.getInstance(context)
    private val dao = database.syncRecordDao()
    internal val gson: Gson = GsonBuilder()
        .setDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ")
        .create()
    
    // =========================================================================
    // SAVE OPERATIONS (Local First)
    // =========================================================================
    
    /**
     * Save a record locally. This is the primary method for offline-first storage.
     * The record will be marked as unsynced and queued for background sync.
     */
    suspend fun saveRecord(
        referenceNo: String,
        recordType: String,
        payload: Any,
        userId: String? = null,
        deviceFingerprint: String? = null
    ): Long = withContext(Dispatchers.IO) {
        val payloadJson = gson.toJson(payload)
        
        val record = SyncRecord(
            referenceNo = referenceNo,
            recordType = recordType,
            payload = payloadJson,
            userId = userId,
            deviceFingerprint = deviceFingerprint,
            isSynced = false
        )
        
        val id = dao.insert(record)
        Log.d(TAG, "[DB] Saved record: type=$recordType, ref=$referenceNo, id=$id")
        id
    }
    
    /**
     * Save multiple records at once
     */
    suspend fun saveRecords(records: List<SyncRecord>): List<Long> = withContext(Dispatchers.IO) {
        val ids = dao.insertAll(records)
        Log.d(TAG, "[DB] Saved ${records.size} records")
        ids
    }
    
    // =========================================================================
    // QUERY OPERATIONS
    // =========================================================================
    
    /**
     * Get all records pending sync
     */
    suspend fun getUnsyncedRecords(): List<SyncRecord> = withContext(Dispatchers.IO) {
        dao.getUnsyncedRecords()
    }
    
    /**
     * Get unsynced records by type
     */
    suspend fun getUnsyncedRecordsByType(type: String): List<SyncRecord> = withContext(Dispatchers.IO) {
        dao.getUnsyncedRecordsByType(type)
    }
    
    /**
     * Get count of pending sync records
     */
    suspend fun getUnsyncedCount(): Int = withContext(Dispatchers.IO) {
        dao.getUnsyncedCount()
    }
    
    /**
     * Get record by reference number
     */
    suspend fun getByReferenceNo(referenceNo: String): SyncRecord? = withContext(Dispatchers.IO) {
        dao.getByReferenceNo(referenceNo)
    }
    
    /**
     * Get all records of a specific type
     */
    suspend fun getByType(type: String): List<SyncRecord> = withContext(Dispatchers.IO) {
        dao.getByType(type)
    }
    
    /**
     * Check if a reference number exists
     */
    suspend fun exists(referenceNo: String): Boolean = withContext(Dispatchers.IO) {
        dao.existsByReferenceNo(referenceNo)
    }
    
    /**
     * Get records that are eligible for retry (not exceeded max attempts)
     */
    suspend fun getRecordsForRetry(maxAttempts: Int = 5): List<SyncRecord> = withContext(Dispatchers.IO) {
        dao.getRecordsForRetry(maxAttempts)
    }
    
    // =========================================================================
    // SYNC STATUS OPERATIONS
    // =========================================================================
    
    /**
     * Mark a record as successfully synced
     */
    suspend fun markAsSynced(id: Long, backendId: Long? = null) = withContext(Dispatchers.IO) {
        dao.markAsSynced(id, backendId)
        Log.d(TAG, "[SYNC] Marked record $id as synced, backendId=$backendId")
    }
    
    /**
     * Mark a record as synced by reference number
     */
    suspend fun markAsSyncedByRef(referenceNo: String, backendId: Long? = null) = withContext(Dispatchers.IO) {
        dao.markAsSyncedByRef(referenceNo, backendId)
        Log.d(TAG, "[SYNC] Marked record ref=$referenceNo as synced")
    }
    
    /**
     * Record a sync failure with error message
     */
    suspend fun recordSyncFailure(id: Long, error: String) = withContext(Dispatchers.IO) {
        dao.recordSyncFailure(id, error)
        Log.w(TAG, "[SYNC] Recorded failure for record $id: $error")
    }
    
    /**
     * Reset sync attempts for manual retry
     */
    suspend fun resetSyncAttempts(id: Long) = withContext(Dispatchers.IO) {
        dao.resetSyncAttempts(id)
        Log.d(TAG, "[SYNC] Reset sync attempts for record $id")
    }
    
    // =========================================================================
    // DELETE OPERATIONS
    // =========================================================================
    
    /**
     * Delete a record by ID
     */
    suspend fun deleteById(id: Long) = withContext(Dispatchers.IO) {
        dao.deleteById(id)
        Log.d(TAG, "[DB] Deleted record $id")
    }
    
    /**
     * Delete a record by reference number
     */
    suspend fun deleteByReferenceNo(referenceNo: String) = withContext(Dispatchers.IO) {
        dao.deleteByReferenceNo(referenceNo)
        Log.d(TAG, "[DB] Deleted record ref=$referenceNo")
    }
    
    /**
     * Cleanup old synced records (retention policy)
     * Deletes synced records older than the specified number of days
     */
    suspend fun cleanupOldRecords(retentionDays: Int = 30): Int = withContext(Dispatchers.IO) {
        val cutoffTime = System.currentTimeMillis() - (retentionDays * 24 * 60 * 60 * 1000L)
        val deleted = dao.deleteSyncedOlderThan(cutoffTime)
        Log.d(TAG, "[DB] Cleaned up $deleted old synced records")
        deleted
    }
    
    // =========================================================================
    // STATISTICS
    // =========================================================================
    
    /**
     * Get database statistics
     */
    suspend fun getStats(): DatabaseStats = withContext(Dispatchers.IO) {
        DatabaseStats(
            totalRecords = dao.getTotalCount(),
            syncedRecords = dao.getSyncedCount(),
            unsyncedRecords = dao.getUnsyncedCount()
        )
    }
    
    /**
     * Parse payload JSON to a specific type
     */
    internal inline fun <reified T> parsePayload(record: SyncRecord): T? {
        return try {
            gson.fromJson(record.payload, T::class.java)
        } catch (e: Exception) {
            Log.e(TAG, "[DB] Failed to parse payload: ${e.message}")
            null
        }
    }
}

/**
 * Data class for database statistics
 */
data class DatabaseStats(
    val totalRecords: Int,
    val syncedRecords: Int,
    val unsyncedRecords: Int
) {
    val syncPercentage: Float
        get() = if (totalRecords > 0) (syncedRecords.toFloat() / totalRecords) * 100 else 100f
}
