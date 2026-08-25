package com.example.gateway.model;

/** Body of {@code GET /api/gateway/config}. */
public class DeviceConfigResponse {
    public GatewayConfig config;
    public RegisteredDevice device;
    public String serverTime;

    public static class GatewayConfig {
        public int pollingIntervalSeconds;
        public int heartbeatIntervalSeconds;
        /** Mirrors the platform + tenant SMS switch. */
        public boolean smsEnabled;
    }
}
