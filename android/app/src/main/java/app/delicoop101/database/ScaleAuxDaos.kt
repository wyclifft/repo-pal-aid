package app.delicoop101.database

import androidx.room.*

@Dao
interface CartDao {
    @Query("SELECT * FROM cart")
    suspend fun getAll(): List<Cart>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(cart: Cart): Long

    @Query("DELETE FROM cart")
    suspend fun clear()
}

@Dao
interface DeviceConfigDao {
    @Query("SELECT * FROM device LIMIT 1")
    suspend fun getDeviceConfig(): DeviceConfig?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(config: DeviceConfig)
}

@Dao
interface ActiveSessionDao {
    @Query("SELECT * FROM session LIMIT 1")
    suspend fun getActiveSession(): ActiveSession?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(session: ActiveSession)
}

@Dao
interface MilkTransactionDao {
    @Query("SELECT * FROM milk_transaction")
    suspend fun getAll(): List<MilkTransaction>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(tx: MilkTransaction): Long

    @Query("DELETE FROM milk_transaction WHERE id IN (SELECT id FROM milk_transaction ORDER BY id DESC LIMIT -1 OFFSET 5000)")
    suspend fun trimOldEntries(): Int
}

@Dao
interface FmTankDao {
    @Query("SELECT * FROM fm_tanks")
    suspend fun getAll(): List<FmTank>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(tanks: List<FmTank>)
}

@Dao
interface SessDao {
    @Query("SELECT * FROM sess")
    suspend fun getAll(): List<Sess>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(sessions: List<Sess>)
}
