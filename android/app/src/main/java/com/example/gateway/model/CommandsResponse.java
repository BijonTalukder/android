package com.example.gateway.model;

import java.util.Collections;
import java.util.List;

public class CommandsResponse {
    public List<DeviceCommand> commands;
    public String serverTime;

    public List<DeviceCommand> commandsOrEmpty() {
        return commands == null ? Collections.emptyList() : commands;
    }
}
