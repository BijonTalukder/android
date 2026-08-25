package com.example.gateway.worker;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.example.gateway.GatewayApplication;
import com.example.gateway.repository.GatewayRepository;

/**
 * Drains the offline result queue when the network comes back.
 *
 * This worker never executes a command. It only re-sends outcomes that were
 * already produced, which is what keeps result delivery retryable without ever
 * risking a second execution.
 */
public class ResultRetryWorker extends Worker {

    private static final String TAG = "ResultRetryWorker";

    public ResultRetryWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        GatewayRepository repository = GatewayApplication.repository(getApplicationContext());

        if (!repository.storage().isEnrolled()) {
            return Result.success();
        }

        int flushed = repository.flushPendingResults();
        int remaining = repository.pendingResultCount();

        Log.d(TAG, "Flushed " + flushed + " result(s), " + remaining + " still queued");

        // Still something queued and nothing got through: come back later.
        return remaining > 0 && flushed == 0 ? Result.retry() : Result.success();
    }
}
