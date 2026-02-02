package app.delicoop101.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

/**
 * Data Access Object for log records.
 * Supports batch operations for performance.
 */
@Dao
interface LogRecordDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(log: LogRecord): Long
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(logs: List<LogRecord>)
    
    @Query("SELECT * FROM app_logs ORDER BY created_at DESC LIMIT :limit")
    suspend fun getRecentLogs(limit: Int = 100): List<LogRecord>
    
    @Query("SELECT * FROM app_logs WHERE level = :level ORDER BY created_at DESC LIMIT :limit")
    suspend fun getLogsByLevel(level: String, limit: Int = 100): List<LogRecord>
    
    @Query("SELECT * FROM app_logs WHERE tag = :tag ORDER BY created_at DESC LIMIT :limit")
    suspend fun getLogsByTag(tag: String, limit: Int = 100): List<LogRecord>
    
    @Query("SELECT * FROM app_logs WHERE created_at >= :startTime AND created_at <= :endTime ORDER BY created_at DESC")
    suspend fun getLogsByTimeRange(startTime: Long, endTime: Long): List<LogRecord>
    
    @Query("SELECT COUNT(*) FROM app_logs")
    suspend fun getLogCount(): Int
    
    @Query("DELETE FROM app_logs WHERE created_at < :timestamp")
    suspend fun deleteOldLogs(timestamp: Long): Int
    
    @Query("DELETE FROM app_logs")
    suspend fun deleteAllLogs()
    
    @Query("SELECT * FROM app_logs WHERE message LIKE '%' || :query || '%' OR tag LIKE '%' || :query || '%' ORDER BY created_at DESC LIMIT :limit")
    suspend fun searchLogs(query: String, limit: Int = 100): List<LogRecord>
}
