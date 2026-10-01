package app.delicoop101.database

import android.content.Context
import android.util.Log
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Main Room database for the DeliCoop101 app matching scale structure (`rt_scale_AH04.db`).
 * Operating in unencrypted single-file mode (JournalMode.TRUNCATE).
 *
 * Database name format: delicoop101_database_{devcode} (e.g. delicoop101_database_AH04)
 */
@Database(
    entities = [
        SyncRecord::class,
        AppLog::class,
        EmTransaction::class,
        CmMember::class,
        FmItem::class,
        UserEntity::class,
        TransactionGroup::class,
        Cart::class,
        CmCredit::class,
        DeviceConfig::class,
        RtInit::class,
        FmTank::class,
        ActiveSession::class,
        MilkSession::class,
        Sess::class,
        AiTransaction::class,
        MilkTransaction::class,
        StoreTransaction::class,
        Season::class
    ],
    version = 3,
    exportSchema = true
)
abstract class DelicoopDatabase : RoomDatabase() {

    abstract fun syncRecordDao(): SyncRecordDao
    abstract fun appLogDao(): AppLogDao
    abstract fun emTransactionDao(): EmTransactionDao
    abstract fun cmMemberDao(): CmMemberDao
    abstract fun fmItemDao(): FmItemDao
    abstract fun userDao(): UserDao
    abstract fun transactionGroupDao(): TransactionGroupDao
    abstract fun cartDao(): CartDao
    abstract fun deviceConfigDao(): DeviceConfigDao
    abstract fun activeSessionDao(): ActiveSessionDao
    abstract fun milkTransactionDao(): MilkTransactionDao
    abstract fun fmTankDao(): FmTankDao
    abstract fun sessDao(): SessDao

