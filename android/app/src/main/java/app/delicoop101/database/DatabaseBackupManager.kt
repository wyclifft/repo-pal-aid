package app.delicoop101.database

import android.content.Context
import android.os.Environment
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/**
 * Manages persistent external storage backups and auto-restoration for the app database.
 * Preserves data across Android "Clear Data" actions and APK uninstalls/reinstalls.
 */
object DatabaseBackupManager {

    private const val TAG = "DatabaseBackupManager"
    private const val BACKUP_DIR_NAME = "DeliCoop_Backups"

    /**
     * Gets or creates the external persistent backup directory in Documents
     */
    fun getBackupDirectory(): File {
        val documentsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
        val backupDir = File(documentsDir, BACKUP_DIR_NAME)
        if (!backupDir.exists()) {
            val created = backupDir.mkdirs()
            Log.d(TAG, "[BACKUP] Created persistent backup directory: ${backupDir.absolutePath} (created=$created)")
        }
        return backupDir
    }

    /**
     * Gets the backup file path for the current device's database
     */
    fun getBackupFile(context: Context): File {
        val dbName = DelicoopDatabase.getDatabaseName(context)
        val backupDir = getBackupDirectory()
        return File(backupDir, "${dbName}_backup.db")
    }

    /**
     * Safely copies the internal SQLite database file to external persistent storage.
     */
    @Synchronized
    fun backupDatabase(context: Context): Boolean {
        try {
            val dbName = DelicoopDatabase.getDatabaseName(context)
            val dbFile = context.getDatabasePath(dbName)

            if (!dbFile.exists() || dbFile.length() == 0L) {
                Log.w(TAG, "[BACKUP] Cannot backup: internal DB file does not exist or is empty: ${dbFile.absolutePath}")
                return false
            }

            val destFile = getBackupFile(context)
            copyFile(dbFile, destFile)

            Log.d(TAG, "[BACKUP] Database backed up successfully: ${destFile.absolutePath} (${destFile.length()} bytes)")
            DatabaseLogger.info(TAG, "External DB backup complete", "path=${destFile.absolutePath}, size=${destFile.length()}")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "[BACKUP] Critical error during database backup: ${e.message}", e)
            DatabaseLogger.error(TAG, "Database backup failed", e.message)
            return false
        }
    }

    /**
     * Checks if the internal database is missing (e.g. after Clear Data or reinstall).
     * If missing and a backup exists in external storage, restores it prior to Room initialization.
     */
    @Synchronized
    fun restoreIfNeeded(context: Context): Boolean {
        try {
            val dbName = DelicoopDatabase.getDatabaseName(context)
            val dbFile = context.getDatabasePath(dbName)

            if (dbFile.exists() && dbFile.length() > 0) {
                Log.d(TAG, "[RESTORE] Internal database exists (${dbFile.length()} bytes). Auto-restore not needed.")
                return false
            }

            val backupFile = getBackupFile(context)
            if (!backupFile.exists() || backupFile.length() == 0L) {
                Log.d(TAG, "[RESTORE] No external backup found at ${backupFile.absolutePath}")
                return false
            }

            // Ensure parent directory exists for internal DB
            dbFile.parentFile?.mkdirs()

            Log.d(TAG, "[RESTORE] Internal DB missing! Auto-restoring from external backup: ${backupFile.absolutePath}")
            copyFile(backupFile, dbFile)

            Log.d(TAG, "[RESTORE] Database restored successfully to ${dbFile.absolutePath} (${dbFile.length()} bytes)")
            DatabaseLogger.info(TAG, "Auto-restored database from external backup", "size=${dbFile.length()}")
            return true
        } catch (e: Exception) {
            Log.e(TAG, "[RESTORE] Critical error during database restoration: ${e.message}", e)
            DatabaseLogger.error(TAG, "Database restoration failed", e.message)
            return false
        }
    }

    private fun copyFile(src: File, dst: File) {
        FileInputStream(src).use { input ->
            FileOutputStream(dst).use { output ->
                input.copyTo(output)
            }
        }
    }
}
