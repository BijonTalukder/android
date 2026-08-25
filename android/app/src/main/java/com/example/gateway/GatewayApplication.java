package com.example.gateway;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;

import androidx.annotation.NonNull;

import com.example.gateway.command.CommandExecutor;
import com.example.gateway.command.DeviceStatusCommandHandler;
import com.example.gateway.command.SendSmsCommandHandler;
import com.example.gateway.command.SyncCommandHandler;
import com.example.gateway.command.UpdateConfigCommandHandler;
import com.example.gateway.repository.GatewayRepository;
import com.example.gateway.service.GatewayForegroundService;
import com.example.gateway.sms.AndroidSmsSender;
import com.example.gateway.storage.AppDatabase;
import com.example.gateway.storage.DeviceConfigEntity;
import com.example.gateway.storage.SecureStorage;
import com.example.gateway.transport.CommandTransport;
import com.example.gateway.transport.PollingCommandTransport;
import com.example.gateway.util.DeviceInfoProvider;
import com.example.gateway.worker.WorkScheduler;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Composition root.
 *
 * Wiring lives here, in one readable place, rather than in a DI framework: the
 * graph is small, and being able to see the whole thing at once is worth more
 * than the indirection. Swapping the transport, the SMS sender or a command
 * handler is a one-line change in {@link #buildRepository}.
 */
public class GatewayApplication extends Application {

    public static final String NOTIFICATION_CHANNEL_ID = "gateway_status";

    private static volatile GatewayRepository repository;
    private static final Object LOCK = new Object();

    /** Shared pool for the UI's background calls. Workers bring their own thread. */
    private static final ExecutorService IO = Executors.newFixedThreadPool(2);

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        // Registering work at startup is what makes the agent self-healing
        // after a force-stop or an app update.
        IO.execute(() -> {
            GatewayRepository repo = repository(this);
            if (!repo.storage().isEnrolled()) {
                return;
            }
            DeviceConfigEntity config = repo.currentConfig();
            WorkScheduler.schedule(
                    this, config.pollingIntervalSeconds, config.heartbeatIntervalSeconds);
        });
    }

    /** The single repository instance, built lazily and safely. */
    @NonNull
    public static GatewayRepository repository(@NonNull Context context) {
        GatewayRepository local = repository;
        if (local != null) {
            return local;
        }
        synchronized (LOCK) {
            if (repository == null) {
                repository = buildRepository(context.getApplicationContext());
            }
            return repository;
        }
    }

    @NonNull
    public static ExecutorService io() {
        return IO;
    }

    private static GatewayRepository buildRepository(@NonNull Context context) {
        SecureStorage storage = new SecureStorage(context);
        AppDatabase database = AppDatabase.get(context);
        DeviceInfoProvider deviceInfo = new DeviceInfoProvider(context);

        // The MVP transport. Replacing this line with a WebSocket or MQTT
        // implementation changes nothing else in the app.
        CommandTransport transport = new PollingCommandTransport(storage);

        GatewayRepository repo = new GatewayRepository(
                context, storage, database, new CommandExecutor(), transport, deviceInfo);

        // Handlers are registered, not hard-coded into a dispatch block, so a
        // new command type is a new class plus one line here.
        repo.executor()
                .register(new DeviceStatusCommandHandler(deviceInfo))
                .register(new SyncCommandHandler(repo))
                .register(new UpdateConfigCommandHandler(repo))
                .register(new SendSmsCommandHandler(new AndroidSmsSender(context)));

        return repo;
    }

    private void createNotificationChannel() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                getString(R.string.notification_channel_name),
                // LOW: the foreground-service notification must be visible, but
                // it should never make a sound or interrupt anyone.
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.notification_channel_description));
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    /** Convenience for the UI: is the fast-polling service currently running? */
    public static boolean isForegroundServiceRunning() {
        return GatewayForegroundService.isRunning();
    }
}
