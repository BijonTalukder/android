package com.example.gateway.model;

import androidx.annotation.NonNull;

public class CommandErrorDto {
    public String code;
    public String message;

    public CommandErrorDto(@NonNull String code, @NonNull String message) {
        this.code = code;
        // The backend caps error messages at 1000 characters.
        this.message = message.length() > 1000 ? message.substring(0, 1000) : message;
    }
}
