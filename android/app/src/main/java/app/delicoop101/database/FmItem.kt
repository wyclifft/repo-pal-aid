package app.delicoop101.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "fm_items")
data class FmItem(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    @ColumnInfo(name = "icode") val icode: String = "",
    @ColumnInfo(name = "descript") val descript: String = "",
    @ColumnInfo(name = "sprice") val sprice: Double = 0.0,
    @ColumnInfo(name = "mprice") val mprice: Double = 0.0,
    @ColumnInfo(name = "stockbal") val stockbal: Double = 0.0,
    @ColumnInfo(name = "ccode") val ccode: String = "",
    @ColumnInfo(name = "coreUpload") val coreUpload: Int = 0,
    @ColumnInfo(name = "clientFetch") val clientFetch: Int = 0,
    @ColumnInfo(name = "clientFetch1") val clientFetch1: Int = 0,
    @ColumnInfo(name = "invtype") val invtype: String = ""
)
