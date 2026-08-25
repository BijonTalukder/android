package com.example.gateway.model;

import androidx.annotation.Nullable;

/** The device fields the backend echoes back after enrollment. */
public class RegisteredDevice {
    public String id;
    public String deviceId;
    public String deviceName;
    @Nullable public String status;
}
