package com.example.gateway.storage;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

/** Local persistence: the offline result queue and the cached device config. */
@Database(
        entities = {PendingResultEntity.class, DeviceConfigEntity.class},
        version = 1,
        exportSchema = true)
public abstract class AppDatabase extends RoomDatabase {

    private static final String NAME = "gateway.db";

    private static volatile AppDatabase instance;

    public abstract PendingResultDao pendingResults();

    public abstract DeviceConfigDao deviceConfig();

    public static AppDatabase get(@NonNull Context context) {
        AppDatabase local = instance;
        if (local != null) {
            return local;
        }
        synchronized (AppDatabase.class) {
            if (instance == null) {
                instance = Room.databaseBuilder(
                                context.getApplicationContext(),
                                AppDatabase.class,
                                NAME)
                        // Every caller is already a worker or a background
                        // executor; enforcing that keeps disk I/O off the main
                        // thread rather than silently allowing it.
                        .build();
            }
            return instance;
        }
    }
}
