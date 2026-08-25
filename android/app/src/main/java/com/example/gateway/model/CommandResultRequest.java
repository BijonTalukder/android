package com.example.gateway.model;

import androidx.annotation.Nullable;

import java.util.Map;

/** Body of {@code POST /api/gateway/commands/{id}/result}. */
public class CommandResultRequest {

    /** {@code PROCESSING} (acknowledgement), {@code SUCCESS} or {@code FAILED}. */
    public String status;

    public String claimId;

    @Nullable public Map<String, Object> result;
    @Nullable public CommandErrorDto error;
}
