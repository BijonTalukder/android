package com.example.gateway.command;

import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.example.gateway.model.DeviceCommand;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Dispatches a command to the handler registered for its type.
 *
 * Two deliberate behaviours:
 *
 *  - An unknown type is a reported failure, not a crash and not silence. An
 *    older app build must tell the backend it cannot run a newer command so the
 *    operator sees why nothing happened.
 *  - A handler that throws is converted into a FAILED result. The command has
 *    still been claimed, so leaving it unanswered would strand it until the
 *    server's delivery timeout.
 */
public class CommandExecutor {

    private static final String TAG = "CommandExecutor";

    private final Map<String, CommandHandler> handlers = new LinkedHashMap<>();

    public CommandExecutor register(@NonNull CommandHandler handler) {
        handlers.put(handler.getType(), handler);
        return this;
    }

    public boolean supports(@Nullable String type) {
        return type != null && handlers.containsKey(type);
    }

    @NonNull
    public Collection<String> supportedTypes() {
        return handlers.keySet();
    }

    @NonNull
    public CommandResult execute(@NonNull DeviceCommand command) {
        CommandHandler handler = handlers.get(command.type);

        if (handler == null) {
            Log.w(TAG, "No handler registered for " + command.type);
            return CommandResult.failure(
                    "UNSUPPORTED_COMMAND",
                    "This app version cannot execute " + command.type);
        }

        try {
            return handler.execute(command);
        } catch (Exception error) {
            Log.e(TAG, "Handler for " + command.type + " threw", error);
            String message = error.getMessage() == null
                    ? error.getClass().getSimpleName()
                    : error.getMessage();
            return CommandResult.failure("HANDLER_ERROR", message);
        }
    }
}
