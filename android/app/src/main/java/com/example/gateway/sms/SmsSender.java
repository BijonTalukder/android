package com.example.gateway.sms;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/**
 * Abstraction over outbound SMS.
 *
 * The command handler depends on this interface, not on Android's
 * {@code SmsManager}, so the platform implementation can be replaced by a
 * carrier gateway, an aggregator API, or a no-op in tests without touching
 * command execution.
 */
public interface SmsSender {

    /** Outcome of one send attempt. */
    final class SendOutcome {
        public final boolean sent;
        public final int segments;
        @Nullable public final String errorCode;
        @Nullable public final String errorMessage;

        private SendOutcome(
                boolean sent,
                int segments,
                @Nullable String errorCode,
                @Nullable String errorMessage) {
            this.sent = sent;
            this.segments = segments;
            this.errorCode = errorCode;
            this.errorMessage = errorMessage;
        }

        public static SendOutcome sent(int segments) {
            return new SendOutcome(true, segments, null, null);
        }

        public static SendOutcome failed(@NonNull String code, @NonNull String message) {
            return new SendOutcome(false, 0, code, message);
        }
    }

    /**
     * @param destination    E.164 or national number, already syntax-checked
     * @param message        message body
     * @param subscriptionId SIM subscription to send from, or {@code null} for
     *                       the user's configured default
     */
    @NonNull
    SendOutcome send(
            @NonNull String destination,
            @NonNull String message,
            @Nullable Integer subscriptionId);

    /** Whether this sender can send right now (permission, SIM, policy). */
    boolean isAvailable();

    /** Human-readable reason {@link #isAvailable()} is false. */
    @NonNull
    String unavailableReason();
}
