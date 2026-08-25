package com.example.gateway.model;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

/**
 * Gson decodes every JSON number as a Double, so a payload that carries
 * {@code {"pollingIntervalSeconds": 30}} arrives as {@code 30.0}. These tests
 * pin the narrowing that UPDATE_CONFIG depends on.
 */
public class DeviceCommandTest {

    private static DeviceCommand withPayload(Map<String, Object> payload) {
        DeviceCommand command = new DeviceCommand();
        command.payload = payload;
        return command;
    }

    @Test
    public void narrowsAGsonDoubleToAnInt() {
        Map<String, Object> payload = new HashMap<>();
        payload.put("pollingIntervalSeconds", 30.0d);

        assertEquals(Integer.valueOf(30), withPayload(payload).getInt("pollingIntervalSeconds"));
    }

    @Test
    public void parsesANumericString() {
        Map<String, Object> payload = new HashMap<>();
        payload.put("subscriptionId", "2");

        assertEquals(Integer.valueOf(2), withPayload(payload).getInt("subscriptionId"));
    }

    @Test
    public void returnsNullForAMissingOrUnparseableValue() {
        Map<String, Object> payload = new HashMap<>();
        payload.put("subscriptionId", "not-a-number");

        DeviceCommand command = withPayload(payload);
        assertNull(command.getInt("subscriptionId"));
        assertNull(command.getInt("absent"));
        assertNull(command.getString("absent"));
    }

    @Test
    public void treatsAnAbsentPayloadAsEmpty() {
        DeviceCommand command = new DeviceCommand();
        assertTrue(command.payloadOrEmpty().isEmpty());
        assertNull(command.getString("anything"));
    }

    @Test
    public void readsStringValues() {
        Map<String, Object> payload = new HashMap<>();
        payload.put("scope", "CONFIG");

        assertEquals("CONFIG", withPayload(payload).getString("scope"));
    }
}
