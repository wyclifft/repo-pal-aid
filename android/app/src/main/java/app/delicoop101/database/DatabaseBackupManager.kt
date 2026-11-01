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
     * Gets candidate backup directories in order of preference.
     * 1. Public Documents directory (if accessible/writable)
     * 2. App-specific external Documents directory (always accessible on Android 10+)
     */
    fun getBackupDirectories(context: Context): List<File> {
        val dirs = mutableListOf<File>()

        // 1. Public Documents
        try {
            val publicDocs = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
            dirs.add(File(publicDocs, BACKUP_DIR_NAME))
        } catch (e: Exception) {
            Log.w(TAG, "[BACKUP] Unable to resolve public Documents directory: ${e.message}")
        }

        // 2. App-specific external Documents (no storage permissions required)
        try {
            val appDocs = context.getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
                ?: context.getExternalFilesDir(null)
            if (appDocs != null) {
                dirs.add(File(appDocs, BACKUP_DIR_NAME))
            }
        } catch (e: Exception) {
            Log.w(TAG, "[BACKUP] Unable to resolve app external directory: ${e.message}")
        }

        // 3. App internal files dir as fallback
        dirs.add(File(context.filesDir, BACKUP_DIR_NAME))

        return dirs
    }

    /**
     * Gets or creates the default backup directory.
     */
    fun getBackupDirectory(): File {
        val documentsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
        val backupDir = File(documentsDir, BACKUP_DIR_NAME)
        if (!backupDir.exists()) {
            backupDir.mkdirs()
        }
        return backupDir
    }

    /**
     * Gets the backup file path for the current device's database.
     * Checks if a backup file already exists in any candidate location;
     * otherwise returns the path in the primary backup directory.
     */
    fun getBackupFile(context: Context): File {
        val dbName = DelicoopDatabase.getDatabaseName(context)
        val candidateDirs = getBackupDirectories(context)

        // Return first existing non-empty backup file
        for (dir in candidateDirs) {
            val file = File(dir, "${dbName}_backup.db")
            if (file.exists() && file.length() > 0L) {
                return file
            }
        }

        // Default to first directory (public or app external)
        val primaryDir = candidateDirs.firstOrNull() ?: getBackupDirectory()
        if (!primaryDir.exists()) {
            primaryDir.mkdirs()
        }
        return File(primaryDir, "${dbName}_backup.db")
    }

    /**
     * Safely copies the internal SQLite database file to external persistent storage.
     * Tries public Documents first, then falls back to app external files dir if permission is restricted.
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

            val candidateDirs = getBackupDirectories(context)
            var backedUp = false
            var lastError: Exception? = null

            for (dir in candidateDirs) {
                try {
                    if (!dir.exists()) {
                        dir.mkdirs()
                    }
                    val destFile = File(dir, "${dbName}_backup.db")
                    copyFile(dbFile, destFile)

                    Log.d(TAG, "[BACKUP] Database backed up successfully: ${destFile.absolutePath} (${destFile.length()} bytes)")
                    DatabaseLogger.info(TAG, "External DB backup complete", "path=${destFile.absolutePath}, size=${destFile.length()}")
                    backedUp = true
                    break
                } catch (e: Exception) {
                    lastError = e
                    Log.w(TAG, "[BACKUP] Failed writing backup to ${dir.absolutePath} (${e.message}). Trying next location...")
                }
            }

            if (!backedUp) {
                Log.e(TAG, "[BACKUP] Error during database backup across all locations: ${lastError?.message}", lastError)
                DatabaseLogger.error(TAG, "Database backup failed", lastError?.message)
            }

            return backedUp
        } catch (e: Exception) {
            Log.e(TAG, "[BACKUP] Error during database backup: ${e.message}", e)
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

            val candidateDirs = getBackupDirectories(context)
            var backupFile: File? = null

            for (dir in candidateDirs) {
                val file = File(dir, "${dbName}_backup.db")
                if (file.exists() && file.length() > 0L) {
                    backupFile = file
                    break
                }
            }

            if (backupFile == null) {
                Log.d(TAG, "[RESTORE] No external backup found for $dbName")
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
