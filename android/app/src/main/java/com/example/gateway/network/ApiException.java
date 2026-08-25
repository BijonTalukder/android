package com.example.gateway.network;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/** A call that reached the server but was refused. */
public class ApiException extends Exception {

    private final int httpStatus;
    @Nullable private final String code;

    public ApiException(int httpStatus, @Nullable String code, @NonNull String message) {
        super(message);
        this.httpStatus = httpStatus;
        this.code = code;
    }

    public int getHttpStatus() {
        return httpStatus;
    }

    @Nullable
    public String getCode() {
        return code;
    }

    /** The device token is gone or was revoked; the app must re-enroll. */
    public boolean isUnauthorized() {
        return httpStatus == 401;
    }

    /** The device was blocked, or its organization suspended. */
    public boolean isForbidden() {
        return httpStatus == 403;
    }

    /**
     * The claim this result belongs to is no longer current. Retrying can never
     * succeed, so the queued result must be discarded rather than looped on.
     */
    public boolean isStaleClaim() {
        return httpStatus == 409;
    }

    /** Worth retrying later: the request never got a definitive answer. */
    public boolean isRetryable() {
        return httpStatus >= 500 || httpStatus == 429;
    }
}
