package app.delicoop101.database

import androidx.room.*

@Dao
interface TransactionGroupDao {
    @Query("SELECT * FROM transaction_group ORDER BY id DESC")
    suspend fun getAll(): List<TransactionGroup>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(group: TransactionGroup): Long

    @Query("DELETE FROM transaction_group WHERE date(date_created) < date('now', '-60 days')")
    suspend fun deleteOlderThan60Days(): Int
}
