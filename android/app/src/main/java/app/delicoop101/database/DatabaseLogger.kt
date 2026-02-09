package app.delicoop101.database

import android.content.Context
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Asynchronous, non-blocking database logger.
 * 
 * Uses a Mutex-protected list to batch log entries for efficient database writes.
 * Logs are flushed every BATCH_SIZE records OR every FLUSH_INTERVAL, whichever comes first.
 * 
 * Thread-safety: All access to pendingLogs is guarded by a Mutex.
 * Flush on destroy: flush() is a blocking call that ensures all pending logs
 * are written before the process exits.
 * 
 * Automated maintenance:
 * - Retains only the last 7 days of logs
 * - Maximum 10,000 log entries
 */
object DatabaseLogger {
    
    private const val TAG = "DatabaseLogger"
    private const val BATCH_SIZE = 10
    private const val FLUSH_INTERVAL_MS = 3000L
    private const val MAX_LOG_COUNT = 10000
    private const val MAX_LOG_AGE_DAYS = 7L
    
    private var database: DelicoopDatabase? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val initialized = AtomicBoolean(false)
    
    // Thread-safe pending log buffer
    private val mutex = Mutex()
    private val pendingLogs = mutableListOf<AppLog>()
    
    /**
     * Initialize the logger with the database instance.
     * Must be called after database is initialized.
     */
    fun initialize(context: Context) {
        if (!initialized.compareAndSet(false, true)) {
            Log.d(TAG, "[LOGGER] Already initialized")
            return
        }
        
        database = DelicoopDatabase.getInstance(context)
        
        // Start the periodic flusher
        startPeriodicFlush()
        
        // Schedule periodic maintenance
        scheduleMaintenance()
        
        Log.d(TAG, "[LOGGER] DatabaseLogger initialized")
    }
    
    /**
     * Log a message asynchronously (non-blocking).
     * If batch size is reached, triggers an immediate flush.
     */
    fun log(level: String, tag: String, message: String, extraData: String? = null) {
        if (!initialized.get()) {
            when (level) {
                "ERROR" -> Log.e(tag, message)
                "WARN" -> Log.w(tag, message)
                "DEBUG" -> Log.d(tag, message)
                else -> Log.i(tag, message)
            }
            return
        }
        
        val logEntry = AppLog(
            level = level,
            tag = tag,
            message = message,
            extraData = extraData
        )
        
        scope.launch {
            var shouldFlush = false
            mutex.withLock {
                pendingLogs.add(logEntry)
                shouldFlush = pendingLogs.size >= BATCH_SIZE
            }
            if (shouldFlush) {
                writePendingLogs()
            }
        }
    }
    
    fun info(tag: String, message: String, extraData: String? = null) = 
        log("INFO", tag, message, extraData)
    
    fun warn(tag: String, message: String, extraData: String? = null) = 
        log("WARN", tag, message, extraData)
    
    fun error(tag: String, message: String, extraData: String? = null) = 
        log("ERROR", tag, message, extraData)
    
    fun debug(tag: String, message: String, extraData: String? = null) = 
        log("DEBUG", tag, message, extraData)
    
    /**
     * Flush pending logs SYNCHRONOUSLY.
     * Call this from onDestroy to ensure all logs are written before process exit.
     * Uses runBlocking so the calling thread waits until the write completes.
     */
    fun flush() {
        if (!initialized.get()) return
        
        try {
            // runBlocking ensures we don't return until logs are persisted
            runBlocking(Dispatchers.IO) {
                writePendingLogs()
            }
            Log.d(TAG, "[LOGGER] Flushed pending logs synchronously")
        } catch (e: Exception) {
            Log.e(TAG, "[LOGGER] Error flushing logs: ${e.message}")
        }
    }
    
    /**
     * Periodically flush logs on a timer (in case batch size isn't reached).
     */
    private fun startPeriodicFlush() {
        scope.launch {
            while (isActive) {
                delay(FLUSH_INTERVAL_MS)
                try {
                    writePendingLogs()
                } catch (e: Exception) {
                    Log.e(TAG, "[LOGGER] Periodic flush error: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Write pending logs to database, thread-safely draining the buffer.
     */
    private suspend fun writePendingLogs() {
        val logsToWrite: List<AppLog>
        mutex.withLock {
            if (pendingLogs.isEmpty()) return
            logsToWrite = pendingLogs.toList()
            pendingLogs.clear()
        }
        
        try {
            database?.appLogDao()?.insertAll(logsToWrite)
        } catch (e: Exception) {
            Log.e(TAG, "[LOGGER] Failed to write ${logsToWrite.size} logs: ${e.message}")
            // Re-add failed logs back to the buffer so they aren't lost
            mutex.withLock {
                pendingLogs.addAll(0, logsToWrite)
            }
        }
    }
    
    /**
     * Schedule periodic maintenance to clean old logs
     */
    private fun scheduleMaintenance() {
        scope.launch {
            while (isActive) {
                delay(TimeUnit.HOURS.toMillis(1))
                try {
                    performMaintenance()
                } catch (e: Exception) {
                    Log.e(TAG, "[LOGGER] Maintenance error: ${e.message}")
                }
            }
        }
    }
    
    private suspend fun performMaintenance() {
        val dao = database?.appLogDao() ?: return
        
        val cutoffTime = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(MAX_LOG_AGE_DAYS)
        val deletedByAge = dao.deleteOldLogs(cutoffTime)
        val deletedByCount = dao.keepRecentLogs(MAX_LOG_COUNT)
        
        if (deletedByAge > 0 || deletedByCount > 0) {
            Log.d(TAG, "[LOGGER] Maintenance: deleted $deletedByAge old, $deletedByCount excess logs")
        }
    }
}
