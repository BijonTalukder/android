package com.example.gateway.network;

import androidx.annotation.NonNull;

import com.example.gateway.storage.SecureStorage;

import java.io.IOException;

import okhttp3.Interceptor;
import okhttp3.Request;
import okhttp3.Response;

/**
 * Attaches {@code Authorization: Bearer <device token>} to every gateway
 * request except enrollment, which has no token yet.
 *
 * The token is read on each call rather than captured once, so a rotation
 * (re-enrollment) takes effect immediately without rebuilding the client.
 */
public class DeviceAuthInterceptor implements Interceptor {

    private static final String ENROLLMENT_PATH = "api/gateway/register";

    private final SecureStorage storage;

    public DeviceAuthInterceptor(@NonNull SecureStorage storage) {
        this.storage = storage;
    }

    @NonNull
    @Override
    public Response intercept(@NonNull Chain chain) throws IOException {
        Request request = chain.request();

        if (request.url().encodedPath().endsWith(ENROLLMENT_PATH)) {
            return chain.proceed(request);
        }

        String token = storage.getDeviceToken();
        if (token == null) {
            return chain.proceed(request);
        }

        return chain.proceed(
                request.newBuilder()
                        .header("Authorization", "Bearer " + token)
                        .build());
    }
}
