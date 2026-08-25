package com.example.gateway.storage;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/**
 * A command result that has already been produced but not yet accepted by the
 * backend.
 *
 * This queue holds *results*, never commands. The command itself has already
 * run by the time a row lands here, so flushing the queue can never cause a
 * second execution -- which is exactly the property the platform needs.
 */
@Entity(
        tableName = "pending_results",
        indices = {@Index(value = "commandId", unique = true)})
public class PendingResultEntity {

    @PrimaryKey(autoGenerate = true)
    public long id;

    @NonNull
    public String commandId = "";

    @NonNull
    public String claimId = "";

    /** SUCCESS or FAILED. */
    @NonNull
    public String status = "FAILED";

    /** Result payload, serialised as JSON. */
    @Nullable
    public String resultJson;

    @Nullable
    public String errorCode;

    @Nullable
    public String errorMessage;

    public int attempts;

    public long createdAt;

    public long lastAttemptAt;

    /** Set once the queue gives up, so the row can be shown as a failed result. */
    public boolean abandoned;

    @Nullable
    public String abandonedReason;
}
