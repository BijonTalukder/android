package com.example.gateway.receiver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.example.gateway.GatewayApplication;
import com.example.gateway.repository.GatewayRepository;
import com.example.gateway.storage.DeviceConfigEntity;
import com.example.gateway.worker.WorkScheduler;

/**
 * Re-arms the agent after a reboot or an app update.
 *
 * WorkManager already restores its own schedule across reboots, but an app that
 * has never run since boot has no chance to react to a configuration change, so
 * this receiver re-registers the workers with the cadence stored in Room and
 * kicks a poll to catch up on anything queued while the device was off.
 *
 * The foreground service is deliberately <em>not</em> auto-started: starting a
 * user-visible ongoing service without the user asking is exactly the kind of
 * background behaviour modern Android restricts.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(@NonNull Context context, @Nullable Intent intent) {
        if (intent == null) {
            return;
        }
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }

        Log.i(TAG, "Re-arming gateway work after " + action);

        // A receiver has ~10 seconds on the main thread; the database read and
        // scheduling both move off it.
        final PendingResult pending = goAsync();
        Context appContext = context.getApplicationContext();

        GatewayApplication.io().execute(() -> {
            try {
                GatewayRepository repository = GatewayApplication.repository(appContext);
                if (!repository.storage().isEnrolled()) {
                    return;
                }
                DeviceConfigEntity config = repository.currentConfig();
                WorkScheduler.schedule(
                        appContext,
                        config.pollingIntervalSeconds,
                        config.heartbeatIntervalSeconds);
                WorkScheduler.pollNow(appContext);
            } catch (RuntimeException error) {
                Log.e(TAG, "Could not re-arm gateway work", error);
            } finally {
                pending.finish();
            }
        });
    }
}
