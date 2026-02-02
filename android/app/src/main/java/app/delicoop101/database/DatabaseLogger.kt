package app.delicoop101.database

import android.content.Context
import android.os.Build
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Optimized async database logger.
 * - Batches log writes to minimize database operations
 * - Uses coroutines for non-blocking writes
 * - Auto-cleans old logs to prevent database bloat
 * - Thread-safe singleton pattern
 */
object DatabaseLogger {
    private const val TAG = "DatabaseLogger"
    private const val BATCH_SIZE = 20
    private const val FLUSH_INTERVAL_MS = 5000L
    private const val MAX_LOG_AGE_DAYS = 7
    private const val MAX_LOG_COUNT = 10000
    
    private var database: DelicoopDatabase? = null
    private val logChannel = Channel<LogRecord>(Channel.BUFFERED)
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val isInitialized = AtomicBoolean(false)
    private val sessionId = UUID.randomUUID().toString().take(8)
    private var deviceInfo: String = ""
    
    /**
     * Initialize the logger with the database instance.
     * Call this early in app lifecycle.
     */
    fun initialize(context: Context) {
        if (isInitialized.getAndSet(true)) {
            Log.d(TAG, "[LOG] Already initialized")
            return
        }
        
        deviceInfo = buildDeviceInfo()
        
        scope.launch {
            try {
                database = DelicoopDatabase.getInstance(context)
                Log.d(TAG, "[LOG] Database logger initialized")
                
                // Start the batch processor
                startBatchProcessor()
                
                // Clean old logs on startup
                cleanOldLogs()
                
            } catch (e: Exception) {
                Log.e(TAG, "[LOG] Failed to initialize: ${e.message}")
                isInitialized.set(false)
            }
        }
    }
    
    private fun buildDeviceInfo(): String {
        return buildString {
            append("${Build.MANUFACTURER} ${Build.MODEL}")
            append(" | Android ${Build.VERSION.RELEASE}")
            append(" | SDK ${Build.VERSION.SDK_INT}")
        }
    }
    
    private fun startBatchProcessor() {
        scope.launch {
            val batch = mutableListOf<LogRecord>()
            var lastFlush = System.currentTimeMillis()
            
            logChannel.receiveAsFlow().collect { log ->
                batch.add(log)
                
                val now = System.currentTimeMillis()
                val shouldFlush = batch.size >= BATCH_SIZE || 
                                  (now - lastFlush) >= FLUSH_INTERVAL_MS
                
                if (shouldFlush && batch.isNotEmpty()) {
                    try {
                        database?.logRecordDao()?.insertAll(batch.toList())
                        batch.clear()
                        lastFlush = now
                    } catch (e: Exception) {
                        Log.e(TAG, "[LOG] Batch insert failed: ${e.message}")
                    }
                }
            }
        }
        
        // Periodic flush for any remaining logs
        scope.launch {
            while (isActive) {
                delay(FLUSH_INTERVAL_MS)
                flushPendingLogs()
            }
        }
    }
    
    private suspend fun flushPendingLogs() {
        // Force a flush by checking if channel has pending items
        val pending = mutableListOf<LogRecord>()
        while (true) {
            val result = logChannel.tryReceive()
            if (result.isSuccess) {
                pending.add(result.getOrThrow())
            } else {
                break
            }
        }
        
        if (pending.isNotEmpty()) {
            try {
                database?.logRecordDao()?.insertAll(pending)
            } catch (e: Exception) {
                Log.e(TAG, "[LOG] Flush failed: ${e.message}")
            }
        }
    }
    
    private suspend fun cleanOldLogs() {
        try {
            val cutoffTime = System.currentTimeMillis() - (MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000L)
            val deleted = database?.logRecordDao()?.deleteOldLogs(cutoffTime) ?: 0
            
            if (deleted > 0) {
                Log.d(TAG, "[LOG] Cleaned $deleted old logs")
            }
            
            // Also check total count
            val count = database?.logRecordDao()?.getLogCount() ?: 0
            if (count > MAX_LOG_COUNT) {
                Log.d(TAG, "[LOG] Log count ($count) exceeds max, cleanup needed")
            }
        } catch (e: Exception) {
            Log.e(TAG, "[LOG] Cleanup failed: ${e.message}")
        }
    }
    
    // Public logging methods
    
    fun d(tag: String, message: String) {
        Log.d(tag, message)
        enqueueLog("DEBUG", tag, message)
    }
    
    fun i(tag: String, message: String) {
        Log.i(tag, message)
        enqueueLog("INFO", tag, message)
    }
    
    fun w(tag: String, message: String) {
        Log.w(tag, message)
        enqueueLog("WARN", tag, message)
    }
    
    fun e(tag: String, message: String, throwable: Throwable? = null) {
        Log.e(tag, message, throwable)
        enqueueLog("ERROR", tag, message, throwable?.stackTraceToString())
    }
    
    private fun enqueueLog(level: String, tag: String, message: String, stackTrace: String? = null) {
        if (!isInitialized.get()) return
        
        val log = LogRecord(
            level = level,
            tag = tag,
            message = message,
            stackTrace = stackTrace,
            deviceInfo = deviceInfo,
            sessionId = sessionId
        )
        
        // Non-blocking send
        scope.launch {
            try {
                logChannel.send(log)
            } catch (e: Exception) {
                // Channel full or closed, skip this log
            }
        }
    }
    
    /**
     * Get recent logs for debugging.
     */
    suspend fun getRecentLogs(limit: Int = 100): List<LogRecord> {
        return try {
            database?.logRecordDao()?.getRecentLogs(limit) ?: emptyList()
        } catch (e: Exception) {
            Log.e(TAG, "[LOG] Failed to get logs: ${e.message}")
            emptyList()
        }
    }
    
    /**
     * Get logs by level (DEBUG, INFO, WARN, ERROR).
     */
    suspend fun getLogsByLevel(level: String, limit: Int = 100): List<LogRecord> {
        return try {
            database?.logRecordDao()?.getLogsByLevel(level, limit) ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }
    }
    
    /**
     * Search logs by message or tag.
     */
    suspend fun searchLogs(query: String, limit: Int = 100): List<LogRecord> {
        return try {
            database?.logRecordDao()?.searchLogs(query, limit) ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }
    }
    
    /**
     * Clean up resources.
     */
    fun shutdown() {
        scope.launch {
            flushPendingLogs()
            scope.cancel()
        }
    }
}
