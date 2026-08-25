package com.example.gateway.model;

import androidx.annotation.Nullable;

import java.util.List;
import java.util.Map;

/**
 * The envelope every backend endpoint returns.
 *
 * <pre>
 * { "success": true,  "data": { ... }, "message": "Success" }
 * { "success": false, "message": "Validation failed", "errors": { ... } }
 * </pre>
 */
public class ApiEnvelope<T> {

    public boolean success;

    @Nullable
    public T data;

    @Nullable
    public String message;

    @Nullable
    public Map<String, List<String>> errors;

    @Nullable
    public String code;

    public String messageOrDefault(String fallback) {
        return message == null || message.isEmpty() ? fallback : message;
    }
}
