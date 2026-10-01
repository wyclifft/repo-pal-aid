package app.delicoop101.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "Users")
data class UserEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    @ColumnInfo(name = "userid") val userid: String = "",
    @ColumnInfo(name = "username") val username: String = "",
    @ColumnInfo(name = "password") val password: String = "",
    @ColumnInfo(name = "groupid") val groupid: String = "1",
    @ColumnInfo(name = "supervisor") val supervisor: Int = 0,
    @ColumnInfo(name = "astatus") val astatus: Int = 1,
    @ColumnInfo(name = "c_password") val cPassword: String = "",
    @ColumnInfo(name = "coreUpload") val coreUpload: Int = 0,
    @ColumnInfo(name = "clientFetch") val clientFetch: Int = 0,
    @ColumnInfo(name = "email") val email: String = "",
    @ColumnInfo(name = "ccode") val ccode: String = ""
)
