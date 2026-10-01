package app.delicoop101.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "em_transaction")
data class EmTransaction(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    @ColumnInfo(name = "transrefno") val transrefno: String = "",
    @ColumnInfo(name = "userId") val userId: String = "",
    @ColumnInfo(name = "clerk") val clerk: String = "",
    @ColumnInfo(name = "deviceserial") val deviceserial: String = "",
    @ColumnInfo(name = "memberno") val memberno: String = "",
    @ColumnInfo(name = "route") val route: String = "",
    @ColumnInfo(name = "weight") val weight: Double = 0.0,
    @ColumnInfo(name = "session") val session: String = "",
    @ColumnInfo(name = "transdate") val transdate: String = "",
    @ColumnInfo(name = "transtime") val transtime: String = "",
    @ColumnInfo(name = "CAN") val CAN: String = "",
    @ColumnInfo(name = "Transtype") val Transtype: String = "",
    @ColumnInfo(name = "Uploadrefno") val Uploadrefno: String = "",
    @ColumnInfo(name = "processed") val processed: Int = 0,
    @ColumnInfo(name = "uploaded") val uploaded: Int = 0,
    @ColumnInfo(name = "ccode") val ccode: String = "",
    @ColumnInfo(name = "ivat") val ivat: Double = 0.0,
    @ColumnInfo(name = "iprice") val iprice: Double = 0.0,
    @ColumnInfo(name = "amount") val amount: Double = 0.0,
    @ColumnInfo(name = "icode") val icode: String = "",
    @ColumnInfo(name = "cowname") val cowname: String = "",
    @ColumnInfo(name = "cowbreed") val cowbreed: String = "",
    @ColumnInfo(name = "noofcalfs") val noofcalfs: Int = 0,
    @ColumnInfo(name = "aibreed") val aibreed: String = "",
    @ColumnInfo(name = "milk_session_id") val milkSessionId: String = "",
    @ColumnInfo(name = "time") val time: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "c_route") val cRoute: String = "",
    @ColumnInfo(name = "capType") val capType: Int = 1,
    @ColumnInfo(name = "onlineMode") val onlineMode: Int = 0
)
