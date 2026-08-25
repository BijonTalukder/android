package com.example.gateway.model;

/**
 * Enrollment result. {@code deviceApiToken} is returned exactly once -- the
 * backend stores only a hash of it -- so it must be persisted immediately.
 */
public class RegisterResponse {
    public String deviceApiToken;
    public RegisteredDevice device;
    public DeviceConfigDto config;
    public String serverTime;
}
