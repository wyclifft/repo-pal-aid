package app.delicoop101.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Entity representing an application log entry.
 * Logs are batched and written asynchronously to avoid blocking the UI.
 */
@Entity(
    tableName = "app_logs",
    indices = [
        Index(value = ["timestamp"]),
        Index(value = ["level"]),
        Index(value = ["tag"])
    ]
)
data class AppLog(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    
    @ColumnInfo(name = "timestamp")
    val timestamp: Long = System.currentTimeMillis(),
    
    @ColumnInfo(name = "level")
    val level: String, // INFO, WARN, ERROR, DEBUG
    
    @ColumnInfo(name = "tag")
    val tag: String,
    
    @ColumnInfo(name = "message")
    val message: String,
    
    @ColumnInfo(name = "extra_data")
    val extraData: String? = null
)
