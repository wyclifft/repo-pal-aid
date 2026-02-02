package app.delicoop101.database

import androidx.room.*

/**
 * Data Access Object for SyncRecord operations.
 */
@Dao
interface SyncRecordDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(record: SyncRecord): Long
    
    @Update
    suspend fun update(record: SyncRecord)
    
    @Delete
    suspend fun delete(record: SyncRecord)
    
    @Query("SELECT * FROM sync_records WHERE is_synced = 0 ORDER BY created_at ASC")
    suspend fun getUnsyncedRecords(): List<SyncRecord>
    
    @Query("SELECT * FROM sync_records WHERE is_synced = 0 AND record_type = :recordType ORDER BY created_at ASC")
    suspend fun getUnsyncedRecordsByType(recordType: String): List<SyncRecord>
    
    @Query("SELECT * FROM sync_records WHERE reference_no = :referenceNo LIMIT 1")
    suspend fun getByReferenceNo(referenceNo: String): SyncRecord?
    
    @Query("UPDATE sync_records SET is_synced = 1, synced_at = :syncedAt, backend_id = :backendId WHERE reference_no = :referenceNo")
    suspend fun markAsSynced(referenceNo: String, syncedAt: Long, backendId: Long?)
    
    @Query("UPDATE sync_records SET sync_attempts = sync_attempts + 1, last_error = :error, updated_at = :updatedAt WHERE reference_no = :referenceNo")
    suspend fun updateSyncError(referenceNo: String, error: String, updatedAt: Long)
    
    @Query("SELECT COUNT(*) FROM sync_records")
    suspend fun getTotalCount(): Int
    
    @Query("SELECT COUNT(*) FROM sync_records WHERE is_synced = 0")
    suspend fun getUnsyncedCount(): Int
    
    @Query("SELECT COUNT(*) FROM sync_records WHERE is_synced = 0 AND sync_attempts > 0")
    suspend fun getFailedSyncCount(): Int
    
    @Query("DELETE FROM sync_records WHERE is_synced = 1 AND synced_at < :cutoffTime")
    suspend fun deleteOldSyncedRecords(cutoffTime: Long): Int
    
    @Query("SELECT * FROM sync_records ORDER BY created_at DESC LIMIT :limit")
    suspend fun getRecentRecords(limit: Int): List<SyncRecord>
}
