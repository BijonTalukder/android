package com.example.gateway.network;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.example.gateway.BuildConfig;
import com.example.gateway.model.ApiEnvelope;
import com.example.gateway.storage.SecureStorage;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.logging.HttpLoggingInterceptor;
import retrofit2.Call;
import retrofit2.Response;
import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;

/**
 * Builds and caches the Retrofit client, and unwraps the platform's response
 * envelope so callers deal in domain objects or exceptions, never in
 * {@code Response<ApiEnvelope<T>>}.
 *
 * The client is rebuilt whenever the configured base URL changes, which is what
 * lets one APK be pointed at a staging or production backend.
 */
public final class ApiClient {

    private static final Object LOCK = new Object();
    private static ApiClient instance;

    private final GatewayApi api;
    private final String baseUrl;

    private ApiClient(@NonNull SecureStorage storage, @NonNull String baseUrl) {
        this.baseUrl = baseUrl;

        HttpLoggingInterceptor logging = new HttpLoggingInterceptor();
        // Headers carry the device token, so bodies-and-headers logging is
        // debug-only and never ships in a release build.
        logging.setLevel(BuildConfig.DEBUG
                ? HttpLoggingInterceptor.Level.BASIC
                : HttpLoggingInterceptor.Level.NONE);

        OkHttpClient http = new OkHttpClient.Builder()
                .addInterceptor(new DeviceAuthInterceptor(storage))
                .addInterceptor(logging)
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                // Workers run on unreliable networks; one automatic retry of an
                // idempotent GET costs little and avoids spurious failures.
                .retryOnConnectionFailure(true)
                .build();

        this.api = new Retrofit.Builder()
                .baseUrl(normalize(baseUrl))
                .client(http)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
                .create(GatewayApi.class);
    }

    public static GatewayApi api(@NonNull SecureStorage storage) {
        String configured = normalize(storage.getBaseUrl(BuildConfig.DEFAULT_BASE_URL));
        synchronized (LOCK) {
            if (instance == null || !instance.baseUrl.equals(configured)) {
                instance = new ApiClient(storage, configured);
            }
            return instance.api;
        }
    }

    /** Drop the cached client, e.g. after the operator changes the server URL. */
    public static void reset() {
        synchronized (LOCK) {
            instance = null;
        }
    }

    private static String normalize(@Nullable String url) {
        String value = url == null || url.trim().isEmpty()
                ? BuildConfig.DEFAULT_BASE_URL
                : url.trim();
        return value.endsWith("/") ? value : value + "/";
    }

    /**
     * Execute a call and return its payload.
     *
     * @throws ApiException when the server answered with a failure
     * @throws IOException  when the request never completed (offline, timeout)
     */
    @NonNull
    public static <T> T execute(@NonNull Call<ApiEnvelope<T>> call)
            throws ApiException, IOException {
        Response<ApiEnvelope<T>> response = call.execute();
        ApiEnvelope<T> envelope = response.body();

        if (envelope == null) {
            // A non-2xx response puts the envelope in errorBody instead.
            String detail = response.errorBody() == null
                    ? "Empty response"
                    : response.errorBody().string();
            throw new ApiException(response.code(), null, truncate(detail));
        }

        if (!response.isSuccessful() || !envelope.success) {
            throw new ApiException(
                    response.code(),
                    envelope.code,
                    envelope.messageOrDefault("Request failed"));
        }

        if (envelope.data == null) {
            throw new ApiException(response.code(), envelope.code, "Response contained no data");
        }

        return envelope.data;
    }

    private static String truncate(String value) {
        return value.length() > 300 ? value.substring(0, 300) : value;
    }
}
