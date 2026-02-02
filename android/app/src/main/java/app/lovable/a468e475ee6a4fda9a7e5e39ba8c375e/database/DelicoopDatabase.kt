package app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.database

import android.content.Context
import android.util.Log
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import net.sqlcipher.database.SQLiteDatabase
import net.sqlcipher.database.SupportFactory
import java.security.SecureRandom

/**
 * Main Room database for the Delicoop app.
 * Uses SQLCipher for encryption at rest.
 * 
 * Database name: delicoop101_database
 * This is the single source of truth for all app data.
 */
@Database(
    entities = [SyncRecord::class],
    version = 1,
    exportSchema = true
)
abstract class DelicoopDatabase : RoomDatabase() {
    
    abstract fun syncRecordDao(): SyncRecordDao
    
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
