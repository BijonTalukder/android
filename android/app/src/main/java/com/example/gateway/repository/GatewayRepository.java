package com.example.gateway.repository;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.WorkerThread;

import com.example.gateway.BuildConfig;
import com.example.gateway.command.CommandExecutor;
import com.example.gateway.command.CommandResult;
import com.example.gateway.model.CommandErrorDto;
import com.example.gateway.model.CommandResultRequest;
import com.example.gateway.model.DeviceCommand;
import com.example.gateway.model.DeviceConfigResponse;
import com.example.gateway.model.DeviceInfo;
import com.example.gateway.model.HeartbeatRequest;
import com.example.gateway.model.HeartbeatResponse;
import com.example.gateway.model.RegisterRequest;
import com.example.gateway.model.RegisterResponse;
import com.example.gateway.network.ApiClient;
import com.example.gateway.network.ApiException;
import com.example.gateway.network.GatewayApi;
import com.example.gateway.storage.AppDatabase;
import com.example.gateway.storage.DeviceConfigEntity;
import com.example.gateway.storage.PendingResultEntity;
import com.example.gateway.storage.SecureStorage;
import com.example.gateway.transport.CommandTransport;
import com.example.gateway.util.DeviceInfoProvider;
import com.example.gateway.util.GatewayEvents;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * The gateway agent's brain.
 *
 * Owns the full cycle -- enroll, heartbeat, claim, execute, report -- and the
 * offline queue that makes reporting survive a dropped network.
 *
 * The invariant that matters most: <b>a command is executed exactly once</b>.
 * Execution happens only in {@link #runCommandCycle}, immediately after the
 * server has atomically handed the command over. If reporting the result then
 * fails, only the <em>result</em> is queued for retry. Nothing in the retry
 * path can re-run a handler.
 *
 * Every method here blocks and must be called from a worker thread.
 */
public class GatewayRepository {

    private static final String TAG = "GatewayRepository";

    private static final int COMMAND_BATCH_SIZE = 10;
    private static final int RESULT_FLUSH_BATCH = 25;
    /** Give up on a queued result after this many failed deliveries. */
    private static final int MAX_RESULT_ATTEMPTS = 25;
    private static final long ABANDONED_RETENTION_MS = 7L * 24 * 60 * 60 * 1000;

    private static final int DEFAULT_POLLING_SECONDS = 30;
    private static final int DEFAULT_HEARTBEAT_SECONDS = 60;

    private final Context context;
    private final SecureStorage storage;
    private final AppDatabase database;
    private final CommandExecutor executor;
    private final CommandTransport transport;
    private final DeviceInfoProvider deviceInfo;
    private final Gson gson = new Gson();

    public GatewayRepository(
            @NonNull Context context,
            @NonNull SecureStorage storage,
            @NonNull AppDatabase database,
            @NonNull CommandExecutor executor,
            @NonNull CommandTransport transport,
            @NonNull DeviceInfoProvider deviceInfo) {
        this.context = context.getApplicationContext();
        this.storage = storage;
        this.database = database;
        this.executor = executor;
        this.transport = transport;
        this.deviceInfo = deviceInfo;
    }

    /* ------------------------------------------------------------------ */
    /* Enrollment                                                          */
    /* ------------------------------------------------------------------ */

    /** Result of an enrollment attempt, for the UI to render. */
    public static final class EnrollmentOutcome {
        public final boolean success;
        @Nullable public final String deviceId;
        @Nullable public final String errorMessage;

        private EnrollmentOutcome(
                boolean success, @Nullable String deviceId, @Nullable String errorMessage) {
            this.success = success;
            this.deviceId = deviceId;
            this.errorMessage = errorMessage;
        }

        static EnrollmentOutcome ok(String deviceId) {
            return new EnrollmentOutcome(true, deviceId, null);
        }

        static EnrollmentOutcome error(String message) {
            return new EnrollmentOutcome(false, null, message);
        }
    }

    @WorkerThread
    @NonNull
    public EnrollmentOutcome enroll(
            @NonNull String enrollmentCode,
            @NonNull String deviceName,
            @NonNull String baseUrl) {

        storage.setBaseUrl(baseUrl);
        // The base URL is part of the client's identity, so drop the cached one.
        ApiClient.reset();

        DeviceInfo info = new DeviceInfo(storage.getOrCreateInstallationId(), deviceName);
        info.manufacturer = deviceInfo.manufacturer();
        info.model = deviceInfo.model();
        info.androidVersion = deviceInfo.androidVersion();
        info.sdkVersion = deviceInfo.sdkVersion();
        info.appVersion = deviceInfo.appVersion();

        try {
            GatewayApi api = ApiClient.api(storage);
            RegisterResponse response = ApiClient.execute(
                    api.register(new RegisterRequest(enrollmentCode.trim(), info)));

            storage.saveEnrollment(
                    response.deviceApiToken,
                    response.device.deviceId,
                    response.device.deviceName);

            if (response.config != null) {
                saveConfigurationInternal(
                        response.config.pollingIntervalSeconds,
                        response.config.heartbeatIntervalSeconds);
            }

            Log.i(TAG, "Enrolled as " + response.device.deviceId);
            GatewayEvents.emit(GatewayEvents.Event.STATE_CHANGED);
            return EnrollmentOutcome.ok(response.device.deviceId);

        } catch (ApiException error) {
            Log.w(TAG, "Enrollment refused: " + error.getMessage());
            return EnrollmentOutcome.error(error.getMessage());
        } catch (IOException error) {
            Log.w(TAG, "Enrollment could not reach the server", error);
            return EnrollmentOutcome.error(
                    "Could not reach " + baseUrl + ". Check the address and the network.");
        }
    }

    /* ------------------------------------------------------------------ */
    /* Heartbeat                                                           */
    /* ------------------------------------------------------------------ */

    /**
     * @return the number of commands the server says are waiting, or -1 when
     *         the heartbeat did not complete.
     */
    @WorkerThread
    public int sendHeartbeat() {
        if (!storage.isEnrolled()) {
            return -1;
        }

        HeartbeatRequest request = new HeartbeatRequest();
        request.batteryLevel = deviceInfo.batteryLevel();
        request.isCharging = deviceInfo.isCharging();
        request.networkType = deviceInfo.networkType();
        request.appVersion = deviceInfo.appVersion();

        try {
            GatewayApi api = ApiClient.api(storage);
            HeartbeatResponse response = ApiClient.execute(api.heartbeat(request));

            if (response.config != null) {
                // The server is authoritative about cadence.
                saveConfigurationInternal(
                        response.config.pollingIntervalSeconds,
                        response.config.heartbeatIntervalSeconds);
            }
            GatewayEvents.emit(GatewayEvents.Event.STATE_CHANGED);
            return response.pendingCommands;

        } catch (ApiException error) {
            handleAuthFailure(error);
            Log.w(TAG, "Heartbeat refused: " + error.getMessage());
            return -1;
        } catch (IOException error) {
            Log.d(TAG, "Heartbeat could not reach the server: " + error.getMessage());
            return -1;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Command cycle                                                       */
    /* ------------------------------------------------------------------ */

    /** What one cycle did, for logging and for the UI. */
    public static final class CycleReport {
        public int resultsFlushed;
        public int commandsExecuted;
        public int commandsFailed;
        public boolean networkFailure;
        public boolean unauthorized;

        public boolean shouldRetry() {
            return networkFailure && !unauthorized;
        }
    }

    /**
     * Flush any queued results, claim whatever is pending, run it, report back.
     *
     * Ordering is deliberate: results first, so a command whose outcome is
     * still queued is reported before the device asks for more work.
     */
    @WorkerThread
    @NonNull
    public CycleReport runCommandCycle() {
        CycleReport report = new CycleReport();

        if (!storage.isEnrolled()) {
            return report;
        }

        report.resultsFlushed = flushPendingResults();

        List<DeviceCommand> commands;
        try {
            commands = transport.receive(COMMAND_BATCH_SIZE);
        } catch (ApiException error) {
            handleAuthFailure(error);
            report.unauthorized = error.isUnauthorized() || error.isForbidden();
            report.networkFailure = error.isRetryable();
            Log.w(TAG, "Command poll refused: " + error.getMessage());
            return report;
        } catch (IOException error) {
            report.networkFailure = true;
            Log.d(TAG, "Command poll could not reach the server: " + error.getMessage());
            return report;
        }

        for (DeviceCommand command : commands) {
            // Past this line the command has been claimed and WILL be executed
            // exactly once. Everything after it concerns reporting only.
            CommandResult result = executor.execute(command);

            if (result.isSuccess()) {
                report.commandsExecuted++;
            } else {
                report.commandsFailed++;
            }

            boolean reported = submitResult(command.id, command.claimId, result);
            if (!reported) {
                report.networkFailure = true;
            }
        }

        if (!commands.isEmpty()) {
            GatewayEvents.emit(GatewayEvents.Event.STATE_CHANGED);
        }
        return report;
    }

    /**
     * Report one result.
     *
     * @return {@code true} when the backend has the outcome (or has told us it
     *         no longer wants it); {@code false} when it has been queued for
     *         a later retry.
     */
    @WorkerThread
    private boolean submitResult(
            @NonNull String commandId,
            @NonNull String claimId,
            @NonNull CommandResult result) {

        CommandResultRequest request = buildRequest(claimId, result);

        try {
            GatewayApi api = ApiClient.api(storage);
            ApiClient.execute(api.submitResult(commandId, request));
            return true;

        } catch (ApiException error) {
            handleAuthFailure(error);

            if (error.isStaleClaim()) {
                // The command was re-queued while we were working on it. The
                // server will hand it out again; reporting against the dead
                // claim would be wrong, and retrying can never succeed.
                Log.w(TAG, "Discarding result for stale claim on " + commandId);
                return true;
            }
            if (!error.isRetryable()) {
                // A 4xx that is not a stale claim means the server will never
                // accept this body. Queueing it would loop forever.
                Log.w(TAG, "Result permanently rejected for " + commandId + ": " + error.getMessage());
                return true;
            }
            queueResult(commandId, claimId, result);
            return false;

        } catch (IOException error) {
            queueResult(commandId, claimId, result);
            return false;
        }
    }

    private CommandResultRequest buildRequest(
            @NonNull String claimId, @NonNull CommandResult result) {
        CommandResultRequest request = new CommandResultRequest();
        request.status = result.getStatusName();
        request.claimId = claimId;
        if (result.isSuccess()) {
            request.result = result.getPayload();
        } else {
            request.error = new CommandErrorDto(
                    result.getErrorCode() == null ? "COMMAND_FAILED" : result.getErrorCode(),
                    result.getErrorMessage() == null ? "Command failed" : result.getErrorMessage());
        }
        return request;
    }

    private void queueResult(
            @NonNull String commandId,
            @NonNull String claimId,
            @NonNull CommandResult result) {

        PendingResultEntity entity = new PendingResultEntity();
        entity.commandId = commandId;
        entity.claimId = claimId;
        entity.status = result.getStatusName();
        entity.resultJson = result.isSuccess() ? gson.toJson(result.getPayload()) : null;
        entity.errorCode = result.getErrorCode();
        entity.errorMessage = result.getErrorMessage();
        entity.attempts = 1;
        entity.createdAt = System.currentTimeMillis();
        entity.lastAttemptAt = entity.createdAt;

        database.pendingResults().insert(entity);
        Log.i(TAG, "Queued result for " + commandId + " until the network returns");
    }

    /**
     * Retry queued results.
     *
     * @return how many were accepted this pass
     */
    @WorkerThread
    public int flushPendingResults() {
        List<PendingResultEntity> batch = database.pendingResults().nextBatch(RESULT_FLUSH_BATCH);
        if (batch.isEmpty()) {
            return 0;
        }

        int flushed = 0;
        long now = System.currentTimeMillis();

        for (PendingResultEntity entity : batch) {
            CommandResultRequest request = new CommandResultRequest();
            request.status = entity.status;
            request.claimId = entity.claimId;

            if ("SUCCESS".equals(entity.status)) {
                request.result = deserialise(entity.resultJson);
            } else {
                request.error = new CommandErrorDto(
                        entity.errorCode == null ? "COMMAND_FAILED" : entity.errorCode,
                        entity.errorMessage == null ? "Command failed" : entity.errorMessage);
            }

            try {
                GatewayApi api = ApiClient.api(storage);
                ApiClient.execute(api.submitResult(entity.commandId, request));
                database.pendingResults().deleteById(entity.id);
                flushed++;

            } catch (ApiException error) {
                handleAuthFailure(error);

                if (error.isStaleClaim() || !error.isRetryable()) {
                    // Will never be accepted; stop carrying it.
                    database.pendingResults().abandon(entity.id, error.getMessage(), now);
                    continue;
                }
                database.pendingResults().recordAttempt(entity.id, now);
                if (entity.attempts + 1 >= MAX_RESULT_ATTEMPTS) {
                    database.pendingResults().abandon(entity.id, "Retry limit reached", now);
                }
                // The network is unhealthy; stop hammering it this pass.
                break;

            } catch (IOException error) {
                database.pendingResults().recordAttempt(entity.id, now);
                break;
            }
        }

        database.pendingResults().purgeAbandonedBefore(now - ABANDONED_RETENTION_MS);
        return flushed;
    }

    @WorkerThread
    public int pendingResultCount() {
        return database.pendingResults().countPending();
    }

    @WorkerThread
    @NonNull
    public List<PendingResultEntity> failedResults(int limit) {
        return database.pendingResults().failed(limit);
    }

    /* ------------------------------------------------------------------ */
    /* Configuration                                                       */
    /* ------------------------------------------------------------------ */

    @WorkerThread
    @NonNull
    public DeviceConfigEntity currentConfig() {
        DeviceConfigEntity stored = database.deviceConfig().get();
        if (stored != null) {
            return stored;
        }
        return DeviceConfigEntity.of(DEFAULT_POLLING_SECONDS, DEFAULT_HEARTBEAT_SECONDS);
    }

    /** Persist a new cadence and reschedule background work to match. */
    @WorkerThread
    public void saveConfiguration(int pollingSeconds, int heartbeatSeconds) {
        saveConfigurationInternal(pollingSeconds, heartbeatSeconds);
    }

    private void saveConfigurationInternal(int pollingSeconds, int heartbeatSeconds) {
        DeviceConfigEntity previous = database.deviceConfig().get();
        boolean changed = previous == null
                || previous.pollingIntervalSeconds != pollingSeconds
                || previous.heartbeatIntervalSeconds != heartbeatSeconds;

        if (!changed) {
            return;
        }

        database.deviceConfig().save(DeviceConfigEntity.of(pollingSeconds, heartbeatSeconds));
        Log.i(TAG, "Configuration updated: poll=" + pollingSeconds + "s heartbeat=" + heartbeatSeconds + "s");

        // Reschedule so a new cadence takes effect without waiting for restart.
        com.example.gateway.worker.WorkScheduler.reschedule(context, pollingSeconds, heartbeatSeconds);
        GatewayEvents.emit(GatewayEvents.Event.STATE_CHANGED);
    }

    /** Pull configuration straight from the server, outside the heartbeat. */
    @WorkerThread
    public boolean refreshConfiguration() {
        if (!storage.isEnrolled()) {
            return false;
        }
        try {
            GatewayApi api = ApiClient.api(storage);
            DeviceConfigResponse response = ApiClient.execute(api.config());
            saveConfigurationInternal(
                    response.config.pollingIntervalSeconds,
                    response.config.heartbeatIntervalSeconds);
            storage.setSmsEnabled(response.config.smsEnabled);
            return true;
        } catch (ApiException error) {
            handleAuthFailure(error);
            return false;
        } catch (IOException error) {
            return false;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Shared helpers                                                      */
    /* ------------------------------------------------------------------ */

    /**
     * A revoked or blocked device must stop pretending to be enrolled: it drops
     * its credentials, cancels background work and tells the UI to ask for a
     * new enrollment code.
     */
    private void handleAuthFailure(@NonNull ApiException error) {
        if (!error.isUnauthorized() && !error.isForbidden()) {
            return;
        }
        Log.w(TAG, "Device credentials rejected (" + error.getHttpStatus() + "); clearing enrollment");
        storage.clearEnrollment();
        com.example.gateway.worker.WorkScheduler.cancelAll(context);
        GatewayEvents.emit(GatewayEvents.Event.UNAUTHORIZED);
    }

    @SuppressWarnings("unchecked")
    @Nullable
    private Map<String, Object> deserialise(@Nullable String json) {
        if (json == null || json.isEmpty()) {
            return Collections.emptyMap();
        }
        try {
            return gson.fromJson(json, new TypeToken<Map<String, Object>>() {}.getType());
        } catch (RuntimeException error) {
            Log.w(TAG, "Could not decode a queued result payload", error);
            return Collections.emptyMap();
        }
    }

    @NonNull
    public SecureStorage storage() {
        return storage;
    }

    @NonNull
    public String baseUrl() {
        return storage.getBaseUrl(BuildConfig.DEFAULT_BASE_URL);
    }

    @NonNull
    public CommandTransport transport() {
        return transport;
    }

    /**
     * The handler registry. Exposed so the composition root can register
     * handlers that need a reference back to this repository (SYNC_NOW and
     * UPDATE_CONFIG both act on it), which a constructor argument cannot do.
     */
    @NonNull
    public CommandExecutor executor() {
        return executor;
    }
}
