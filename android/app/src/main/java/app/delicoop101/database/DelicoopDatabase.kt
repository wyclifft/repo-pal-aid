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
 */
@Database(
    entities = [SyncRecord::class, LogRecord::class],
    version = 2,
    exportSchema = true
)
abstract class DelicoopDatabase : RoomDatabase() {
    
    abstract fun syncRecordDao(): SyncRecordDao
    abstract fun logRecordDao(): LogRecordDao
    
    companion object {
        private const val TAG = "DelicoopDatabase"
        private const val DATABASE_NAME = "delicoop101_database"
        private const val PREFS_NAME = "delicoop_db_prefs"
        private const val KEY_DB_KEY = "db_encryption_key"
        
        @Volatile
        private var INSTANCE: DelicoopDatabase? = null
        
        /**
         * Migration from version 1 to 2: Add app_logs table
         */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                Log.d(TAG, "[DB] Running migration 1 -> 2: Adding app_logs table")
                
                database.execSQL("""
                    CREATE TABLE IF NOT EXISTS app_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        level TEXT NOT NULL,
                        tag TEXT NOT NULL,
                        message TEXT NOT NULL,
                        stack_trace TEXT,
                        created_at INTEGER NOT NULL,
                        device_info TEXT,
                        session_id TEXT
                    )
                """)
                
                database.execSQL("CREATE INDEX IF NOT EXISTS index_app_logs_level ON app_logs (level)")
                database.execSQL("CREATE INDEX IF NOT EXISTS index_app_logs_tag ON app_logs (tag)")
                database.execSQL("CREATE INDEX IF NOT EXISTS index_app_logs_created_at ON app_logs (created_at)")
                
                Log.d(TAG, "[DB] Migration 1 -> 2 completed")
            }
        }
        
        /**
         * Get the singleton database instance.
         * Creates the encrypted database on first access.
         */
        fun getInstance(context: Context): DelicoopDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: buildDatabase(context).also { INSTANCE = it }
            }
        }
        
        /**
         * Initialize the database immediately.
         * Call this on app startup to ensure the database exists.
         */
        fun initializeAsync(context: Context, callback: ((Boolean) -> Unit)? = null) {
            Thread {
                try {
                    Log.d(TAG, "[DB] Initializing database on startup...")
                    val db = getInstance(context)
                    
                    // Force database creation by accessing a DAO
                    db.syncRecordDao()
                    db.logRecordDao()
                    
                    Log.d(TAG, "[DB] Database initialized successfully on startup")
                    callback?.invoke(true)
                } catch (e: Exception) {
                    Log.e(TAG, "[DB] Failed to initialize database: ${e.message}")
                    callback?.invoke(false)
                }
            }.start()
        }
        
        /**
         * Build the encrypted Room database.
         * Uses SQLCipher for encryption at rest.
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
                .addCallback(object : Callback() {
                    override fun onCreate(db: SupportSQLiteDatabase) {
                        super.onCreate(db)
                        Log.d(TAG, "[DB] Database created for the first time")
                    }
                    
                    override fun onOpen(db: SupportSQLiteDatabase) {
                        super.onOpen(db)
                        Log.d(TAG, "[DB] Database opened")
                    }
                })
                .build()
                .also {
                    Log.d(TAG, "[DB] Database built successfully")
                }
        }
        
        /**
         * Generate or retrieve the database encryption key.
         * The key is stored securely in SharedPreferences.
         * In production, consider using Android Keystore for additional security.
         */
        private fun getOrCreateDatabaseKey(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            
            var key = prefs.getString(KEY_DB_KEY, null)
            if (key == null) {
                // Generate a new 32-byte random key
                val random = SecureRandom()
                val bytes = ByteArray(32)
                random.nextBytes(bytes)
                key = bytes.joinToString("") { "%02x".format(it) }
                
                // Store the key
                prefs.edit().putString(KEY_DB_KEY, key).apply()
                Log.d(TAG, "[DB] Generated new encryption key")
            } else {
                Log.d(TAG, "[DB] Using existing encryption key")
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
