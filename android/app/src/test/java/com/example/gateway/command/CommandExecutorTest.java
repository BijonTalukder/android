package com.example.gateway.command;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import androidx.annotation.NonNull;

import com.example.gateway.model.DeviceCommand;

import org.junit.Test;

import java.util.Collections;

/**
 * The executor's contract is what keeps the command system extensible and
 * keeps a claimed command from ever being left unanswered.
 */
public class CommandExecutorTest {

    private static DeviceCommand command(String type) {
        DeviceCommand command = new DeviceCommand();
        command.id = "cmd-1";
        command.type = type;
        command.claimId = "claim-1";
        command.payload = Collections.emptyMap();
        return command;
    }

    @Test
    public void dispatchesToTheHandlerRegisteredForTheType() {
        CommandExecutor executor = new CommandExecutor()
                .register(new StubHandler("ALPHA", CommandResult.success(
                        Collections.singletonMap("who", "alpha"))))
                .register(new StubHandler("BETA", CommandResult.success(
                        Collections.singletonMap("who", "beta"))));

        CommandResult result = executor.execute(command("BETA"));

        assertTrue(result.isSuccess());
        assertEquals("beta", result.getPayload().get("who"));
    }

    @Test
    public void reportsAnUnknownTypeInsteadOfFailingSilently() {
        // An older app build must tell the operator it cannot run a newer
        // command, otherwise the command looks like it vanished.
        CommandResult result = new CommandExecutor().execute(command("FROM_THE_FUTURE"));

        assertFalse(result.isSuccess());
        assertEquals("UNSUPPORTED_COMMAND", result.getErrorCode());
    }

    @Test
    public void convertsAThrownExceptionIntoAFailedResult() {
        // The command has already been claimed. Letting the exception escape
        // would strand it until the server's delivery timeout.
        CommandExecutor executor = new CommandExecutor().register(new CommandHandler() {
            @NonNull
            @Override
            public String getType() {
                return "EXPLODES";
            }

            @NonNull
            @Override
            public CommandResult execute(@NonNull DeviceCommand command) {
                throw new IllegalStateException("boom");
            }
        });

        CommandResult result = executor.execute(command("EXPLODES"));

        assertFalse(result.isSuccess());
        assertEquals("HANDLER_ERROR", result.getErrorCode());
        assertEquals("boom", result.getErrorMessage());
    }

    @Test
    public void reportsWhichTypesItSupports() {
        CommandExecutor executor = new CommandExecutor()
                .register(new StubHandler("ALPHA", CommandResult.success()));

        assertTrue(executor.supports("ALPHA"));
        assertFalse(executor.supports("BETA"));
        assertFalse(executor.supports(null));
        assertEquals(Collections.singletonList("ALPHA"),
                new java.util.ArrayList<>(executor.supportedTypes()));
    }

    private static final class StubHandler implements CommandHandler {
        private final String type;
        private final CommandResult result;

        StubHandler(String type, CommandResult result) {
            this.type = type;
            this.result = result;
        }

        @NonNull
        @Override
        public String getType() {
            return type;
        }

        @NonNull
        @Override
        public CommandResult execute(@NonNull DeviceCommand command) {
            return result;
        }
    }
}
