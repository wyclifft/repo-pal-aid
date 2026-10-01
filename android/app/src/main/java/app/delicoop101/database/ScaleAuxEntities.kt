package app.delicoop101.database

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "cart")
data class Cart(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "icode") val icode: String = "",
    @ColumnInfo(name = "iname") val iname: String = "",
    @ColumnInfo(name = "userId") val userId: String = "",
    @ColumnInfo(name = "clerk") val clerk: String = "",
    @ColumnInfo(name = "route") val route: String = "",
    @ColumnInfo(name = "deviceSerial") val deviceSerial: String = "",
    @ColumnInfo(name = "memberno") val memberno: String = "",
    @ColumnInfo(name = "quantity") val quantity: String = "0",
    @ColumnInfo(name = "price") val price: Double = 0.0,
    @ColumnInfo(name = "session") val session: String = "",
    @ColumnInfo(name = "transdate") val transdate: String = "",
    @ColumnInfo(name = "transtime") val transtime: String = "",
    @ColumnInfo(name = "ccode") val ccode: String = "",
    @ColumnInfo(name = "ivat") val ivat: Double = 0.0,
    @ColumnInfo(name = "iprice") val iprice: Double = 0.0,
    @ColumnInfo(name = "amount") val amount: Double = 0.0,
    @ColumnInfo(name = "cowname") val cowname: String = "",
    @ColumnInfo(name = "cowbreed") val cowbreed: String = "",
    @ColumnInfo(name = "noofcalfs") val noofcalfs: String = "0",
    @ColumnInfo(name = "aibreed") val aibreed: String = ""
)

@Entity(tableName = "cm_credits")
data class CmCredit(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "crcode") val crcode: String = "",
    @ColumnInfo(name = "descript") val descript: String = "",
    @ColumnInfo(name = "ccode") val ccode: String = "",
    @ColumnInfo(name = "coreUpload") val coreUpload: String = "0",
    @ColumnInfo(name = "clientFetch") val clientFetch: String = "0",
    @ColumnInfo(name = "clientFetch1") val clientFetch1: Int = 0
)

@Entity(tableName = "device")
data class DeviceConfig(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "ccode") val ccode: String = "",
    @ColumnInfo(name = "devcode") val devcode: String = "",
    @ColumnInfo(name = "uniquedevcode") val uniquedevcode: String = "",
    @ColumnInfo(name = "milkid") val milkid: Int = 0,
    @ColumnInfo(name = "storeid") val storeid: Int = 0,
    @ColumnInfo(name = "aiid") val aiid: Int = 0,
    @ColumnInfo(name = "trnid") val trnid: Int = 0,
    @ColumnInfo(name = "transdate") val transdate: String = "",
    @ColumnInfo(name = "companyName") val companyName: String = "",
    @ColumnInfo(name = "caddress") val caddress: String = "",
    @ColumnInfo(name = "tel") val tel: String = "",
    @ColumnInfo(name = "email") val email: String = "",
    @ColumnInfo(name = "cno") val cno: String = "",
    @ColumnInfo(name = "chkRoute") val chkRoute: Int = 0,
    @ColumnInfo(name = "stableOpt") val stableOpt: Int = 0,
    @ColumnInfo(name = "sessPrint") val sessPrint: Int = 0,
    @ColumnInfo(name = "autoW") val autoW: Int = 0,
    @ColumnInfo(name = "zeroOpt") val zeroOpt: Int = 0,
    @ColumnInfo(name = "printcumm") val printcumm: Int = 0,
    @ColumnInfo(name = "registrationStatus") val registrationStatus: String = "",
    @ColumnInfo(name = "scaleMac") val scaleMac: String = "",
    @ColumnInfo(name = "printerMac") val printerMac: String = "",
    @ColumnInfo(name = "printerName") val printerName: String = "",
    @ColumnInfo(name = "serviceUUID") val serviceUUID: String = "",
    @ColumnInfo(name = "useInternalBLT") val useInternalBLT: Int = 1,
    @ColumnInfo(name = "syncZReport") val syncZReport: Int = 1,
    @ColumnInfo(name = "lastZReport") val lastZReport: Int = 0
)

