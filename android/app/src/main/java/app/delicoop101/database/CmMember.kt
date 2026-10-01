package app.delicoop101.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "cm_members")
data class CmMember(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    @ColumnInfo(name = "descript") val descript: String = "",
    @ColumnInfo(name = "mcode") val mcode: String = "",
    @ColumnInfo(name = "idno") val idno: String = "",
    @ColumnInfo(name = "route") val route: String = "",
    @ColumnInfo(name = "status") val status: Int = 1,
    @ColumnInfo(name = "mstatus") val mstatus: String = "",
    @ColumnInfo(name = "clientFetch") val clientFetch: String? = null,
    @ColumnInfo(name = "clientFetch1") val clientFetch1: String? = null,
    @ColumnInfo(name = "ccode") val ccode: String = "",
    @ColumnInfo(name = "crbal") val crbal: String = "",
    @ColumnInfo(name = "prvqty") val prvqty: Double = 0.0,
    @ColumnInfo(name = "currqty") val currqty: Double = 0.0,
    @ColumnInfo(name = "multOpt") val multOpt: Int = 0
)
