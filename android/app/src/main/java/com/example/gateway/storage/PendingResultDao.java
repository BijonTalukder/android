package com.example.gateway.storage;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import java.util.List;

@Dao
public interface PendingResultDao {

    /**
     * REPLACE on the unique {@code commandId}: if the same command somehow
     * produces a second result, the newer one wins rather than the queue
     * growing a duplicate.
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    long insert(PendingResultEntity entity);

    /** Oldest first, so results are reported in the order they happened. */
    @Query("SELECT * FROM pending_results WHERE abandoned = 0 ORDER BY createdAt ASC LIMIT :limit")
    List<PendingResultEntity> nextBatch(int limit);

    @Query("SELECT COUNT(*) FROM pending_results WHERE abandoned = 0")
    int countPending();

    @Query("SELECT * FROM pending_results WHERE abandoned = 1 ORDER BY lastAttemptAt DESC LIMIT :limit")
    List<PendingResultEntity> failed(int limit);

    @Query("DELETE FROM pending_results WHERE id = :id")
    void deleteById(long id);

    @Query("UPDATE pending_results SET attempts = attempts + 1, lastAttemptAt = :now WHERE id = :id")
    void recordAttempt(long id, long now);

    @Query("UPDATE pending_results SET abandoned = 1, abandonedReason = :reason, lastAttemptAt = :now WHERE id = :id")
    void abandon(long id, String reason, long now);

    @Query("DELETE FROM pending_results WHERE abandoned = 1 AND lastAttemptAt < :before")
    void purgeAbandonedBefore(long before);
}
