package com.example.gateway.command;

import androidx.annotation.NonNull;

import com.example.gateway.model.DeviceCommand;

/**
 * One command type, one handler.
 *
 * Adding a command means adding a class and registering it -- never editing a
 * growing if/else in the executor. A handler must not throw for an expected
 * failure: it returns {@link CommandResult#failure} so the operator sees a
 * typed error instead of a stack trace.
 */
public interface CommandHandler {

    /** Must match the backend's command type exactly, e.g. {@code SYNC_NOW}. */
    @NonNull
    String getType();

    @NonNull
    CommandResult execute(@NonNull DeviceCommand command) throws Exception;
}
