package com.example.gateway.command;

import androidx.annotation.NonNull;

import com.example.gateway.repository.GatewayRepository;
import com.example.gateway.model.DeviceCommand;
import com.example.gateway.storage.DeviceConfigEntity;

/**
 * {@code UPDATE_CONFIG}: persist a new worker cadence and reschedule the
 * background work so the change takes effect without waiting for a restart.
 */
public class UpdateConfigCommandHandler implements CommandHandler {

    public static final String TYPE = "UPDATE_CONFIG";

    /** Mirrors the bounds the backend's Zod schema enforces. */
    private static final int MIN_POLLING = 5;
    private static final int MAX_POLLING = 3600;
    private static final int MIN_HEARTBEAT = 15;
    private static final int MAX_HEARTBEAT = 3600;

    private final GatewayRepository repository;

    public UpdateConfigCommandHandler(@NonNull GatewayRepository repository) {
        this.repository = repository;
    }

    @NonNull
    @Override
    public String getType() {
        return TYPE;
    }

    @NonNull
    @Override
    public CommandResult execute(@NonNull DeviceCommand command) {
        DeviceConfigEntity current = repository.currentConfig();

        Integer polling = command.getInt("pollingIntervalSeconds");
        Integer heartbeat = command.getInt("heartbeatIntervalSeconds");

        if (polling == null && heartbeat == null) {
            return CommandResult.failure(
                    "INVALID_PAYLOAD",
                    "Provide pollingIntervalSeconds or heartbeatIntervalSeconds");
        }
        if (polling != null && (polling < MIN_POLLING || polling > MAX_POLLING)) {
            return CommandResult.failure(
                    "INVALID_PAYLOAD",
                    "pollingIntervalSeconds must be between " + MIN_POLLING + " and " + MAX_POLLING);
        }
        if (heartbeat != null && (heartbeat < MIN_HEARTBEAT || heartbeat > MAX_HEARTBEAT)) {
            return CommandResult.failure(
                    "INVALID_PAYLOAD",
                    "heartbeatIntervalSeconds must be between " + MIN_HEARTBEAT + " and " + MAX_HEARTBEAT);
        }

        int nextPolling = polling != null ? polling : current.pollingIntervalSeconds;
        int nextHeartbeat = heartbeat != null ? heartbeat : current.heartbeatIntervalSeconds;

        repository.saveConfiguration(nextPolling, nextHeartbeat);

        return new CommandResult.Builder()
                .put("applied", true)
                .put("pollingIntervalSeconds", nextPolling)
                .put("heartbeatIntervalSeconds", nextHeartbeat)
                .build();
    }
}
