package app.delicoop101.database

import androidx.room.*

/**
 * Data Access Object for sync_records table.
 * Provides methods for offline-first data synchronization.
 */
@Dao
interface SyncRecordDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(record: SyncRecord): Long
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(records: List<SyncRecord>): List<Long>
    
    @Update
    suspend fun update(record: SyncRecord)
    
    @Delete
    suspend fun delete(record: SyncRecord)
    
    @Query("SELECT * FROM sync_records WHERE id = :id")
    suspend fun getById(id: Long): SyncRecord?
    
    @Query("SELECT * FROM sync_records WHERE UPPER(TRIM(reference_no)) = UPPER(TRIM(:referenceNo)) ORDER BY id DESC LIMIT 1")
    suspend fun getByReferenceNo(referenceNo: String): SyncRecord?
    
    @Query("SELECT * FROM sync_records WHERE is_synced = 0 ORDER BY created_at ASC")
    suspend fun getUnsynced(): List<SyncRecord>
    
    @Query("SELECT * FROM sync_records WHERE is_synced = 0 AND record_type = :recordType ORDER BY created_at ASC")
    suspend fun getUnsyncedByType(recordType: String): List<SyncRecord>
    
    @Query("SELECT COUNT(*) FROM sync_records WHERE is_synced = 0")
    suspend fun getUnsyncedCount(): Int
    
    @Query("SELECT * FROM sync_records ORDER BY created_at DESC LIMIT :limit")
    suspend fun getRecent(limit: Int = 50): List<SyncRecord>
    
    @Query("UPDATE sync_records SET is_synced = 1, synced_at = :syncedAt, backend_id = :backendId WHERE id = :id")
    suspend fun markSynced(id: Long, syncedAt: Long = System.currentTimeMillis(), backendId: Long? = null): Int

    @Query("UPDATE sync_records SET is_synced = 1, synced_at = :syncedAt, backend_id = :backendId WHERE UPPER(TRIM(reference_no)) = UPPER(TRIM(:referenceNo))")
    suspend fun markSyncedByReference(referenceNo: String, syncedAt: Long = System.currentTimeMillis(), backendId: Long? = null): Int
    
    @Query("UPDATE sync_records SET sync_attempts = sync_attempts + 1, last_error = :error, updated_at = :updatedAt WHERE id = :id")
    suspend fun markSyncFailed(id: Long, error: String, updatedAt: Long = System.currentTimeMillis()): Int

    @Query("UPDATE sync_records SET sync_attempts = sync_attempts + 1, last_error = :error, updated_at = :updatedAt WHERE UPPER(TRIM(reference_no)) = UPPER(TRIM(:referenceNo))")
    suspend fun markSyncFailedByReference(referenceNo: String, error: String, updatedAt: Long = System.currentTimeMillis()): Int
    
    @Query("DELETE FROM sync_records WHERE is_synced = 1 AND synced_at < :olderThan")
    suspend fun deleteSyncedOlderThan(olderThan: Long): Int
}
