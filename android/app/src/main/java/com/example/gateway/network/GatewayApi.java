package com.example.gateway.network;

import com.example.gateway.model.ApiEnvelope;
import com.example.gateway.model.CommandResultRequest;
import com.example.gateway.model.CommandsResponse;
import com.example.gateway.model.DeviceConfigResponse;
import com.example.gateway.model.HeartbeatRequest;
import com.example.gateway.model.HeartbeatResponse;
import com.example.gateway.model.RegisterRequest;
import com.example.gateway.model.RegisterResponse;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.POST;
import retrofit2.http.Path;
import retrofit2.http.Query;

/**
 * The gateway REST surface.
 *
 * Every call except {@link #register} is authenticated by the device API token,
 * which {@link DeviceAuthInterceptor} attaches. Nothing here can reach an admin
 * endpoint: device credentials carry no user identity or role.
 */
public interface GatewayApi {

    @POST("api/gateway/register")
    Call<ApiEnvelope<RegisterResponse>> register(@Body RegisterRequest body);

    @POST("api/gateway/heartbeat")
    Call<ApiEnvelope<HeartbeatResponse>> heartbeat(@Body HeartbeatRequest body);

    /** Atomically claims up to {@code limit} pending commands for this device. */
    @GET("api/gateway/commands")
    Call<ApiEnvelope<CommandsResponse>> fetchCommands(@Query("limit") int limit);

    @POST("api/gateway/commands/{id}/result")
    Call<ApiEnvelope<Object>> submitResult(
            @Path("id") String commandId,
            @Body CommandResultRequest body);

    @GET("api/gateway/config")
    Call<ApiEnvelope<DeviceConfigResponse>> config();
}
