package app.delicoop101.database

import androidx.room.*

@Dao
interface FmItemDao {
    @Query("SELECT * FROM fm_items ORDER BY descript ASC")
    suspend fun getAll(): List<FmItem>

    @Query("SELECT * FROM fm_items WHERE icode = :icode LIMIT 1")
    suspend fun getByCode(icode: String): FmItem?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<FmItem>)
}
