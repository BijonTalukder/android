package com.example.gateway.model;

import androidx.annotation.Nullable;

/** Body of {@code POST /api/gateway/heartbeat}. */
public class HeartbeatRequest {
    @Nullable public Integer batteryLevel;
    @Nullable public Boolean isCharging;
    @Nullable public String networkType;
    @Nullable public String appVersion;
}
