package com.example.gateway.model;

import androidx.annotation.Nullable;

import java.util.Collections;
import java.util.Map;

/** One command claimed from the backend. */
public class DeviceCommand {

    public String id;
    public String type;

    @Nullable
    public Map<String, Object> payload;

    public String priority;

    /**
     * Identifies this particular delivery. It must be echoed back with the
     * result: if the command was re-queued in the meantime the backend rejects
     * the stale claim rather than recording an outcome for an attempt that has
     * been superseded.
     */
    public String claimId;

    public String createdAt;

    @Nullable
    public String expiresAt;

    public Map<String, Object> payloadOrEmpty() {
        return payload == null ? Collections.emptyMap() : payload;
    }

    @Nullable
    public String getString(String key) {
        Object value = payloadOrEmpty().get(key);
        return value == null ? null : String.valueOf(value);
    }

    /** Gson decodes every JSON number as a Double, so narrow explicitly. */
    @Nullable
    public Integer getInt(String key) {
        Object value = payloadOrEmpty().get(key);
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        if (value instanceof String) {
            try {
                return Integer.valueOf((String) value);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }
}
