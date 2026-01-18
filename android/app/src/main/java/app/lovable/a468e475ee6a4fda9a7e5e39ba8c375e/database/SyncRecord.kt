package app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Entity representing a record that needs to be synced with the remote backend.
 * Each record stores its data as JSON and tracks its sync status.
 * 
 * The local database acts as the source of truth, with the remote server as secondary.
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
    /**
     * Unique local ID - auto-generated, never changes
     */
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0,
    
    /**
     * Reference number for deduplication (e.g., transaction reference)
     */
    @ColumnInfo(name = "reference_no")
    val referenceNo: String,
    
    /**
     * Type of record: "milk_collection", "store_sale", "ai_sale", "farmer", etc.
     */
    @ColumnInfo(name = "record_type")
    val recordType: String,
    
    /**
     * Full payload data stored as JSON string
     */
    @ColumnInfo(name = "payload")
    val payload: String,
    
    /**
     * Timestamp when the record was created locally
     */
    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
    
    /**
     * Timestamp when the record was last modified
     */
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis(),
    
    /**
     * Whether this record has been successfully synced to the backend
     * Default: false - all new records start as unsynced
     */
    @ColumnInfo(name = "is_synced")
    val isSynced: Boolean = false,
    
    /**
     * Timestamp of last successful sync (null if never synced)
     */
    @ColumnInfo(name = "synced_at")
    val syncedAt: Long? = null,
    
    /**
     * Number of sync attempts (for retry logic)
     */
    @ColumnInfo(name = "sync_attempts")
    val syncAttempts: Int = 0,
    
    /**
     * Last sync error message (null if no errors)
     */
    @ColumnInfo(name = "last_error")
    val lastError: String? = null,
    
    /**
     * Backend ID returned after successful sync (null if not yet synced)
     */
    @ColumnInfo(name = "backend_id")
    val backendId: Long? = null,
    
    /**
     * User ID who created this record
     */
    @ColumnInfo(name = "user_id")
    val userId: String? = null,
    
    /**
     * Device fingerprint for multi-device support
     */
    @ColumnInfo(name = "device_fingerprint")
    val deviceFingerprint: String? = null
)
