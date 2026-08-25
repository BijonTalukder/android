package com.example.gateway.worker;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

/**
 * Owns every WorkManager registration.
 *
 * <h3>Why the configured interval is not always honoured</h3>
 *
 * WorkManager's minimum periodic interval is 15 minutes, and Doze can defer
 * even that. A 30-second polling interval is therefore <em>not achievable</em>
 * with periodic work, and pretending otherwise would be dishonest.
 *
 * The app resolves this with two layers:
 *
 * <ul>
 *   <li><b>Periodic work</b> (this class) is the reliable floor. It survives
 *       reboot, process death and app updates, and it runs at the fastest
 *       cadence the platform actually allows.</li>
 *   <li><b>{@link com.example.gateway.service.GatewayForegroundService}</b> is
 *       opt-in and delivers the configured sub-15-minute cadence. It shows a
 *       persistent notification, because that is the only supported way to keep
 *       a device doing frequent background work on modern Android.</li>
 * </ul>
 *
 * No long-running background service is assumed to survive on its own.
 */
public final class WorkScheduler {

    private static final String TAG = "WorkScheduler";

    public static final String WORK_HEARTBEAT = "gateway-heartbeat";
    public static final String WORK_POLL = "gateway-command-poll";
    public static final String WORK_FLUSH_RESULTS = "gateway-flush-results";
    public static final String WORK_POLL_ONCE = "gateway-command-poll-once";

    /** WorkManager's hard floor for periodic work. */
    private static final long MIN_PERIODIC_MINUTES = 15;

    private static Constraints networkConstraints() {
        return new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
    }

    /** (Re)register the periodic workers for the given cadence. */
    public static void schedule(
            @NonNull Context context, int pollingSeconds, int heartbeatSeconds) {

        WorkManager manager = WorkManager.getInstance(context);

        long heartbeatMinutes = clampToPeriodicFloor(heartbeatSeconds);
        long pollMinutes = clampToPeriodicFloor(pollingSeconds);

        PeriodicWorkRequest heartbeat = new PeriodicWorkRequest.Builder(
                HeartbeatWorker.class, heartbeatMinutes, TimeUnit.MINUTES)
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(WORK_HEARTBEAT)
                .build();

        PeriodicWorkRequest poll = new PeriodicWorkRequest.Builder(
                CommandPollingWorker.class, pollMinutes, TimeUnit.MINUTES)
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(WORK_POLL)
                .build();

        // UPDATE replaces an existing schedule in place, so changing the
        // cadence does not lose the work or duplicate it.
        manager.enqueueUniquePeriodicWork(
                WORK_HEARTBEAT, ExistingPeriodicWorkPolicy.UPDATE, heartbeat);
        manager.enqueueUniquePeriodicWork(
                WORK_POLL, ExistingPeriodicWorkPolicy.UPDATE, poll);

        Log.i(TAG, "Scheduled heartbeat every " + heartbeatMinutes
                + "m and polling every " + pollMinutes + "m"
                + " (requested " + heartbeatSeconds + "s / " + pollingSeconds + "s)");
    }

    public static void reschedule(
            @NonNull Context context, int pollingSeconds, int heartbeatSeconds) {
        schedule(context, pollingSeconds, heartbeatSeconds);
    }

    /** Run one poll cycle as soon as the network allows. */
    public static void pollNow(@NonNull Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(CommandPollingWorker.class)
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .addTag(WORK_POLL_ONCE)
                .build();

        // KEEP: a burst of taps should not queue a burst of polls.
        WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_POLL_ONCE, ExistingWorkPolicy.KEEP, request);
    }

    /**
     * Retry the offline result queue when connectivity returns. The network
     * constraint is what makes this cheap: the worker does not run at all while
     * the device is offline.
     */
    public static void flushResultsWhenOnline(@NonNull Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ResultRetryWorker.class)
                .setConstraints(networkConstraints())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(WORK_FLUSH_RESULTS)
                .build();

        WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_FLUSH_RESULTS, ExistingWorkPolicy.KEEP, request);
    }

    public static void cancelAll(@NonNull Context context) {
        WorkManager manager = WorkManager.getInstance(context);
        manager.cancelUniqueWork(WORK_HEARTBEAT);
        manager.cancelUniqueWork(WORK_POLL);
        manager.cancelUniqueWork(WORK_POLL_ONCE);
        manager.cancelUniqueWork(WORK_FLUSH_RESULTS);
        Log.i(TAG, "Cancelled all gateway work");
    }

    private static long clampToPeriodicFloor(int seconds) {
        long minutes = Math.max(1, Math.round(seconds / 60.0));
        return Math.max(MIN_PERIODIC_MINUTES, minutes);
    }

    private WorkScheduler() {
        throw new AssertionError("No instances");
    }
}
