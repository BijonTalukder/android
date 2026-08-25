package com.example.gateway.command;

import androidx.annotation.NonNull;

import com.example.gateway.model.DeviceCommand;
import com.example.gateway.repository.GatewayRepository;
import com.example.gateway.util.DeviceInfoProvider;

/**
 * {@code SYNC_NOW}: perform an immediate synchronisation.
 *
 * In this MVP a sync means "re-read configuration from the server and flush the
 * offline result queue" -- both real, observable operations rather than a stub.
 * A product with its own domain data would extend this handler rather than add
 * a new command type.
 */
public class SyncCommandHandler implements CommandHandler {

    public static final String TYPE = "SYNC_NOW";

    private final GatewayRepository repository;

    public SyncCommandHandler(@NonNull GatewayRepository repository) {
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
        String scope = command.getString("scope");
        if (scope == null) {
            scope = "ALL";
        }

        boolean configSynced = false;
        int resultsFlushed = 0;

        if ("ALL".equals(scope) || "CONFIG".equals(scope)) {
            configSynced = repository.refreshConfiguration();
        }
        if ("ALL".equals(scope) || "RESULTS".equals(scope)) {
            resultsFlushed = repository.flushPendingResults();
        }

        return new CommandResult.Builder()
                .put("synced", true)
                .put("scope", scope)
                .put("configSynced", configSynced)
                .put("resultsFlushed", resultsFlushed)
                .put("syncedAt", DeviceInfoProvider.nowIso8601())
                .build();
    }
}
