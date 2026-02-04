package app.delicoop101.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Entity representing a record that needs to be synced with the backend.
 * Used for offline-first data collection.
 */
@Entity(
    tableName = "sync_records",
    indices = [
        Index(value = ["is_synced"]),
        Index(value = ["record_type"]),
        Index(value = ["created_at"]),
        Index(value = ["reference_no"], unique = true)
    ]
)
data class SyncRecord(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    
    @ColumnInfo(name = "reference_no")
    val referenceNo: String,
    
    @ColumnInfo(name = "record_type")
    val recordType: String, // e.g., "milk_collection", "sale", etc.
    
    @ColumnInfo(name = "payload")
    val payload: String, // JSON serialized data
    
    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
    
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis(),
    
    @ColumnInfo(name = "is_synced")
    val isSynced: Boolean = false,
    
    @ColumnInfo(name = "synced_at")
    val syncedAt: Long? = null,
    
    @ColumnInfo(name = "sync_attempts")
    val syncAttempts: Int = 0,
    
    @ColumnInfo(name = "last_error")
    val lastError: String? = null,
    
    @ColumnInfo(name = "backend_id")
    val backendId: Long? = null,
    
    @ColumnInfo(name = "user_id")
    val userId: String? = null,
    
    @ColumnInfo(name = "device_fingerprint")
    val deviceFingerprint: String? = null
)
