package com.example.gateway.model;

import androidx.annotation.NonNull;

/** Body of {@code POST /api/gateway/register}. */
public class RegisterRequest {

    public String enrollmentToken;
    public DeviceInfo device;

    public RegisterRequest(@NonNull String enrollmentToken, @NonNull DeviceInfo device) {
        this.enrollmentToken = enrollmentToken;
        this.device = device;
    }
}
