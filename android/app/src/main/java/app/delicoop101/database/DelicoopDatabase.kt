package app.delicoop101.database

import android.content.Context
import android.util.Log
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import net.sqlcipher.database.SQLiteDatabase
import net.sqlcipher.database.SupportFactory
import java.security.SecureRandom

/**
 * Main Room database for the DeliCoop101 app.
 * Uses SQLCipher for encryption at rest.
 * 
 * Database name: delicoop101_database
 * This is the single source of truth for all app data.
 * 
 * To access this database externally:
 * 1. Use Android Studio Device File Explorer
 * 2. Navigate to /data/data/app.delicoop101/databases/delicoop101_database
 * 3. The encryption key is in /data/data/app.delicoop101/shared_prefs/delicoop_db_prefs.xml
 * 4. Use DB Browser for SQLCipher to open with the key
 */
@Database(
    entities = [SyncRecord::class, AppLog::class],
    version = 2,
    exportSchema = true
)
abstract class DelicoopDatabase : RoomDatabase() {
    
    abstract fun syncRecordDao(): SyncRecordDao
    abstract fun appLogDao(): AppLogDao
    
    companion object {
        private const val TAG = "DelicoopDatabase"
        private const val DATABASE_NAME = "delicoop101_database"
        private const val PREFS_NAME = "delicoop_db_prefs"
        private const val KEY_DB_KEY = "db_encryption_key"
        
        @Volatile
        private var INSTANCE: DelicoopDatabase? = null
        
        /**
         * Migration from version 1 to 2.
         * Preserves all existing data instead of destructive fallback.
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
                Log.d(TAG, "[DB] Migration 1 -> 2 complete")
            }
        }
        
        /**
         * Get the singleton database instance.
         * Creates and OPENS the encrypted database on first access.
         */
        fun getInstance(context: Context): DelicoopDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: buildDatabase(context).also { db ->
                    INSTANCE = db
                    // Force the database to actually open NOW (Room is lazy by default)
                    // This ensures tables exist and the DB file is created immediately
                    forceOpen(db)
                }
            }
        }
        
        /**
         * Force Room to open the database immediately.
         * Without this, Room only opens on the first DAO query,
         * which can cause data loss if the first write races with initialization.
         */
        private fun forceOpen(db: DelicoopDatabase) {
            try {
                // openHelper.writableDatabase forces Room to create/open the SQLite file
                db.openHelper.writableDatabase
                Log.d(TAG, "[DB] Database file opened and tables verified")
            } catch (e: Exception) {
                Log.e(TAG, "[DB] CRITICAL: Failed to force-open database: ${e.message}", e)
            }
        }
        
        /**
         * Build the encrypted Room database.
         * Uses SQLCipher for encryption at rest with a single consistent key.
         * Uses explicit migrations to NEVER destroy existing data.
         * Enables WAL journal mode for faster writes and crash safety.
         */
        private fun buildDatabase(context: Context): DelicoopDatabase {
            val passphrase = getOrCreateDatabaseKey(context)
            val factory = SupportFactory(SQLiteDatabase.getBytes(passphrase.toCharArray()))
            
            Log.d(TAG, "[DB] Building encrypted database: $DATABASE_NAME")
            
            return Room.databaseBuilder(
                context.applicationContext,
                DelicoopDatabase::class.java,
                DATABASE_NAME
            )
                .openHelperFactory(factory)
                .addMigrations(MIGRATION_1_2)
                // Only use destructive fallback as absolute last resort for unknown versions
                .fallbackToDestructiveMigrationOnDowngrade()
                // Enable WAL journal mode for better write performance and crash resilience
                .setJournalMode(JournalMode.WRITE_AHEAD_LOGGING)
                .build()
                .also {
                    Log.d(TAG, "[DB] Database builder created successfully")
                }
        }
        
        /**
         * Generate or retrieve the database encryption key.
         * The key is stored in SharedPreferences and NEVER regenerated.
         * A single consistent key ensures exported databases are never blank.
         * 
         * To retrieve the key for external database access:
         * 1. Use Android Studio Device File Explorer
         * 2. Navigate to /data/data/app.delicoop101/shared_prefs/delicoop_db_prefs.xml
         * 3. The key is in the 'db_encryption_key' field (64-character hex string)
         */
        private fun getOrCreateDatabaseKey(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            
            var key = prefs.getString(KEY_DB_KEY, null)
            if (key == null || key.length != 64) {
                val random = SecureRandom()
                val bytes = ByteArray(32)
                random.nextBytes(bytes)
                key = bytes.joinToString("") { "%02x".format(it) }
                
                // Store the key with commit (synchronous) to ensure it's written
                // BEFORE the database tries to use it
                prefs.edit().putString(KEY_DB_KEY, key).commit()
                Log.d(TAG, "[DB] Generated new encryption key (length=${key.length})")
            } else {
                Log.d(TAG, "[DB] Using existing encryption key (length=${key.length})")
            }
            
            return key
        }
        
        /**
         * Close the database connection.
         * Call this when the app is being destroyed.
         */
        fun closeDatabase() {
            synchronized(this) {
                INSTANCE?.close()
                INSTANCE = null
                Log.d(TAG, "[DB] Database closed")
            }
        }
        
        /**
         * Check if database is initialized
         */
        fun isInitialized(): Boolean = INSTANCE != null
    }
}
