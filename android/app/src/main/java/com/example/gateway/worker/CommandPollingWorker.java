package com.example.gateway.worker;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.example.gateway.GatewayApplication;
import com.example.gateway.repository.GatewayRepository;

/**
 * Claims and executes pending commands.
 *
 * The worker returns {@code success} even when individual commands fail: a
 * command that failed has already been reported to the backend as FAILED, and
 * retrying the worker would only claim different commands. Only a genuine
 * transport failure asks WorkManager to retry.
 */
public class CommandPollingWorker extends Worker {

    private static final String TAG = "CommandPollingWorker";

    public CommandPollingWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        GatewayRepository repository = GatewayApplication.repository(getApplicationContext());

        if (!repository.storage().isEnrolled()) {
            return Result.success();
        }

        GatewayRepository.CycleReport report = repository.runCommandCycle();

        Log.d(TAG, "Cycle: executed=" + report.commandsExecuted
                + " failed=" + report.commandsFailed
                + " flushed=" + report.resultsFlushed);

        if (report.unauthorized) {
            // The repository has already cleared the enrollment and cancelled
            // scheduled work. Retrying would be pointless.
            return Result.success();
        }

        if (report.shouldRetry()) {
            // Anything we could not report is durably queued, so a retry is an
            // optimisation rather than the only path to delivery.
            WorkScheduler.flushResultsWhenOnline(getApplicationContext());
            return Result.retry();
        }

        return Result.success();
    }
}
