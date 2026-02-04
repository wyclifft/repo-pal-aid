package app.delicoop101.sync

import android.content.Context
import android.util.Log
import androidx.work.*
import app.delicoop101.database.DelicoopDatabase
import app.delicoop101.database.DatabaseLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Background worker for syncing offline data when network is available.
 * Uses WorkManager for reliable background execution.
 */
class SyncWorker(
    context: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(context, workerParams) {

    companion object {
        private const val TAG = "SyncWorker"
        private const val WORK_NAME = "delicoop_background_sync"

        /**
         * Schedule periodic background sync.
         * Runs every 15 minutes when network is available.
         */
        fun schedulePeriodicSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val syncRequest = PeriodicWorkRequestBuilder<SyncWorker>(
                15, TimeUnit.MINUTES,
                5, TimeUnit.MINUTES // Flex interval
            )
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                syncRequest
            )

            Log.d(TAG, "[SYNC] Scheduled periodic sync")
            DatabaseLogger.info(TAG, "Periodic sync scheduled")
        }

        /**
         * Request immediate sync (one-time).
         */
        fun requestImmediateSync(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()

            WorkManager.getInstance(context).enqueue(syncRequest)
            Log.d(TAG, "[SYNC] Requested immediate sync")
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Log.d(TAG, "[SYNC] Background sync started")
        DatabaseLogger.info(TAG, "Background sync started")

        try {
            val db = DelicoopDatabase.getInstance(applicationContext)
            val unsyncedRecords = db.syncRecordDao().getUnsynced()

            if (unsyncedRecords.isEmpty()) {
                Log.d(TAG, "[SYNC] No unsynced records")
                return@withContext Result.success()
            }

            Log.d(TAG, "[SYNC] Found ${unsyncedRecords.size} unsynced records")
            DatabaseLogger.info(TAG, "Found ${unsyncedRecords.size} unsynced records")

            // Note: Actual sync logic would go here
            // This worker prepares records; the web layer handles actual API calls
            // through the Capacitor bridge when the app is active

            var syncedCount = 0
            var failedCount = 0

            // For now, just log the pending items
            // The web layer will handle actual sync when app is active
            for (record in unsyncedRecords) {
                Log.d(TAG, "[SYNC] Pending: ${record.referenceNo} (${record.recordType})")
            }

            Log.d(TAG, "[SYNC] Background sync completed")
            DatabaseLogger.info(TAG, "Background sync completed", "pending=${unsyncedRecords.size}")

            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "[SYNC] Background sync failed: ${e.message}", e)
            DatabaseLogger.error(TAG, "Background sync failed", e.message)
            Result.retry()
        }
    }
}
