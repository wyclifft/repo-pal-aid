package app.delicoop101.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Entity for storing application logs.
 * Logs are batched and written asynchronously to avoid performance impact.
 */
@Entity(
    tableName = "app_logs",
    indices = [
        Index(value = ["level"]),
        Index(value = ["tag"]),
        Index(value = ["created_at"])
    ]
)
data class LogRecord(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    
    @ColumnInfo(name = "level")
    val level: String, // DEBUG, INFO, WARN, ERROR
    
    @ColumnInfo(name = "tag")
    val tag: String,
    
    @ColumnInfo(name = "message")
    val message: String,
    
    @ColumnInfo(name = "stack_trace")
    val stackTrace: String? = null,
    
    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
    
    @ColumnInfo(name = "device_info")
    val deviceInfo: String? = null,
    
    @ColumnInfo(name = "session_id")
    val sessionId: String? = null
)
