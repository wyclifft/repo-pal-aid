package app.delicoop101.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

/**
 * Data Access Object for app_logs table.
 * Provides methods for batched log insertion and maintenance.
 */
@Dao
interface AppLogDao {
    
    /**
     * Insert a batch of log entries efficiently
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(logs: List<AppLog>)
    
    /**
     * Insert a single log entry
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(log: AppLog)
    
    /**
     * Get recent logs (for debugging)
     */
    @Query("SELECT * FROM app_logs ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getRecentLogs(limit: Int = 100): List<AppLog>
    
    /**
     * Get logs by level
     */
    @Query("SELECT * FROM app_logs WHERE level = :level ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getLogsByLevel(level: String, limit: Int = 100): List<AppLog>
    
    /**
     * Get total log count
     */
    @Query("SELECT COUNT(*) FROM app_logs")
    suspend fun getLogCount(): Int
    
    /**
     * Delete logs older than specified timestamp (for maintenance)
     */
    @Query("DELETE FROM app_logs WHERE timestamp < :olderThan")
    suspend fun deleteOldLogs(olderThan: Long): Int
    
    /**
     * Keep only the most recent N logs (for maintenance)
     */
    @Query("""
        DELETE FROM app_logs WHERE id NOT IN (
            SELECT id FROM app_logs ORDER BY timestamp DESC LIMIT :keepCount
        )
    """)
    suspend fun keepRecentLogs(keepCount: Int = 10000): Int
    
    /**
     * Clear all logs
     */
    @Query("DELETE FROM app_logs")
    suspend fun clearAll()
}
