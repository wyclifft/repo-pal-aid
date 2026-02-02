package app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.sync

import android.content.Context
import android.util.Log
import androidx.work.*
import app.lovable.a468e475ee6a4fda9a7e5e39ba8c375e.database.SyncRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * WorkManager worker for background sync operations.
 * Syncs unsynced records to the remote backend with automatic retry.
 */
class SyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    
    companion object {
        private const val TAG = "SyncWorker"
        const val WORK_NAME = "delicoop_sync_worker"
        private const val MAX_RETRY_ATTEMPTS = 5
        
        /**
         * Schedule periodic background sync
         */
        fun schedulePeriodicSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            
            val syncRequest = PeriodicWorkRequestBuilder<SyncWorker>(
                15, TimeUnit.MINUTES,
                5, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                syncRequest
            )
            Log.d(TAG, "[SYNC] Scheduled periodic sync")
        }
        
        /**
         * Trigger immediate one-time sync
         */
        fun triggerImmediateSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            
            val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .build()
            
            WorkManager.getInstance(context).enqueue(syncRequest)
            Log.d(TAG, "[SYNC] Triggered immediate sync")
        }
    }
    
    private val repository = SyncRepository.getInstance(applicationContext)
    
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Log.d(TAG, "[SYNC] Starting background sync...")
        
        try {
            val unsyncedRecords = repository.getRecordsForRetry(MAX_RETRY_ATTEMPTS)
            
            if (unsyncedRecords.isEmpty()) {
                Log.d(TAG, "[SYNC] No records to sync")
                return@withContext Result.success()
            }
            
            Log.d(TAG, "[SYNC] Found ${unsyncedRecords.size} records to sync")
            
            var syncedCount = 0
            var failedCount = 0
            
            for (record in unsyncedRecords) {
                try {
                    // Sync based on record type
                    val success = syncRecord(record.recordType, record.payload, record.referenceNo)
                    
                    if (success) {
                        repository.markAsSynced(record.id)
                        syncedCount++
                    } else {
                        repository.recordSyncFailure(record.id, "Sync failed")
                        failedCount++
                    }
                } catch (e: Exception) {
                    repository.recordSyncFailure(record.id, e.message ?: "Unknown error")
                    failedCount++
                    Log.e(TAG, "[SYNC] Error syncing record ${record.id}: ${e.message}")
                }
            }
            
            Log.d(TAG, "[SYNC] Sync complete: synced=$syncedCount, failed=$failedCount")
            
            if (failedCount > 0 && syncedCount == 0) {
                Result.retry()
            } else {
                Result.success()
            }
        } catch (e: Exception) {
            Log.e(TAG, "[SYNC] Sync worker error: ${e.message}")
            Result.retry()
        }
    }
    
    private suspend fun syncRecord(type: String, payload: String, refNo: String): Boolean {
        // Get API base URL from shared preferences or use default
        val prefs = applicationContext.getSharedPreferences("app_settings", Context.MODE_PRIVATE)
        val apiUrl = prefs.getString("api_url", null) ?: return false
        
        val endpoint = when (type) {
            "milk_collection" -> "$apiUrl/api/milk-collections"
            "store_sale" -> "$apiUrl/api/sales"
            "ai_sale" -> "$apiUrl/api/sales"
            else -> return false
        }
        
        return try {
            val url = URL(endpoint)
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.connectTimeout = 30000
            connection.readTimeout = 30000
            
            connection.outputStream.use { it.write(payload.toByteArray()) }
            
            val responseCode = connection.responseCode
            connection.disconnect()
            
            responseCode in 200..299
        } catch (e: Exception) {
            Log.e(TAG, "[SYNC] HTTP error for $refNo: ${e.message}")
            false
        }
    }
}
