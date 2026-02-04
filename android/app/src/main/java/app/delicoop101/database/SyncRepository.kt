package app.delicoop101.database

import android.content.Context
import android.util.Log

/**
 * Repository for managing sync records.
 * Provides a clean API for the rest of the app to interact with sync data.
 */
class SyncRepository(context: Context) {
    
    companion object {
        private const val TAG = "SyncRepository"
    }
    
    private val database = DelicoopDatabase.getInstance(context)
    private val syncRecordDao = database.syncRecordDao()
    
    /**
     * Save a new record for syncing
     */
    suspend fun saveRecord(
        referenceNo: String,
        recordType: String,
        payload: String,
        userId: String? = null,
        deviceFingerprint: String? = null
    ): Long {
        val record = SyncRecord(
            referenceNo = referenceNo,
            recordType = recordType,
            payload = payload,
            userId = userId,
            deviceFingerprint = deviceFingerprint
        )
        
        val id = syncRecordDao.insert(record)
        Log.d(TAG, "[SYNC] Saved record: $referenceNo (id=$id)")
        DatabaseLogger.info(TAG, "Record saved: $referenceNo", "type=$recordType")
        return id
    }
    
    /**
     * Get all records that need to be synced
     */
    suspend fun getUnsyncedRecords(): List<SyncRecord> {
        return syncRecordDao.getUnsynced()
    }
    
    /**
     * Get unsynced count
     */
    suspend fun getUnsyncedCount(): Int {
        return syncRecordDao.getUnsyncedCount()
    }
    
    /**
     * Mark a record as successfully synced
     */
    suspend fun markSynced(id: Long, backendId: Long? = null) {
        syncRecordDao.markSynced(id, backendId = backendId)
        Log.d(TAG, "[SYNC] Marked synced: id=$id, backendId=$backendId")
        DatabaseLogger.info(TAG, "Record synced: id=$id", "backendId=$backendId")
    }
    
    /**
     * Mark a sync attempt as failed
     */
    suspend fun markSyncFailed(id: Long, error: String) {
        syncRecordDao.markSyncFailed(id, error)
        Log.w(TAG, "[SYNC] Sync failed: id=$id, error=$error")
        DatabaseLogger.warn(TAG, "Sync failed: id=$id", error)
    }
    
    /**
     * Get a record by reference number
     */
    suspend fun getByReferenceNo(referenceNo: String): SyncRecord? {
        return syncRecordDao.getByReferenceNo(referenceNo)
    }
    
    /**
     * Get recent records for display
     */
    suspend fun getRecentRecords(limit: Int = 50): List<SyncRecord> {
        return syncRecordDao.getRecent(limit)
    }
    
    /**
     * Clean up old synced records (call periodically)
     */
    suspend fun cleanupOldRecords(olderThanDays: Int = 30): Int {
        val cutoff = System.currentTimeMillis() - (olderThanDays * 24 * 60 * 60 * 1000L)
        val deleted = syncRecordDao.deleteSyncedOlderThan(cutoff)
        if (deleted > 0) {
            Log.d(TAG, "[SYNC] Cleaned up $deleted old synced records")
            DatabaseLogger.info(TAG, "Cleanup: deleted $deleted old records")
        }
        return deleted
    }
}
