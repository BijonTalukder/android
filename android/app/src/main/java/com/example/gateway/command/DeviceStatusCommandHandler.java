package com.example.gateway.command;

import androidx.annotation.NonNull;

import com.example.gateway.model.DeviceCommand;
import com.example.gateway.util.DeviceInfoProvider;

/** {@code GET_DEVICE_STATUS}: report current battery, power and network state. */
public class DeviceStatusCommandHandler implements CommandHandler {

    public static final String TYPE = "GET_DEVICE_STATUS";

    private final DeviceInfoProvider deviceInfo;

    public DeviceStatusCommandHandler(@NonNull DeviceInfoProvider deviceInfo) {
        this.deviceInfo = deviceInfo;
    }

    @NonNull
    @Override
    public String getType() {
        return TYPE;
    }

    @NonNull
    @Override
    public CommandResult execute(@NonNull DeviceCommand command) {
        return new CommandResult.Builder()
                .put("batteryLevel", deviceInfo.batteryLevel())
                .put("isCharging", deviceInfo.isCharging())
                .put("networkType", deviceInfo.networkType())
                .put("appVersion", deviceInfo.appVersion())
                .put("timestamp", DeviceInfoProvider.nowIso8601())
                .build();
    }
}
