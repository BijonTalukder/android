package com.example.gateway.command;

import androidx.annotation.NonNull;

import com.example.gateway.model.DeviceCommand;
import com.example.gateway.sms.SmsSender;

import java.util.regex.Pattern;

/**
 * {@code SEND_SMS}.
 *
 * Three independent gates stand between an operator and a message leaving the
 * handset, and all three must be open:
 *
 *  1. the platform-wide {@code SMS_COMMAND_ENABLED} switch on the backend;
 *  2. the organization's own SMS setting;
 *  3. the runtime SEND_SMS permission, granted by the person holding the phone.
 *
 * This handler owns the third and re-validates the payload the backend already
 * checked, because the device is the last place the rules can be enforced.
 */
public class SendSmsCommandHandler implements CommandHandler {

    public static final String TYPE = "SEND_SMS";

    /** Same shape the backend accepts: E.164 or a 6-15 digit national number. */
    private static final Pattern DESTINATION = Pattern.compile("^\\+?[0-9]{6,15}$");

    /** Ten GSM-7 segments. Anything longer is almost always a mistake. */
    private static final int MAX_MESSAGE_LENGTH = 1530;

    private final SmsSender smsSender;

    public SendSmsCommandHandler(@NonNull SmsSender smsSender) {
        this.smsSender = smsSender;
    }

    @NonNull
    @Override
    public String getType() {
        return TYPE;
    }

    @NonNull
    @Override
    public CommandResult execute(@NonNull DeviceCommand command) {
        String destination = command.getString("destination");
        String message = command.getString("message");
        Integer subscriptionId = command.getInt("subscriptionId");

        if (destination == null || !DESTINATION.matcher(destination.trim()).matches()) {
            return CommandResult.failure(
                    "INVALID_DESTINATION",
                    "Destination must be an E.164 or national number of 6-15 digits");
        }
        if (message == null || message.isEmpty()) {
            return CommandResult.failure("EMPTY_MESSAGE", "Message body is required");
        }
        if (message.length() > MAX_MESSAGE_LENGTH) {
            return CommandResult.failure(
                    "MESSAGE_TOO_LONG",
                    "Message exceeds " + MAX_MESSAGE_LENGTH + " characters");
        }

        if (!smsSender.isAvailable()) {
            return CommandResult.failure("SMS_UNAVAILABLE", smsSender.unavailableReason());
        }

        SmsSender.SendOutcome outcome =
                smsSender.send(destination.trim(), message, subscriptionId);

        if (!outcome.sent) {
            return CommandResult.failure(
                    outcome.errorCode == null ? "SEND_FAILED" : outcome.errorCode,
                    outcome.errorMessage == null ? "SMS send failed" : outcome.errorMessage);
        }

        // The destination is echoed but the body is not: the message content
        // does not need to be stored a second time in the command result.
        return new CommandResult.Builder()
                .put("sent", true)
                .put("destination", destination.trim())
                .put("segments", outcome.segments)
                .put("sentAt", com.example.gateway.util.DeviceInfoProvider.nowIso8601())
                .build();
    }
}
