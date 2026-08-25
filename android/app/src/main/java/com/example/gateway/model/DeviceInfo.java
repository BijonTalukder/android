package com.example.gateway.model;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

/** Hardware and app facts sent at enrollment. */
public class DeviceInfo {

    /**
     * A UUID this app generates on first launch and keeps for its lifetime.
     * Deliberately app-scoped: IMEI and other hardware identifiers are
     * restricted on modern Android and are not an authentication mechanism.
     */
    public String installationId;

    public String deviceName;

    @Nullable public String manufacturer;
    @Nullable public String model;
    @Nullable public String androidVersion;
    @Nullable public Integer sdkVersion;
    @Nullable public String appVersion;

    public DeviceInfo(@NonNull String installationId, @NonNull String deviceName) {
        this.installationId = installationId;
        this.deviceName = deviceName;
    }
}
