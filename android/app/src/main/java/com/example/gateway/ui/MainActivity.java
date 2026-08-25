package com.example.gateway.ui;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.view.View;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.example.gateway.BuildConfig;
import com.example.gateway.GatewayApplication;
import com.example.gateway.R;
import com.example.gateway.databinding.ActivityMainBinding;
import com.example.gateway.repository.GatewayRepository;
import com.example.gateway.service.GatewayForegroundService;
import com.example.gateway.storage.DeviceConfigEntity;
import com.example.gateway.storage.SecureStorage;
import com.example.gateway.util.DeviceInfoProvider;
import com.example.gateway.util.GatewayEvents;
import com.example.gateway.worker.WorkScheduler;

/**
 * The operator-facing screen.
 *
 * Two states: not enrolled (collect a server URL, a name and an enrollment
 * code) and enrolled (show what the agent is doing and offer manual controls).
 * Everything that touches the network or the database runs on the shared IO
 * executor; the UI thread only renders.
 */
public class MainActivity extends AppCompatActivity implements GatewayEvents.Listener {

    private ActivityMainBinding binding;
    private GatewayRepository repository;
    private SecureStorage storage;
    private DeviceInfoProvider deviceInfo;

    private ActivityResultLauncher<String> notificationPermission;
    private ActivityResultLauncher<String> smsPermission;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        repository = GatewayApplication.repository(this);
        storage = repository.storage();
        deviceInfo = new DeviceInfoProvider(this);

