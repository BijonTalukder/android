package com.example.gateway.model;

public class HeartbeatResponse {
    public String serverTime;
    public DeviceConfigDto config;
    public int pendingCommands;
    public String status;
}
