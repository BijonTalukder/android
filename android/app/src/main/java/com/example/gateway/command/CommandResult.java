package com.example.gateway.command;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** The outcome of running one command locally. */
public final class CommandResult {

    public enum Status { SUCCESS, FAILED }

    private final Status status;
    private final Map<String, Object> payload;
    @Nullable private final String errorCode;
    @Nullable private final String errorMessage;

    private CommandResult(
            Status status,
            Map<String, Object> payload,
            @Nullable String errorCode,
            @Nullable String errorMessage) {
        this.status = status;
        this.payload = payload;
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
    }

    public static CommandResult success(@NonNull Map<String, Object> payload) {
        return new CommandResult(Status.SUCCESS, payload, null, null);
    }

    public static CommandResult success() {
        return success(Collections.emptyMap());
    }

    public static CommandResult failure(@NonNull String code, @NonNull String message) {
        return new CommandResult(Status.FAILED, Collections.emptyMap(), code, message);
    }

    public boolean isSuccess() {
        return status == Status.SUCCESS;
    }

    @NonNull
    public String getStatusName() {
        return status.name();
    }

    @NonNull
    public Map<String, Object> getPayload() {
        return payload;
    }

    @Nullable
    public String getErrorCode() {
        return errorCode;
    }

    @Nullable
    public String getErrorMessage() {
        return errorMessage;
    }

    /** Small builder for handlers that assemble a result field by field. */
    public static final class Builder {
        private final Map<String, Object> values = new LinkedHashMap<>();

        public Builder put(@NonNull String key, @Nullable Object value) {
            if (value != null) {
                values.put(key, value);
            }
            return this;
        }

        public CommandResult build() {
            return success(values);
        }
    }
}
