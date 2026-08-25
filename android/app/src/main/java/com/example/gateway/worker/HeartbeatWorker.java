package com.example.gateway.worker;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.example.gateway.GatewayApplication;
import com.example.gateway.repository.GatewayRepository;

/**
 * Periodic liveness ping.
 *
 * A heartbeat is also how the device learns about a configuration change and
 * how many commands are waiting, so a successful heartbeat that reports pending
 * work schedules an immediate poll rather than waiting for the next period.
 */
public class HeartbeatWorker extends Worker {

    public HeartbeatWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        GatewayRepository repository = GatewayApplication.repository(getApplicationContext());

        if (!repository.storage().isEnrolled()) {
            // Nothing to do until an operator enrolls this device.
            return Result.success();
        }

        int pending = repository.sendHeartbeat();

        if (pending < 0) {
            // Could not reach the server. WorkManager applies the exponential
            // backoff configured in WorkScheduler.
            return Result.retry();
        }

        if (pending > 0) {
            WorkScheduler.pollNow(getApplicationContext());
        }

        return Result.success();
    }
}
