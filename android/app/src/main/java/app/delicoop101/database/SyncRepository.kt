package app.delicoop101.database

/**
 * Repository for managing sync records.
 * Provides a clean API for database operations.
 */
class SyncRepository(private val dao: SyncRecordDao) {
    
    suspend fun insertRecord(record: SyncRecord): Long {
        return dao.insert(record)
    }
    
    suspend fun getUnsyncedRecords(): List<SyncRecord> {
        return dao.getUnsyncedRecords()
    }
    
    suspend fun getUnsyncedRecordsByType(recordType: String): List<SyncRecord> {
        return dao.getUnsyncedRecordsByType(recordType)
    }
    
    suspend fun getRecordByReference(referenceNo: String): SyncRecord? {
        return dao.getByReferenceNo(referenceNo)
    }
    
    suspend fun markAsSynced(referenceNo: String, backendId: Long?) {
        dao.markAsSynced(referenceNo, System.currentTimeMillis(), backendId)
    }
    
    suspend fun updateSyncError(referenceNo: String, error: String) {
        dao.updateSyncError(referenceNo, error, System.currentTimeMillis())
    }
    
    suspend fun getTotalRecordCount(): Int {
        return dao.getTotalCount()
    }
    
    suspend fun getUnsyncedCount(): Int {
        return dao.getUnsyncedCount()
    }
    
    suspend fun getFailedSyncCount(): Int {
        return dao.getFailedSyncCount()
    }
    
    suspend fun deleteOldSyncedRecords(cutoffTime: Long): Int {
        return dao.deleteOldSyncedRecords(cutoffTime)
    }
}