    companion object {
        private const val TAG = "DelicoopDatabase"
        private const val BASE_DATABASE_NAME = "delicoop101_database"
        private const val PREFS_NAME = "delicoop_db_prefs"
        private const val KEY_DEVCODE = "devcode"
        private const val DEFAULT_DEVCODE = "AH04"

        @Volatile
        private var INSTANCE: DelicoopDatabase? = null
        private val isOpened = AtomicBoolean(false)

        /**
         * Migration from version 1 to 2.
         * Preserves existing sync_records while creating app_logs.
         */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                Log.d(TAG, "[DB] Running migration 1 -> 2")
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS app_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        timestamp INTEGER NOT NULL,
                        level TEXT NOT NULL,
                        tag TEXT NOT NULL,
                        message TEXT NOT NULL,
                        extra_data TEXT
                    )
                """)
                db.execSQL("CREATE INDEX IF NOT EXISTS index_app_logs_timestamp ON app_logs (timestamp)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_app_logs_level ON app_logs (level)")
                db.execSQL("CREATE INDEX IF NOT EXISTS index_app_logs_tag ON app_logs (tag)")
            }
        }

        /**
         * Migration from version 2 to 3.
         * Creates scale database structure tables matching rt_scale_AH04.db without losing existing data.
         */
        private val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                Log.d(TAG, "[DB] Running migration 2 -> 3 for scale schema parity")
                
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS em_transaction (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        transrefno TEXT NOT NULL DEFAULT '',
                        userId TEXT NOT NULL DEFAULT '',
                        clerk TEXT NOT NULL DEFAULT '',
                        deviceserial TEXT NOT NULL DEFAULT '',
                        memberno TEXT NOT NULL DEFAULT '',
                        route TEXT NOT NULL DEFAULT '',
                        weight REAL NOT NULL DEFAULT 0.0,
                        session TEXT NOT NULL DEFAULT '',
                        transdate TEXT NOT NULL DEFAULT '',
                        transtime TEXT NOT NULL DEFAULT '',
                        CAN TEXT NOT NULL DEFAULT '',
                        Transtype TEXT NOT NULL DEFAULT '',
                        Uploadrefno TEXT NOT NULL DEFAULT '',
                        processed INTEGER NOT NULL DEFAULT 0,
                        uploaded INTEGER NOT NULL DEFAULT 0,
                        ccode TEXT NOT NULL DEFAULT '',
                        ivat REAL NOT NULL DEFAULT 0.0,
                        iprice REAL NOT NULL DEFAULT 0.0,
                        amount REAL NOT NULL DEFAULT 0.0,
                        icode TEXT NOT NULL DEFAULT '',
                        cowname TEXT NOT NULL DEFAULT '',
                        cowbreed TEXT NOT NULL DEFAULT '',
                        noofcalfs INTEGER NOT NULL DEFAULT 0,
                        aibreed TEXT NOT NULL DEFAULT '',
                        milk_session_id TEXT NOT NULL DEFAULT '',
                        time INTEGER NOT NULL DEFAULT 0,
                        c_route TEXT NOT NULL DEFAULT '',
                        capType INTEGER NOT NULL DEFAULT 1,
                        onlineMode INTEGER NOT NULL DEFAULT 0
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS cm_members (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        descript TEXT NOT NULL DEFAULT '',
                        mcode TEXT NOT NULL DEFAULT '',
                        idno TEXT NOT NULL DEFAULT '',
                        route TEXT NOT NULL DEFAULT '',
                        status INTEGER NOT NULL DEFAULT 1,
                        mstatus TEXT NOT NULL DEFAULT '',
                        clientFetch TEXT,
                        clientFetch1 TEXT,
                        ccode TEXT NOT NULL DEFAULT '',
                        crbal TEXT NOT NULL DEFAULT '',
                        prvqty REAL NOT NULL DEFAULT 0.0,
                        currqty REAL NOT NULL DEFAULT 0.0,
                        multOpt INTEGER NOT NULL DEFAULT 0
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS fm_items (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        icode TEXT NOT NULL DEFAULT '',
                        descript TEXT NOT NULL DEFAULT '',
                        sprice REAL NOT NULL DEFAULT 0.0,
                        mprice REAL NOT NULL DEFAULT 0.0,
                        stockbal REAL NOT NULL DEFAULT 0.0,
                        ccode TEXT NOT NULL DEFAULT '',
                        coreUpload INTEGER NOT NULL DEFAULT 0,
                        clientFetch INTEGER NOT NULL DEFAULT 0,
                        clientFetch1 INTEGER NOT NULL DEFAULT 0,
                        invtype TEXT NOT NULL DEFAULT ''
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS Users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        userid TEXT NOT NULL DEFAULT '',
                        username TEXT NOT NULL DEFAULT '',
                        password TEXT NOT NULL DEFAULT '',
                        groupid TEXT NOT NULL DEFAULT '1',
                        supervisor INTEGER NOT NULL DEFAULT 0,
                        astatus INTEGER NOT NULL DEFAULT 1,
                        c_password TEXT NOT NULL DEFAULT '',
                        coreUpload INTEGER NOT NULL DEFAULT 0,
                        clientFetch INTEGER NOT NULL DEFAULT 0,
                        email TEXT NOT NULL DEFAULT '',
                        ccode TEXT NOT NULL DEFAULT ''
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS transaction_group (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        username TEXT NOT NULL DEFAULT '',
                        session_ref TEXT NOT NULL DEFAULT '',
                        session TEXT NOT NULL DEFAULT '',
                        session_string TEXT NOT NULL DEFAULT '',
                        created_at INTEGER NOT NULL DEFAULT 0,
                        date_created TEXT NOT NULL DEFAULT ''
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS cart (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        icode TEXT NOT NULL DEFAULT '',
                        iname TEXT NOT NULL DEFAULT '',
                        userId TEXT NOT NULL DEFAULT '',
                        clerk TEXT NOT NULL DEFAULT '',
                        route TEXT NOT NULL DEFAULT '',
                        deviceSerial TEXT NOT NULL DEFAULT '',
                        memberno TEXT NOT NULL DEFAULT '',
                        quantity TEXT NOT NULL DEFAULT '0',
                        price REAL NOT NULL DEFAULT 0.0,
                        session TEXT NOT NULL DEFAULT '',
                        transdate TEXT NOT NULL DEFAULT '',
                        transtime TEXT NOT NULL DEFAULT '',
                        ccode TEXT NOT NULL DEFAULT '',
                        ivat REAL NOT NULL DEFAULT 0.0,
                        iprice REAL NOT NULL DEFAULT 0.0,
                        amount REAL NOT NULL DEFAULT 0.0,
                        cowname TEXT NOT NULL DEFAULT '',
                        cowbreed TEXT NOT NULL DEFAULT '',
                        noofcalfs TEXT NOT NULL DEFAULT '0',
                        aibreed TEXT NOT NULL DEFAULT ''
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS cm_credits (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        crcode TEXT NOT NULL DEFAULT '',
                        descript TEXT NOT NULL DEFAULT '',
                        ccode TEXT NOT NULL DEFAULT '',
                        coreUpload TEXT NOT NULL DEFAULT '0',
                        clientFetch TEXT NOT NULL DEFAULT '0',
                        clientFetch1 INTEGER NOT NULL DEFAULT 0
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS device (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        ccode TEXT NOT NULL DEFAULT '',
                        devcode TEXT NOT NULL DEFAULT '',
                        uniquedevcode TEXT NOT NULL DEFAULT '',
                        milkid INTEGER NOT NULL DEFAULT 0,
                        storeid INTEGER NOT NULL DEFAULT 0,
                        aiid INTEGER NOT NULL DEFAULT 0,
                        trnid INTEGER NOT NULL DEFAULT 0,
                        transdate TEXT NOT NULL DEFAULT '',
                        companyName TEXT NOT NULL DEFAULT '',
                        caddress TEXT NOT NULL DEFAULT '',
                        tel TEXT NOT NULL DEFAULT '',
                        email TEXT NOT NULL DEFAULT '',
                        cno TEXT NOT NULL DEFAULT '',
                        chkRoute INTEGER NOT NULL DEFAULT 0,
                        stableOpt INTEGER NOT NULL DEFAULT 0,
                        sessPrint INTEGER NOT NULL DEFAULT 0,
                        autoW INTEGER NOT NULL DEFAULT 0,
                        zeroOpt INTEGER NOT NULL DEFAULT 0,
                        printcumm INTEGER NOT NULL DEFAULT 0,
                        registrationStatus TEXT NOT NULL DEFAULT '',
                        scaleMac TEXT NOT NULL DEFAULT '',
                        printerMac TEXT NOT NULL DEFAULT '',
                        printerName TEXT NOT NULL DEFAULT '',
                        serviceUUID TEXT NOT NULL DEFAULT '',
                        useInternalBLT INTEGER NOT NULL DEFAULT 1,
                        syncZReport INTEGER NOT NULL DEFAULT 1,
                        lastZReport INTEGER NOT NULL DEFAULT 0
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS rtinit (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        fnname TEXT NOT NULL DEFAULT '',
                        fntag INTEGER NOT NULL DEFAULT 0,
                        fnTerms INTEGER NOT NULL DEFAULT 0
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS fm_tanks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        tcode TEXT NOT NULL DEFAULT '',
                        descript TEXT NOT NULL DEFAULT '',
                        icode TEXT NOT NULL DEFAULT '',
                        idesc TEXT NOT NULL DEFAULT '',
                        depart TEXT NOT NULL DEFAULT '',
                        ccode TEXT NOT NULL DEFAULT '',
                        cname TEXT NOT NULL DEFAULT '',
                        caddress TEXT NOT NULL DEFAULT '',
                        tel TEXT NOT NULL DEFAULT '',
                        email TEXT NOT NULL DEFAULT '',
                        printOptions TEXT NOT NULL DEFAULT '3',
                        clientFetch INTEGER DEFAULT 1,
                        mprefix TEXT NOT NULL DEFAULT 'M'
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS session (
                        id INTEGER PRIMARY KEY NOT NULL,
                        username TEXT NOT NULL DEFAULT '',
                        user TEXT NOT NULL DEFAULT '',
                        userId TEXT NOT NULL DEFAULT '',
                        createdAt INTEGER NOT NULL DEFAULT 0,
                        logoutAt INTEGER NOT NULL DEFAULT 0,
                        scaleMac TEXT NOT NULL DEFAULT '',
                        printerMac TEXT NOT NULL DEFAULT '',
                        printerName TEXT NOT NULL DEFAULT '',
                        serviceUUID TEXT NOT NULL DEFAULT '',
                        useInternalBLT INTEGER NOT NULL DEFAULT 1,
                        syncZReport INTEGER NOT NULL DEFAULT 1,
                        lastZReport INTEGER NOT NULL DEFAULT 0,
                        supervisor INTEGER NOT NULL DEFAULT 0
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS milk_session (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        session_date TEXT NOT NULL DEFAULT '',
                        username TEXT NOT NULL DEFAULT '',
                        user_id TEXT NOT NULL DEFAULT '',
                        route TEXT NOT NULL DEFAULT '',
                        route_name TEXT NOT NULL DEFAULT '',
                        session TEXT NOT NULL DEFAULT '',
                        milk_can TEXT NOT NULL DEFAULT '',
                        milk_ref TEXT NOT NULL DEFAULT ''
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS sess (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        ccode TEXT NOT NULL DEFAULT '',
                        descript TEXT NOT NULL DEFAULT '',
                        time_from INTEGER NOT NULL DEFAULT 0,
                        time_to INTEGER NOT NULL DEFAULT 0,
                        icode TEXT NOT NULL DEFAULT ''
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS ai_transaction (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        deviceCode TEXT NOT NULL DEFAULT '',
                        memberNumber TEXT NOT NULL DEFAULT ''
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS milk_transaction (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        deviceCode TEXT NOT NULL DEFAULT '',
                        memberNumber TEXT NOT NULL DEFAULT ''
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS store_transaction (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        deviceCode TEXT NOT NULL DEFAULT '',
                        memberNumber TEXT NOT NULL DEFAULT '',
                        transactionType TEXT NOT NULL DEFAULT ''
                    )
                """)

                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS Seasons (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        ccode TEXT NOT NULL DEFAULT '',
                        scode TEXT NOT NULL DEFAULT '',
                        descript TEXT NOT NULL DEFAULT '',
                        date_from TEXT NOT NULL DEFAULT '',
                        date_to TEXT NOT NULL DEFAULT ''
                    )
                """)
                
                Log.d(TAG, "[DB] Migration 2 -> 3 complete")
            }
        }

        /**
         * Get the singleton database instance.
         */
        fun getInstance(context: Context): DelicoopDatabase {
            val instance = INSTANCE ?: synchronized(this) {
                INSTANCE ?: buildDatabase(context).also { db ->
                    INSTANCE = db
                }
            }
            forceOpen(instance)
            return instance
        }

        /**
         * Resolve dynamic database name: delicoop101_database_{devcode}
         */
        fun getDatabaseName(context: Context): String {
            val devCode = getDeviceCode(context)
            val dbName = "${BASE_DATABASE_NAME}_${devCode}"
            Log.d(TAG, "[DB] Resolved dynamic database name: $dbName")
            return dbName
        }

        /**
         * Retrieve configured device code from SharedPreferences
         */
        fun getDeviceCode(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val rawCode = prefs.getString(KEY_DEVCODE, null) 
                ?: prefs.getString("deviceCode", null) 
                ?: DEFAULT_DEVCODE
            return rawCode.replace("[^a-zA-Z0-9]".toRegex(), "").ifEmpty { DEFAULT_DEVCODE }
        }

        /**
         * Update the stored device code and return the new database name
         */
        fun setDeviceCode(context: Context, devCode: String) {
            val sanitized = devCode.replace("[^a-zA-Z0-9]".toRegex(), "").ifEmpty { DEFAULT_DEVCODE }
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_DEVCODE, sanitized)
                .commit()
            Log.d(TAG, "[DB] Saved device code: $sanitized")
        }

        private fun forceOpen(db: DelicoopDatabase) {
            if (isOpened.compareAndSet(false, true)) {
                try {
                    db.openHelper.writableDatabase
                    Log.d(TAG, "[DB] Database file opened and schema verified")
                } catch (e: Exception) {
                    Log.e(TAG, "[DB] Failed to force-open database: ${e.message}", e)
                }
            }
        }

        /**
         * Build the unencrypted single-file Room database (JournalMode.TRUNCATE).
         */
        private fun buildDatabase(context: Context): DelicoopDatabase {
            val appContext = context.applicationContext
            
            // Check if internal DB was cleared/wiped and auto-restore from external storage
            DatabaseBackupManager.restoreIfNeeded(appContext)

            val dbName = getDatabaseName(appContext)
            Log.d(TAG, "[DB] Building unencrypted single-file database: $dbName")

            return Room.databaseBuilder(
                appContext,
                DelicoopDatabase::class.java,
                dbName
            )
                .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
                // Single file mode (no .wal or .shm sidecar files)
                .setJournalMode(JournalMode.TRUNCATE)
                .build()
        }

        fun closeDatabase() {
            synchronized(this) {
                INSTANCE?.close()
                INSTANCE = null
                isOpened.set(false)
                Log.d(TAG, "[DB] Database connection closed")
            }
        }

        fun isInitialized(): Boolean = INSTANCE != null
    }

    /**
     * Purges transaction records older than specified days (default 60 days / 2 months).
     * Preserves master reference data (cm_members, Users, fm_items, etc.).
     */
    suspend fun pruneOldTransactions(days: Int = 60) {
        try {
            val purgedTx = emTransactionDao().deleteOlderThan60Days()
            val purgedGrp = transactionGroupDao().deleteOlderThan60Days()
            
            val cutOffTimestamp = System.currentTimeMillis() - (days * 86400000L)
            val purgedLogs = appLogDao().deleteOldLogs(cutOffTimestamp)

            Log.d(TAG, "[DB] Pruning 60-day old data completed: $purgedTx transactions, $purgedGrp groups, $purgedLogs logs purged")

            // Reclaim freed storage space in single .db file
            openHelper.writableDatabase.execSQL("VACUUM;")
            Log.d(TAG, "[DB] VACUUM execution completed successfully")
        } catch (e: Exception) {
            Log.e(TAG, "[DB] Error during old data pruning: ${e.message}", e)
        }
    }
}