@Entity(tableName = "rtinit")
data class RtInit(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "fnname") val fnname: String = "",
    @ColumnInfo(name = "fntag") val fntag: Int = 0,
    @ColumnInfo(name = "fnTerms") val fnTerms: Int = 0
)

@Entity(tableName = "fm_tanks")
data class FmTank(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "tcode") val tcode: String = "",
    @ColumnInfo(name = "descript") val descript: String = "",
    @ColumnInfo(name = "icode") val icode: String = "",
    @ColumnInfo(name = "idesc") val idesc: String = "",
    @ColumnInfo(name = "depart") val depart: String = "",
    @ColumnInfo(name = "ccode") val ccode: String = "",
    @ColumnInfo(name = "cname") val cname: String = "",
    @ColumnInfo(name = "caddress") val caddress: String = "",
    @ColumnInfo(name = "tel") val tel: String = "",
    @ColumnInfo(name = "email") val email: String = "",
    @ColumnInfo(name = "printOptions") val printOptions: String = "3",
    @ColumnInfo(name = "clientFetch") val clientFetch: Int? = 1,
    @ColumnInfo(name = "mprefix") val mprefix: String = "M"
)

@Entity(tableName = "session")
data class ActiveSession(
    @PrimaryKey val id: Long = 0,
    @ColumnInfo(name = "username") val username: String = "",
    @ColumnInfo(name = "user") val user: String = "",
    @ColumnInfo(name = "userId") val userId: String = "",
    @ColumnInfo(name = "createdAt") val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "logoutAt") val logoutAt: Long = 0,
    @ColumnInfo(name = "scaleMac") val scaleMac: String = "",
    @ColumnInfo(name = "printerMac") val printerMac: String = "",
    @ColumnInfo(name = "printerName") val printerName: String = "",
    @ColumnInfo(name = "serviceUUID") val serviceUUID: String = "",
    @ColumnInfo(name = "useInternalBLT") val useInternalBLT: Int = 1,
    @ColumnInfo(name = "syncZReport") val syncZReport: Int = 1,
    @ColumnInfo(name = "lastZReport") val lastZReport: Int = 0,
    @ColumnInfo(name = "supervisor") val supervisor: Int = 0
)

@Entity(tableName = "milk_session")
data class MilkSession(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "session_date") val sessionDate: String = "",
    @ColumnInfo(name = "username") val username: String = "",
    @ColumnInfo(name = "user_id") val userId: String = "",
    @ColumnInfo(name = "route") val route: String = "",
    @ColumnInfo(name = "route_name") val routeName: String = "",
    @ColumnInfo(name = "session") val session: String = "",
    @ColumnInfo(name = "milk_can") val milkCan: String = "",
    @ColumnInfo(name = "milk_ref") val milkRef: String = ""
)

@Entity(tableName = "sess")
data class Sess(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "ccode") val ccode: String = "",
    @ColumnInfo(name = "descript") val descript: String = "",
    @ColumnInfo(name = "time_from") val timeFrom: Int = 0,
    @ColumnInfo(name = "time_to") val timeTo: Int = 0,
    @ColumnInfo(name = "icode", defaultValue = "''") val icode: String = ""
)

@Entity(tableName = "ai_transaction")
data class AiTransaction(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "deviceCode") val deviceCode: String = "",
    @ColumnInfo(name = "memberNumber") val memberNumber: String = ""
)

@Entity(tableName = "milk_transaction")
data class MilkTransaction(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "deviceCode") val deviceCode: String = "",
    @ColumnInfo(name = "memberNumber") val memberNumber: String = ""
)

@Entity(tableName = "store_transaction")
data class StoreTransaction(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "deviceCode") val deviceCode: String = "",
    @ColumnInfo(name = "memberNumber") val memberNumber: String = "",
    @ColumnInfo(name = "transactionType") val transactionType: String = ""
)

@Entity(tableName = "Seasons")
data class Season(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "ccode") val ccode: String = "",
    @ColumnInfo(name = "scode") val scode: String = "",
    @ColumnInfo(name = "descript") val descript: String = "",
    @ColumnInfo(name = "date_from") val dateFrom: String = "",
    @ColumnInfo(name = "date_to") val dateTo: String = ""
)
