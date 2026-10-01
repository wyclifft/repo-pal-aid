package app.delicoop101.database

import androidx.room.*

@Dao
interface CmMemberDao {
    @Query("SELECT * FROM cm_members ORDER BY descript ASC")
    suspend fun getAll(): List<CmMember>

    @Query("SELECT * FROM cm_members WHERE mcode = :mcode LIMIT 1")
    suspend fun getByCode(mcode: String): CmMember?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(members: List<CmMember>)

    @Query("DELETE FROM cm_members")
    suspend fun deleteAll()
}
