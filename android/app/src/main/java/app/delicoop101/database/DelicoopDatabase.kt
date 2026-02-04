package app.delicoop101.database

import android.content.Context
import android.util.Log
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
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
         * Get the singleton database instance.
         * Creates the encrypted database on first access.
         */
        fun getInstance(context: Context): DelicoopDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: buildDatabase(context).also { INSTANCE = it }
            }
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
                .fallbackToDestructiveMigration()
                .build()
                .also {
                    Log.d(TAG, "[DB] Database created successfully")
                }
        }
        
        /**
         * Generate or retrieve the database encryption key.
         * The key is stored securely in SharedPreferences.
         * 
         * To retrieve the key for external database access:
         * 1. Use Android Studio Device File Explorer
         * 2. Navigate to /data/data/app.delicoop101/shared_prefs/delicoop_db_prefs.xml
         * 3. The key is in the 'db_encryption_key' field (64-character hex string)
         */
        private fun getOrCreateDatabaseKey(context: Context): String {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            
            var key = prefs.getString(KEY_DB_KEY, null)
            if (key == null) {
                // Generate a new 32-byte random key (64 hex characters)
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
