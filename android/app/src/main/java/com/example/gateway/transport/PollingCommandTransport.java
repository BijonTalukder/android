package com.example.gateway.transport;

import androidx.annotation.NonNull;

import com.example.gateway.model.CommandsResponse;
import com.example.gateway.model.DeviceCommand;
import com.example.gateway.network.ApiClient;
import com.example.gateway.network.ApiException;
import com.example.gateway.network.GatewayApi;
import com.example.gateway.storage.SecureStorage;

import java.io.IOException;
import java.util.List;

/**
 * MVP transport: pull from {@code GET /api/gateway/commands}.
 *
 * Each returned command has already been claimed atomically on the server, so
 * two overlapping polls -- from this device or any other -- can never receive
 * the same command. That guarantee lives in MongoDB, not here, which is why
 * this class needs no locking of its own.
 */
public class PollingCommandTransport implements CommandTransport {

    public static final String NAME = "polling";

    private final SecureStorage storage;

    public PollingCommandTransport(@NonNull SecureStorage storage) {
        this.storage = storage;
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @NonNull
    @Override
    public List<DeviceCommand> receive(int limit) throws ApiException, IOException {
        GatewayApi api = ApiClient.api(storage);
        CommandsResponse response = ApiClient.execute(api.fetchCommands(limit));
        return response.commandsOrEmpty();
    }
}