        registerPermissionLaunchers();
        bindActions();
        askForNotificationPermission();
    }

    private void registerPermissionLaunchers() {
        notificationPermission = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> {
                    if (!granted) {
                        toast(getString(R.string.notifications_denied));
                    }
                });

        smsPermission = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> {
                    toast(getString(granted
                            ? R.string.sms_permission_granted
                            : R.string.sms_permission_denied));
                    render();
                });
    }

    private void bindActions() {
        binding.enrollButton.setOnClickListener(v -> enroll());
        binding.syncButton.setOnClickListener(v -> syncNow());
        binding.heartbeatButton.setOnClickListener(v -> heartbeatNow());
        binding.serviceToggleButton.setOnClickListener(v -> toggleService());
        binding.smsPermissionButton.setOnClickListener(v -> requestSmsPermission());
        binding.unenrollButton.setOnClickListener(v -> confirmUnenroll());
    }

    @Override
    protected void onStart() {
        super.onStart();
        GatewayEvents.register(this);
        render();
    }

    @Override
    protected void onStop() {
        // Listeners are held strongly, so failing to unregister would leak the
        // Activity for as long as the process lives.
        GatewayEvents.unregister(this);
        super.onStop();
    }

    @Override
    public void onGatewayEvent(@NonNull GatewayEvents.Event event) {
        if (event == GatewayEvents.Event.UNAUTHORIZED) {
            toast(getString(R.string.enrollment_revoked));
        }
        render();
    }

    /* ------------------------------------------------------------------ */
    /* Rendering                                                           */
    /* ------------------------------------------------------------------ */

    private void render() {
        boolean enrolled = storage.isEnrolled();

        binding.enrollmentCard.setVisibility(enrolled ? View.GONE : View.VISIBLE);
        binding.statusCard.setVisibility(enrolled ? View.VISIBLE : View.GONE);

        if (!enrolled) {
            if (TextUtils.isEmpty(binding.serverUrlInput.getText())) {
                binding.serverUrlInput.setText(storage.getBaseUrl(BuildConfig.DEFAULT_BASE_URL));
            }
            if (TextUtils.isEmpty(binding.deviceNameInput.getText())) {
                binding.deviceNameInput.setText(deviceInfo.suggestedDeviceName());
            }
            return;
        }

        binding.deviceIdValue.setText(orDash(storage.getDeviceId()));
        binding.deviceNameValue.setText(orDash(storage.getDeviceName()));
        binding.serverValue.setText(repository.baseUrl());
        binding.transportValue.setText(repository.transport().getName());
        binding.batteryValue.setText(getString(
                R.string.battery_format,
                deviceInfo.batteryLevel() == null ? -1 : deviceInfo.batteryLevel(),
                Boolean.TRUE.equals(deviceInfo.isCharging())
                        ? getString(R.string.charging)
                        : getString(R.string.not_charging)));
        binding.networkValue.setText(deviceInfo.networkType());

        boolean serviceRunning = GatewayForegroundService.isRunning();
        binding.serviceToggleButton.setText(getString(
                serviceRunning ? R.string.stop_fast_polling : R.string.start_fast_polling));
        binding.serviceStateValue.setText(getString(
                serviceRunning ? R.string.service_state_on : R.string.service_state_off));

        boolean smsGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
                == PackageManager.PERMISSION_GRANTED;
        binding.smsPermissionButton.setVisibility(smsGranted ? View.GONE : View.VISIBLE);
        binding.smsStateValue.setText(getString(smsGranted
                ? R.string.sms_state_granted
                : R.string.sms_state_not_granted));

        // Config and the queue depth live in Room, so read them off the UI thread.
        GatewayApplication.io().execute(() -> {
            DeviceConfigEntity config = repository.currentConfig();
            int queued = repository.pendingResultCount();
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) {
                    return;
                }
                binding.intervalsValue.setText(getString(
                        R.string.intervals_format,
                        config.pollingIntervalSeconds,
                        config.heartbeatIntervalSeconds));
                binding.queueValue.setText(
                        getResources().getQuantityString(R.plurals.queued_results, queued, queued));
            });
        });
    }

    /* ------------------------------------------------------------------ */
    /* Actions                                                             */
    /* ------------------------------------------------------------------ */

    private void enroll() {
        String baseUrl = text(binding.serverUrlInput);
        String deviceName = text(binding.deviceNameInput);
        String code = text(binding.enrollmentCodeInput);

        if (baseUrl.isEmpty()) {
            binding.serverUrlInput.setError(getString(R.string.error_server_required));
            return;
        }
        if (deviceName.isEmpty()) {
            binding.deviceNameInput.setError(getString(R.string.error_name_required));
            return;
        }
        if (code.isEmpty()) {
            binding.enrollmentCodeInput.setError(getString(R.string.error_code_required));
            return;
        }

        setBusy(true, getString(R.string.enrolling));

        GatewayApplication.io().execute(() -> {
            GatewayRepository.EnrollmentOutcome outcome =
                    repository.enroll(code, deviceName, baseUrl);

            if (outcome.success) {
                DeviceConfigEntity config = repository.currentConfig();
                WorkScheduler.schedule(
                        this, config.pollingIntervalSeconds, config.heartbeatIntervalSeconds);
                WorkScheduler.pollNow(this);
            }

            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) {
                    return;
                }
                setBusy(false, null);
                if (outcome.success) {
                    binding.enrollmentCodeInput.setText("");
                    toast(getString(R.string.enrolled_as, outcome.deviceId));
                } else {
                    toast(outcome.errorMessage == null
                            ? getString(R.string.enrollment_failed)
                            : outcome.errorMessage);
                }
                render();
            });
        });
    }

    private void syncNow() {
        setBusy(true, getString(R.string.syncing));
        GatewayApplication.io().execute(() -> {
            GatewayRepository.CycleReport report = repository.runCommandCycle();
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) {
                    return;
                }
                setBusy(false, null);
                toast(getString(
                        R.string.sync_report,
                        report.commandsExecuted,
                        report.commandsFailed,
                        report.resultsFlushed));
                render();
            });
        });
    }

    private void heartbeatNow() {
        setBusy(true, getString(R.string.sending_heartbeat));
        GatewayApplication.io().execute(() -> {
            int pending = repository.sendHeartbeat();
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) {
                    return;
                }
                setBusy(false, null);
                toast(pending < 0
                        ? getString(R.string.heartbeat_failed)
                        : getResources().getQuantityString(
                                R.plurals.heartbeat_ok, pending, pending));
                render();
            });
        });
    }

    private void toggleService() {
        if (GatewayForegroundService.isRunning()) {
            GatewayForegroundService.stop(this);
        } else {
            GatewayForegroundService.start(this);
        }
        // The service flips its own flag asynchronously; re-render shortly after.
        binding.getRoot().postDelayed(this::render, 600);
    }

    private void requestSmsPermission() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.sms_permission_title)
                .setMessage(R.string.sms_permission_rationale)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.continue_label,
                        (dialog, which) -> smsPermission.launch(Manifest.permission.SEND_SMS))
                .show();
    }

    private void confirmUnenroll() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.unenroll_title)
                .setMessage(R.string.unenroll_message)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.unenroll_confirm, (dialog, which) -> {
                    GatewayForegroundService.stop(this);
                    WorkScheduler.cancelAll(this);
                    storage.clearEnrollment();
                    toast(getString(R.string.unenrolled));
                    render();
                })
                .show();
    }

    private void askForNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        // Without this the foreground service still runs, but its notification
        // is silently hidden -- which is worse than asking.
        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS);
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    private void setBusy(boolean busy, @androidx.annotation.Nullable String message) {
        binding.progress.setVisibility(busy ? View.VISIBLE : View.GONE);
        binding.progressLabel.setVisibility(busy ? View.VISIBLE : View.GONE);
        if (message != null) {
            binding.progressLabel.setText(message);
        }
        binding.enrollButton.setEnabled(!busy);
        binding.syncButton.setEnabled(!busy);
        binding.heartbeatButton.setEnabled(!busy);
    }

    private static String text(@NonNull android.widget.EditText input) {
        return input.getText() == null ? "" : input.getText().toString().trim();
    }

    private static String orDash(@androidx.annotation.Nullable String value) {
        return value == null || value.isEmpty() ? "—" : value;
    }

    private void toast(@NonNull String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }
}
