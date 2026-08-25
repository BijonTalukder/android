package com.example.gateway.service;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.example.gateway.GatewayApplication;
import com.example.gateway.R;
import com.example.gateway.repository.GatewayRepository;
import com.example.gateway.storage.DeviceConfigEntity;
import com.example.gateway.ui.MainActivity;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Opt-in fast polling.
 *
 * <h3>Why a foreground service exists here at all</h3>
 *
 * WorkManager cannot run periodic work more often than every 15 minutes. A
 * gateway that is supposed to react within its configured 30-second polling
 * interval therefore needs a foreground service -- this is the one case where
 * modern Android considers one genuinely necessary, and it is why the service
 * shows a permanent, user-dismissible-by-stopping notification saying exactly
 * what it is doing.
 *
 * The service is <b>not</b> assumed to live forever. The user can stop it, the
 * system can kill it under memory pressure, and it does not restart itself
 * silently. The WorkManager schedule keeps running underneath as the reliable
 * floor, so stopping this service degrades the cadence rather than breaking
 * the agent.
 */
public class GatewayForegroundService extends Service {

    private static final String TAG = "GatewayService";
    private static final int NOTIFICATION_ID = 4711;

    public static final String ACTION_START = "com.example.gateway.action.START_GATEWAY";
    public static final String ACTION_STOP = "com.example.gateway.action.STOP_GATEWAY";

    /** Never poll faster than this, whatever the server asks for. */
    private static final int MIN_INTERVAL_SECONDS = 5;

    private static final AtomicBoolean RUNNING = new AtomicBoolean(false);

    private ScheduledExecutorService scheduler;
    @Nullable private ScheduledFuture<?> pollTask;
    private volatile int currentIntervalSeconds = -1;

    public static boolean isRunning() {
        return RUNNING.get();
    }

    public static void start(@NonNull Context context) {
        Intent intent = new Intent(context, GatewayForegroundService.class)
                .setAction(ACTION_START);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stop(@NonNull Context context) {
        context.startService(
                new Intent(context, GatewayForegroundService.class).setAction(ACTION_STOP));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        scheduler = Executors.newSingleThreadScheduledExecutor();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Log.i(TAG, "Stop requested");
            stopSelf();
            return START_NOT_STICKY;
        }

        GatewayRepository repository = GatewayApplication.repository(this);
        if (!repository.storage().isEnrolled()) {
            Log.w(TAG, "Not enrolled; refusing to start");
            stopSelf();
            return START_NOT_STICKY;
        }

        startForegroundCompat(notification(getString(R.string.service_starting)));
        RUNNING.set(true);
        scheduleLoop();

        // START_STICKY asks the system to bring the service back after it is
        // killed for memory. It is a request, not a guarantee -- which is
        // exactly why WorkManager remains the reliable layer.
        return START_STICKY;
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    /**
     * Run one cycle now, then reschedule using the interval that is current
     * *after* the cycle -- an UPDATE_CONFIG command applied during the cycle
     * therefore takes effect on the very next tick.
     */
    private void scheduleLoop() {
        cancelPoll();
        pollTask = scheduler.schedule(this::tick, 0, TimeUnit.SECONDS);
    }

    private void tick() {
        GatewayRepository repository = GatewayApplication.repository(this);

        int interval = MIN_INTERVAL_SECONDS;
        try {
            GatewayRepository.CycleReport report = repository.runCommandCycle();
            repository.sendHeartbeat();

            DeviceConfigEntity config = repository.currentConfig();
            interval = Math.max(MIN_INTERVAL_SECONDS, config.pollingIntervalSeconds);

            if (currentIntervalSeconds != interval) {
                currentIntervalSeconds = interval;
                Log.i(TAG, "Polling every " + interval + "s");
            }

            updateNotification(getString(
                    R.string.service_running,
                    repository.storage().getDeviceId() == null
                            ? "device"
                            : repository.storage().getDeviceId(),
                    interval));

            if (report.unauthorized) {
                Log.w(TAG, "Credentials rejected; stopping");
                stopSelf();
                return;
            }
        } catch (RuntimeException error) {
            // A crash in the loop must not take the service down silently.
            Log.e(TAG, "Poll cycle threw", error);
            updateNotification(getString(R.string.service_error));
        }

        if (RUNNING.get() && !scheduler.isShutdown()) {
            pollTask = scheduler.schedule(this::tick, interval, TimeUnit.SECONDS);
        }
    }

    private void cancelPoll() {
        if (pollTask != null) {
            pollTask.cancel(false);
            pollTask = null;
        }
    }

    private Notification notification(@NonNull String text) {
        PendingIntent open = PendingIntent.getActivity(
                this,
                0,
                new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Intent stopIntent = new Intent(this, GatewayForegroundService.class)
                .setAction(ACTION_STOP);
        PendingIntent stop = PendingIntent.getService(
                this, 1, stopIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        return new NotificationCompat.Builder(this, GatewayApplication.NOTIFICATION_CHANNEL_ID)
                .setContentTitle(getString(R.string.service_notification_title))
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_upload)
                .setOngoing(true)
                .setContentIntent(open)
                // A foreground service the user cannot stop from its own
                // notification is hostile; this action makes it one tap.
                .addAction(0, getString(R.string.action_stop), stop)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void updateNotification(@NonNull String text) {
        android.app.NotificationManager manager =
                getSystemService(android.app.NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, notification(text));
        }
    }

    @Override
    public void onDestroy() {
        RUNNING.set(false);
        cancelPoll();
        scheduler.shutdownNow();
        Log.i(TAG, "Service stopped");
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        // Started service only; nothing binds to it.
        return null;
    }
}
