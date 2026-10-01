package app.delicoop101.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "transaction_group")
data class TransactionGroup(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    @ColumnInfo(name = "username") val username: String = "",
    @ColumnInfo(name = "session_ref") val sessionRef: String = "",
    @ColumnInfo(name = "session") val session: String = "",
    @ColumnInfo(name = "session_string") val sessionString: String = "",
    @ColumnInfo(name = "created_at") val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "date_created") val dateCreated: String = ""
)
