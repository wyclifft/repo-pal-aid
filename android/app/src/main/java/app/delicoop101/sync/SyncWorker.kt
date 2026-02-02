package app.delicoop101.sync

import android.content.Context
import android.util.Log
import androidx.work.*
import app.delicoop101.database.DelicoopDatabase
import app.delicoop101.database.SyncRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * WorkManager Worker for background sync operations.
 * 
 * This worker handles:
 * - Syncing pending offline records to the backend
 * - Retrying failed sync attempts
 * - Cleaning up old synced records
 */
class SyncWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {
    
    companion object {
        private const val TAG = "SyncWorker"
        const val WORK_NAME = "delicoop_sync_worker"
        
        /**
         * Schedule periodic sync work
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
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .build()
            
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    syncRequest
                )
            
            Log.d(TAG, "[Sync] Periodic sync scheduled")
        }
        
        /**
         * Request immediate sync
         */
        fun requestImmediateSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            
            val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .build()
            
            WorkManager.getInstance(context)
                .enqueue(syncRequest)
            
            Log.d(TAG, "[Sync] Immediate sync requested")
        }
    }
    
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Log.d(TAG, "[Sync] Starting sync work")
        
        try {
            val database = DelicoopDatabase.getInstance(applicationContext)
            val repository = SyncRepository(database.syncRecordDao())
            
            // Get unsynced records
            val unsyncedRecords = repository.getUnsyncedRecords()
            Log.d(TAG, "[Sync] Found ${unsyncedRecords.size} unsynced records")
            
            if (unsyncedRecords.isEmpty()) {
                Log.d(TAG, "[Sync] No records to sync")
                return@withContext Result.success()
            }
            
            // TODO: Implement actual sync logic with backend API
            // For now, just log the records
            for (record in unsyncedRecords) {
                Log.d(TAG, "[Sync] Would sync: ${record.referenceNo} (${record.recordType})")
            }
            
            Log.d(TAG, "[Sync] Sync work completed")
            Result.success()
            
        } catch (e: Exception) {
            Log.e(TAG, "[Sync] Sync work failed", e)
            Result.retry()
        }
    }
}
