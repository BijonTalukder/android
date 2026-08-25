package com.example.gateway.transport;

import androidx.annotation.NonNull;

import com.example.gateway.model.DeviceCommand;
import com.example.gateway.network.ApiException;

import java.io.IOException;
import java.util.List;

/**
 * How commands reach this device.
 *
 * The execution pipeline -- claim, run, report -- depends on this interface
 * only. Swapping polling for a push transport (WebSocket, MQTT, RabbitMQ) means
 * adding an implementation here; {@code CommandExecutor}, every handler, and
 * the offline result queue stay exactly as they are.
 */
public interface CommandTransport {

    /** Stable name, mirrored in logs and on the server side. */
    @NonNull
    String getName();

    /**
     * Obtain up to {@code limit} commands addressed to this device.
     *
     * For a pull transport this is a network round trip. For a push transport
     * it would drain a locally buffered queue that the connection has been
     * filling, and the caller would not have to change.
     */
    @NonNull
    List<DeviceCommand> receive(int limit) throws ApiException, IOException;
}
