package com.example.gateway.util;

import android.content.Context;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/** Reads the live device facts the platform reports in heartbeats and status. */
public class DeviceInfoProvider {

    private final Context context;

    public DeviceInfoProvider(@NonNull Context context) {
        this.context = context.getApplicationContext();
    }

    /** Battery percentage 0-100, or {@code null} when unavailable. */
    @Nullable
    public Integer batteryLevel() {
        BatteryManager manager = context.getSystemService(BatteryManager.class);
        if (manager == null) {
            return null;
        }
        int level = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        return level < 0 || level > 100 ? null : level;
    }

    @Nullable
    public Boolean isCharging() {
        BatteryManager manager = context.getSystemService(BatteryManager.class);
        return manager == null ? null : manager.isCharging();
    }

    /** One of WIFI, MOBILE, ETHERNET, NONE, UNKNOWN -- matching the backend enum. */
    @NonNull
    public String networkType() {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        if (manager == null) {
            return "UNKNOWN";
        }

        Network network = manager.getActiveNetwork();
        if (network == null) {
            return "NONE";
        }

        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        if (capabilities == null) {
            return "UNKNOWN";
        }
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
            return "WIFI";
        }
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
            return "MOBILE";
        }
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
            return "ETHERNET";
        }
        return "UNKNOWN";
    }

    public boolean hasConnectivity() {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        if (manager == null) {
            return false;
        }
        Network network = manager.getActiveNetwork();
        if (network == null) {
            return false;
        }
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null
                && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    @NonNull
    public String appVersion() {
        try {
            return context.getPackageManager()
                    .getPackageInfo(context.getPackageName(), 0)
                    .versionName;
        } catch (PackageManager.NameNotFoundException error) {
            return "unknown";
        }
    }

    @NonNull
    public String manufacturer() {
        return Build.MANUFACTURER;
    }

    @NonNull
    public String model() {
        return Build.MODEL;
    }

    @NonNull
    public String androidVersion() {
        return Build.VERSION.RELEASE;
    }

    public int sdkVersion() {
        return Build.VERSION.SDK_INT;
    }

    /** A sensible default device name: "Samsung Galaxy A54". */
    @NonNull
    public String suggestedDeviceName() {
        String manufacturer = Build.MANUFACTURER;
        String model = Build.MODEL;
        // Locale.ROOT: default-locale case folding turns "I" into "ı" in Turkish,
        // which would make this comparison silently wrong on those devices.
        if (model.toLowerCase(Locale.ROOT).startsWith(manufacturer.toLowerCase(Locale.ROOT))) {
            return capitalize(model);
        }
        return capitalize(manufacturer) + " " + model;
    }

    @NonNull
    public static String nowIso8601() {
        return DateTimeFormatter.ISO_INSTANT.format(Instant.now());
    }

    private static String capitalize(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        return Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }
}
