package app.delicoop101.database

import androidx.room.*

@Dao
interface UserDao {
    @Query("SELECT * FROM Users WHERE userid = :userid LIMIT 1")
    suspend fun getByUserId(userid: String): UserEntity?

    @Query("SELECT * FROM Users")
    suspend fun getAll(): List<UserEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(users: List<UserEntity>)
}
