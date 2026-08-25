package com.example.gateway.storage;

import androidx.annotation.NonNull;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

/**
 * The locally cached copy of the server-issued configuration.
 *
 * Persisted in Room (rather than only in memory) so the workers still have a
 * cadence to honour after a process death or a reboot, before the first
 * heartbeat of the new session has completed.
 */
@Entity(tableName = "device_config")
public class DeviceConfigEntity {

    /** Single-row table. */
    @PrimaryKey
    public int id = 1;

    public int pollingIntervalSeconds;
    public int heartbeatIntervalSeconds;
    public long updatedAt;

    public DeviceConfigEntity() {
    }

    @NonNull
    public static DeviceConfigEntity of(int polling, int heartbeat) {
        DeviceConfigEntity entity = new DeviceConfigEntity();
        entity.pollingIntervalSeconds = polling;
        entity.heartbeatIntervalSeconds = heartbeat;
        entity.updatedAt = System.currentTimeMillis();
        return entity;
    }
}
