package com.example.gateway.command;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.example.gateway.model.DeviceCommand;
import com.example.gateway.sms.SmsSender;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

/**
 * SEND_SMS is the one command that can cost money and annoy a stranger, so its
 * gates are worth testing explicitly.
 */
public class SendSmsCommandHandlerTest {

    private static DeviceCommand smsCommand(Object destination, Object message) {
        DeviceCommand command = new DeviceCommand();
        command.id = "cmd-sms";
        command.type = "SEND_SMS";
        command.claimId = "claim-1";
        Map<String, Object> payload = new HashMap<>();
        if (destination != null) payload.put("destination", destination);
        if (message != null) payload.put("message", message);
        command.payload = payload;
        return command;
    }

    @Test
    public void sendsAValidMessage() {
        RecordingSender sender = new RecordingSender(true);
        CommandResult result = new SendSmsCommandHandler(sender)
                .execute(smsCommand("+8801712345678", "hello"));

        assertTrue(result.isSuccess());
        assertEquals("+8801712345678", sender.lastDestination);
        assertEquals("hello", sender.lastMessage);
        assertEquals(Boolean.TRUE, result.getPayload().get("sent"));
    }

    @Test
    public void doesNotSendWhenTheDestinationIsNotANumber() {
        RecordingSender sender = new RecordingSender(true);
        CommandResult result = new SendSmsCommandHandler(sender)
                .execute(smsCommand("not-a-number", "hello"));

        assertFalse(result.isSuccess());
        assertEquals("INVALID_DESTINATION", result.getErrorCode());
        // The critical assertion: nothing reached the platform.
        assertNull(sender.lastDestination);
    }

    @Test
    public void doesNotSendAnEmptyMessage() {
        RecordingSender sender = new RecordingSender(true);
        CommandResult result = new SendSmsCommandHandler(sender)
                .execute(smsCommand("+8801712345678", ""));

        assertFalse(result.isSuccess());
        assertEquals("EMPTY_MESSAGE", result.getErrorCode());
        assertNull(sender.lastDestination);
    }

    @Test
    public void rejectsAMessageBeyondTenSegments() {
        RecordingSender sender = new RecordingSender(true);
        String tooLong = new String(new char[1531]).replace('\0', 'x');
        CommandResult result = new SendSmsCommandHandler(sender)
                .execute(smsCommand("+8801712345678", tooLong));

        assertFalse(result.isSuccess());
        assertEquals("MESSAGE_TOO_LONG", result.getErrorCode());
        assertNull(sender.lastDestination);
    }

    @Test
    public void reportsAFailureWhenThePermissionIsMissing() {
        // The user declining SEND_SMS must surface in the dashboard as a typed
        // failure, never as a silent no-op.
        RecordingSender sender = new RecordingSender(false);
        CommandResult result = new SendSmsCommandHandler(sender)
                .execute(smsCommand("+8801712345678", "hello"));

        assertFalse(result.isSuccess());
        assertEquals("SMS_UNAVAILABLE", result.getErrorCode());
        assertNull(sender.lastDestination);
    }

    @Test
    public void propagatesAPlatformSendFailure() {
        RecordingSender sender = new RecordingSender(true);
        sender.outcome = SmsSender.SendOutcome.failed("SEND_FAILED", "radio off");

        CommandResult result = new SendSmsCommandHandler(sender)
                .execute(smsCommand("+8801712345678", "hello"));

        assertFalse(result.isSuccess());
        assertEquals("SEND_FAILED", result.getErrorCode());
        assertEquals("radio off", result.getErrorMessage());
    }

    private static final class RecordingSender implements SmsSender {
        private final boolean available;
        SendOutcome outcome = SendOutcome.sent(1);
        @Nullable String lastDestination;
        @Nullable String lastMessage;

        RecordingSender(boolean available) {
            this.available = available;
        }

        @NonNull
        @Override
        public SendOutcome send(
                @NonNull String destination,
                @NonNull String message,
                @Nullable Integer subscriptionId) {
            lastDestination = destination;
            lastMessage = message;
            return outcome;
        }

        @Override
        public boolean isAvailable() {
            return available;
        }

        @NonNull
        @Override
        public String unavailableReason() {
            return "permission not granted";
        }
    }
}
