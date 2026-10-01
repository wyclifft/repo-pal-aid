package app.delicoop101.database

import androidx.room.*

@Dao
interface EmTransactionDao {
    @Query("SELECT * FROM em_transaction ORDER BY id DESC")
    suspend fun getAll(): List<EmTransaction>

    @Query("SELECT * FROM em_transaction WHERE transrefno = :refNo LIMIT 1")
    suspend fun getByRefNo(refNo: String): EmTransaction?

    @Query("SELECT * FROM em_transaction WHERE uploaded = 0")
    suspend fun getUnsynced(): List<EmTransaction>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(transaction: EmTransaction): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(transactions: List<EmTransaction>)

    @Query("UPDATE em_transaction SET uploaded = 1 WHERE id = :id")
    suspend fun markUploaded(id: Long): Int

    @Query("DELETE FROM em_transaction WHERE date(transdate) < date('now', '-60 days')")
    suspend fun deleteOlderThan60Days(): Int
}
