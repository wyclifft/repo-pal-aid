package app.delicoop101.database

import android.content.Context
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.consumeEach
import java.util.concurrent.TimeUnit

/**
 * Asynchronous, non-blocking database logger.
 * 
 * Uses Kotlin Channels to batch log entries for efficient database writes.
 * Logs are batched every 20 records OR every 5 seconds, whichever comes first.
 * This prevents UI performance degradation from frequent database operations.
 * 
 * Automated maintenance:
 * - Retains only the last 7 days of logs
 * - Maximum 10,000 log entries
 */
object DatabaseLogger {
    
    private const val TAG = "DatabaseLogger"
    private const val BATCH_SIZE = 20
    private const val FLUSH_INTERVAL_MS = 5000L
    private const val MAX_LOG_COUNT = 10000
    private const val MAX_LOG_AGE_DAYS = 7L
    
    private var database: DelicoopDatabase? = null
    private val logChannel = Channel<AppLog>(Channel.UNLIMITED)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var isInitialized = false
    private val pendingLogs = mutableListOf<AppLog>()
    
    /**
     * Initialize the logger with the database instance.
     * Must be called after database is initialized.
     */
    fun initialize(context: Context) {
        if (isInitialized) {
            Log.d(TAG, "[LOGGER] Already initialized")
            return
        }
        
        database = DelicoopDatabase.getInstance(context)
        isInitialized = true
        
        // Start the batch processor
        startBatchProcessor()
        
        // Schedule periodic maintenance
        scheduleMaintenance()
        
        Log.d(TAG, "[LOGGER] DatabaseLogger initialized")
    }
    
    /**
     * Log a message asynchronously (non-blocking)
     */
    fun log(level: String, tag: String, message: String, extraData: String? = null) {
        if (!isInitialized) {
            // Queue log for later if not initialized yet
            Log.w(TAG, "[LOGGER] Not initialized, logging to Android Log: $message")
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
        
        // Non-blocking send to channel
        scope.launch {
            logChannel.send(logEntry)
        }
    }
    
    /**
     * Convenience methods
     */
    fun info(tag: String, message: String, extraData: String? = null) = 
        log("INFO", tag, message, extraData)
    
    fun warn(tag: String, message: String, extraData: String? = null) = 
        log("WARN", tag, message, extraData)
    
    fun error(tag: String, message: String, extraData: String? = null) = 
        log("ERROR", tag, message, extraData)
    
    fun debug(tag: String, message: String, extraData: String? = null) = 
        log("DEBUG", tag, message, extraData)
    
    /**
     * Flush pending logs immediately (call before app termination)
     */
    fun flush() {
        if (!isInitialized) return
        
        scope.launch {
            try {
                writePendingLogs()
                Log.d(TAG, "[LOGGER] Flushed pending logs")
            } catch (e: Exception) {
                Log.e(TAG, "[LOGGER] Error flushing logs: ${e.message}")
            }
        }
    }
    
    /**
     * Start the batch processor coroutine
     */
    private fun startBatchProcessor() {
        scope.launch {
            var lastFlushTime = System.currentTimeMillis()
            
            while (isActive) {
                try {
                    // Try to receive with timeout
                    val log = withTimeoutOrNull(FLUSH_INTERVAL_MS) {
                        logChannel.receive()
                    }
                    
                    if (log != null) {
                        pendingLogs.add(log)
                    }
                    
                    val now = System.currentTimeMillis()
                    val shouldFlush = pendingLogs.size >= BATCH_SIZE || 
                                     (now - lastFlushTime >= FLUSH_INTERVAL_MS && pendingLogs.isNotEmpty())
                    
                    if (shouldFlush) {
                        writePendingLogs()
                        lastFlushTime = now
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "[LOGGER] Batch processor error: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Write pending logs to database
     */
    private suspend fun writePendingLogs() {
        if (pendingLogs.isEmpty()) return
        
        try {
            val logsToWrite = pendingLogs.toList()
            pendingLogs.clear()
            
            database?.appLogDao()?.insertAll(logsToWrite)
            Log.d(TAG, "[LOGGER] Wrote ${logsToWrite.size} logs to database")
        } catch (e: Exception) {
            Log.e(TAG, "[LOGGER] Failed to write logs: ${e.message}")
        }
    }
    
    /**
     * Schedule periodic maintenance to clean old logs
     */
    private fun scheduleMaintenance() {
        scope.launch {
            while (isActive) {
                delay(TimeUnit.HOURS.toMillis(1)) // Run maintenance hourly
                
                try {
                    performMaintenance()
                } catch (e: Exception) {
                    Log.e(TAG, "[LOGGER] Maintenance error: ${e.message}")
                }
            }
        }
    }
    
    /**
     * Perform log maintenance - delete old logs, keep max count
     */
    private suspend fun performMaintenance() {
        val dao = database?.appLogDao() ?: return
        
        // Delete logs older than 7 days
        val cutoffTime = System.currentTimeMillis() - TimeUnit.DAYS.toMillis(MAX_LOG_AGE_DAYS)
        val deletedByAge = dao.deleteOldLogs(cutoffTime)
        
        // Keep only the most recent 10,000 logs
        val deletedByCount = dao.keepRecentLogs(MAX_LOG_COUNT)
        
        if (deletedByAge > 0 || deletedByCount > 0) {
            Log.d(TAG, "[LOGGER] Maintenance: deleted $deletedByAge old logs, $deletedByCount excess logs")
        }
    }
}
