package app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.database

import androidx.room.*
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for SyncRecord operations.
 * Provides all database operations for offline-first storage.
 */
@Dao
interface SyncRecordDao {
    
    // =========================================================================
    // INSERT OPERATIONS
    // =========================================================================
    
    /**
     * Insert a new record. Returns the new row ID.
     * Uses REPLACE strategy to handle conflicts on reference_no.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(record: SyncRecord): Long
    
    /**
     * Insert multiple records at once
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(records: List<SyncRecord>): List<Long>
    
    // =========================================================================
    // QUERY OPERATIONS
    // =========================================================================
    
    /**
     * Get all unsynced records, ordered by creation time (oldest first)
     */
    @Query("SELECT * FROM sync_records WHERE is_synced = 0 ORDER BY created_at ASC")
    suspend fun getUnsyncedRecords(): List<SyncRecord>
    
    /**
     * Get unsynced records by type
     */
    @Query("SELECT * FROM sync_records WHERE is_synced = 0 AND record_type = :type ORDER BY created_at ASC")
    suspend fun getUnsyncedRecordsByType(type: String): List<SyncRecord>
    
    /**
     * Get count of unsynced records
     */
    @Query("SELECT COUNT(*) FROM sync_records WHERE is_synced = 0")
    suspend fun getUnsyncedCount(): Int
    
    /**
     * Get count of unsynced records by type
     */
    @Query("SELECT COUNT(*) FROM sync_records WHERE is_synced = 0 AND record_type = :type")
    suspend fun getUnsyncedCountByType(type: String): Int
    
    /**
     * Observe unsynced count (for UI updates)
     */
    @Query("SELECT COUNT(*) FROM sync_records WHERE is_synced = 0")
    fun observeUnsyncedCount(): Flow<Int>
    
    /**
     * Get record by ID
     */
    @Query("SELECT * FROM sync_records WHERE id = :id")
    suspend fun getById(id: Long): SyncRecord?
    
    /**
     * Get record by reference number
     */
    @Query("SELECT * FROM sync_records WHERE reference_no = :referenceNo")
    suspend fun getByReferenceNo(referenceNo: String): SyncRecord?
    
    /**
     * Get all records by type
     */
    @Query("SELECT * FROM sync_records WHERE record_type = :type ORDER BY created_at DESC")
    suspend fun getByType(type: String): List<SyncRecord>
    
    /**
     * Get all records
     */
    @Query("SELECT * FROM sync_records ORDER BY created_at DESC")
    suspend fun getAll(): List<SyncRecord>
    
    /**
     * Get records that failed sync (have errors)
     */
    @Query("SELECT * FROM sync_records WHERE is_synced = 0 AND last_error IS NOT NULL ORDER BY sync_attempts ASC")
    suspend fun getFailedRecords(): List<SyncRecord>
    
    /**
     * Get records with retry limit not exceeded
     */
    @Query("SELECT * FROM sync_records WHERE is_synced = 0 AND sync_attempts < :maxAttempts ORDER BY created_at ASC")
    suspend fun getRecordsForRetry(maxAttempts: Int = 5): List<SyncRecord>
    
    // =========================================================================
    // UPDATE OPERATIONS
    // =========================================================================
    
    /**
     * Update a record
     */
    @Update
    suspend fun update(record: SyncRecord)
    
    /**
     * Mark record as synced with backend ID
     */
    @Query("""
        UPDATE sync_records 
        SET is_synced = 1, 
            synced_at = :syncedAt, 
            backend_id = :backendId,
            last_error = NULL,
            updated_at = :syncedAt
        WHERE id = :id
    """)
    suspend fun markAsSynced(id: Long, backendId: Long?, syncedAt: Long = System.currentTimeMillis())
    
    /**
     * Mark record as synced by reference number
     */
    @Query("""
        UPDATE sync_records 
        SET is_synced = 1, 
            synced_at = :syncedAt, 
            backend_id = :backendId,
            last_error = NULL,
            updated_at = :syncedAt
        WHERE reference_no = :referenceNo
    """)
    suspend fun markAsSyncedByRef(referenceNo: String, backendId: Long?, syncedAt: Long = System.currentTimeMillis())
    
    /**
     * Record sync failure
     */
    @Query("""
        UPDATE sync_records 
        SET sync_attempts = sync_attempts + 1, 
            last_error = :error,
            updated_at = :updatedAt
        WHERE id = :id
    """)
    suspend fun recordSyncFailure(id: Long, error: String, updatedAt: Long = System.currentTimeMillis())
    
    /**
     * Reset sync attempts for a record (for manual retry)
     */
    @Query("""
        UPDATE sync_records 
        SET sync_attempts = 0, 
            last_error = NULL,
            updated_at = :updatedAt
        WHERE id = :id
    """)
    suspend fun resetSyncAttempts(id: Long, updatedAt: Long = System.currentTimeMillis())
    
    // =========================================================================
    // DELETE OPERATIONS
    // =========================================================================
    
    /**
     * Delete a record by ID
     */
    @Query("DELETE FROM sync_records WHERE id = :id")
    suspend fun deleteById(id: Long)
    
    /**
     * Delete record by reference number
     */
    @Query("DELETE FROM sync_records WHERE reference_no = :referenceNo")
    suspend fun deleteByReferenceNo(referenceNo: String)
    
    /**
     * Delete all synced records older than specified time (cleanup)
     */
    @Query("DELETE FROM sync_records WHERE is_synced = 1 AND synced_at < :beforeTime")
    suspend fun deleteSyncedOlderThan(beforeTime: Long): Int
    
    /**
     * Delete all records (use with caution!)
     */
    @Query("DELETE FROM sync_records")
    suspend fun deleteAll()
    
    // =========================================================================
    // STATISTICS
    // =========================================================================
    
    /**
     * Get total record count
     */
    @Query("SELECT COUNT(*) FROM sync_records")
    suspend fun getTotalCount(): Int
    
    /**
     * Get synced record count
     */
    @Query("SELECT COUNT(*) FROM sync_records WHERE is_synced = 1")
    suspend fun getSyncedCount(): Int
    
    /**
     * Check if reference number exists
     */
    @Query("SELECT EXISTS(SELECT 1 FROM sync_records WHERE reference_no = :referenceNo)")
    suspend fun existsByReferenceNo(referenceNo: String): Boolean
}
