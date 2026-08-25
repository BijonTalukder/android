package com.example.gateway.sms;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.SmsManager;
import android.telephony.SubscriptionManager;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

import java.util.ArrayList;

/**
 * Platform SMS implementation, built to stay inside Android and Play policy.
 *
 * What it does:
 *  - requires the user to have granted the runtime SEND_SMS permission, and
 *    reports a typed failure when they have not;
 *  - splits long messages properly and sends them as a multipart message;
 *  - honours an explicit SIM subscription, falling back to the user's default.
 *
 * What it deliberately does not do, and must never be extended to do:
 *  - bypass or auto-dismiss the platform's premium-SMS confirmation dialog;
 *  - use hidden or reflected APIs, accessibility automation, or root;
 *  - send anything the operator has not explicitly queued through the backend,
 *    where the organization's SMS switch and the audit log both apply.
 *
 * Sending SMS from a managed device is subject to carrier rules, local law,
 * recipient consent and Google Play's SMS policy. This class assumes the
 * deployment has satisfied all four; it does not and cannot verify them.
 */
public class AndroidSmsSender implements SmsSender {

    private static final String TAG = "AndroidSmsSender";

    private final Context context;

    public AndroidSmsSender(@NonNull Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public boolean isAvailable() {
        return hasPermission() && hasTelephony();
    }

    @NonNull
    @Override
    public String unavailableReason() {
        if (!hasTelephony()) {
            return "This device has no telephony hardware";
        }
        if (!hasPermission()) {
            return "The SEND_SMS permission has not been granted";
        }
        return "";
    }

    @NonNull
    @Override
    public SendOutcome send(
            @NonNull String destination,
            @NonNull String message,
            @Nullable Integer subscriptionId) {

        if (!hasTelephony()) {
            return SendOutcome.failed("NO_TELEPHONY", "This device has no telephony hardware");
        }
        if (!hasPermission()) {
            // The user has to grant this in the app; there is no way to send
            // without it, and there must not be.
            return SendOutcome.failed(
                    "PERMISSION_DENIED",
                    "The SEND_SMS permission has not been granted on this device");
        }

        SmsManager manager;
        try {
            manager = resolveManager(subscriptionId);
        } catch (RuntimeException error) {
            Log.e(TAG, "Could not resolve an SmsManager", error);
            return SendOutcome.failed(
                    "NO_SUBSCRIPTION",
                    "No usable SIM subscription: " + error.getMessage());
        }

        try {
            ArrayList<String> parts = manager.divideMessage(message);
            if (parts.isEmpty()) {
                return SendOutcome.failed("EMPTY_MESSAGE", "Message body is empty");
            }

            if (parts.size() == 1) {
                manager.sendTextMessage(destination, null, parts.get(0), null, null);
            } else {
                // A long message must go out as a concatenated multipart SMS,
                // otherwise the recipient receives fragments out of order.
                manager.sendMultipartTextMessage(destination, null, parts, null, null);
            }

            return SendOutcome.sent(parts.size());
        } catch (IllegalArgumentException error) {
            return SendOutcome.failed(
                    "INVALID_DESTINATION",
                    "The platform rejected the destination number");
        } catch (SecurityException error) {
            return SendOutcome.failed(
                    "PERMISSION_DENIED",
                    "The platform refused the send: " + error.getMessage());
        } catch (RuntimeException error) {
            Log.e(TAG, "SMS send failed", error);
            return SendOutcome.failed(
                    "SEND_FAILED",
                    error.getMessage() == null ? "Unknown telephony error" : error.getMessage());
        }
    }

    // getSmsManagerForSubscriptionId is deprecated in favour of
    // createForSubscriptionId, but that arrived in API 31 and this app supports
    // API 26. The deprecated call is only reachable below API 31.
    @SuppressWarnings("deprecation")
    private SmsManager resolveManager(@Nullable Integer subscriptionId) {
        SmsManager systemManager = context.getSystemService(SmsManager.class);
        if (systemManager == null) {
            throw new IllegalStateException("SmsManager is unavailable");
        }

        if (subscriptionId == null
                || subscriptionId == SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
            return systemManager;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return systemManager.createForSubscriptionId(subscriptionId);
        }
        return SmsManager.getSmsManagerForSubscriptionId(subscriptionId);
    }

    private boolean hasPermission() {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasTelephony() {
        return context.getPackageManager()
                .hasSystemFeature(PackageManager.FEATURE_TELEPHONY);
    }
}
