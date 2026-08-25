package com.example.gateway.storage;

import androidx.annotation.Nullable;
import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

@Dao
public interface DeviceConfigDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void save(DeviceConfigEntity entity);

    @Nullable
    @Query("SELECT * FROM device_config WHERE id = 1")
    DeviceConfigEntity get();

    @Query("DELETE FROM device_config")
    void clear();
}
