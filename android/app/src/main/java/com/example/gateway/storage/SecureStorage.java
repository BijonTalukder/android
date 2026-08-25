package com.example.gateway.storage;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.UUID;

/**
 * At-rest storage for the device's credentials.
 *
 * Secret values are encrypted with {@link KeystoreCipher} (AES-256-GCM, key
 * held in the Android Keystore) before being written to a normal
 * {@link SharedPreferences} file, so the device API token never touches disk in
 * the clear.
 *
 * Jetpack Security's {@code EncryptedSharedPreferences} would have been the
 * obvious choice and is what the specification suggests, but Google has
 * deprecated that library. This is the currently supported equivalent, and it
 * removes a dependency rather than adding one.
 *
 * Preference *names* are stored in the clear. They are not secrets -- knowing
 * that a key called {@code device_api_token} exists reveals nothing that the
 * APK does not already reveal -- and keeping them readable makes the store far
 * easier to reason about and to migrate.
 *
 * If decryption ever fails (a Keystore entry invalidated by a factory reset or
 * a device-to-device restore), the store is wiped once and rebuilt. Losing the
 * token means the device must re-enroll, which is the correct outcome: it is
 * far better than an app that can never start again.
 */
public class SecureStorage {

    private static final String TAG = "SecureStorage";

    private static final String FILE = "gateway_secure_prefs";
    private static final String KEY_ALIAS = "gateway_master_key_v1";

    private static final String KEY_DEVICE_TOKEN = "device_api_token";
    private static final String KEY_INSTALLATION_ID = "installation_id";
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_DEVICE_NAME = "device_name";
    private static final String KEY_BASE_URL = "base_url";
    private static final String KEY_SMS_ENABLED = "sms_enabled";

    private final SharedPreferences prefs;
    private final KeystoreCipher cipher;

    public SecureStorage(@NonNull Context context) {
        Context appContext = context.getApplicationContext();
        this.prefs = appContext.getSharedPreferences(FILE, Context.MODE_PRIVATE);
        this.cipher = new KeystoreCipher(KEY_ALIAS);
    }

    /* ------------------------------------------------------------------ */
    /* Encrypted accessors                                                 */
    /* ------------------------------------------------------------------ */

    @Nullable
    private synchronized String readSecret(@NonNull String key) {
        String stored = prefs.getString(key, null);
        if (stored == null) {
            return null;
        }
        try {
            return cipher.decrypt(stored);
        } catch (KeystoreCipher.CipherFailure failure) {
            Log.w(TAG, "Could not decrypt " + key + "; resetting secure storage", failure);
            resetStore();
            return null;
        }
    }

    /**
     * @param commit {@code true} to block until the write reaches disk. Used for
     *               the device token, whose only copy this is: the server
     *               returns it once and keeps only a hash.
     */
    // commit() is deliberate, not an oversight: the device API token is issued
    // exactly once and losing it to a process death mid-apply() would strand
    // the device. The blocking write happens on a background thread.
    @SuppressLint("ApplySharedPref")
    private synchronized boolean writeSecret(
            @NonNull String key, @Nullable String value, boolean commit) {
        SharedPreferences.Editor editor = prefs.edit();

        if (value == null) {
            editor.remove(key);
        } else {
            try {
                editor.putString(key, cipher.encrypt(value));
            } catch (KeystoreCipher.CipherFailure failure) {
                Log.e(TAG, "Could not encrypt " + key, failure);
                return false;
            }
        }

        if (commit) {
            return editor.commit();
        }
        editor.apply();
        return true;
    }

    /** Wipe both the ciphertexts and the key that could read them. */
    @SuppressLint("ApplySharedPref")
    private void resetStore() {
        prefs.edit().clear().commit();
        cipher.deleteKey();
    }

    /* ------------------------------------------------------------------ */
    /* Installation identity                                               */
    /* ------------------------------------------------------------------ */

    /**
     * A random UUID minted on first launch and stable for the life of the
     * install. Re-enrolling with the same id is idempotent server-side: the
     * backend rotates the existing device's token instead of creating a
     * duplicate device.
     *
     * Not derived from IMEI, ANDROID_ID or any other hardware identifier:
     * those are restricted on modern Android and were never an authentication
     * mechanism in the first place.
     */
    @NonNull
    public synchronized String getOrCreateInstallationId() {
        String existing = readSecret(KEY_INSTALLATION_ID);
        if (existing != null) {
            return existing;
        }
        String created = UUID.randomUUID().toString();
        writeSecret(KEY_INSTALLATION_ID, created, true);
        return created;
    }

    /* ------------------------------------------------------------------ */
    /* Device credentials                                                  */
    /* ------------------------------------------------------------------ */

    @Nullable
    public String getDeviceToken() {
        return readSecret(KEY_DEVICE_TOKEN);
    }

    public boolean isEnrolled() {
        String token = getDeviceToken();
        return token != null && !token.isEmpty();
    }

    public boolean saveEnrollment(
            @NonNull String deviceApiToken,
            @NonNull String deviceId,
            @NonNull String deviceName) {
        boolean ok = writeSecret(KEY_DEVICE_TOKEN, deviceApiToken, true);
        writeSecret(KEY_DEVICE_ID, deviceId, true);
        writeSecret(KEY_DEVICE_NAME, deviceName, true);
        return ok;
    }

    /** Forget the credentials, e.g. after the backend revokes the token. */
    @SuppressLint("ApplySharedPref")
    public void clearEnrollment() {
        prefs.edit()
                .remove(KEY_DEVICE_TOKEN)
                .remove(KEY_DEVICE_ID)
                .remove(KEY_DEVICE_NAME)
                .commit();
    }

    @Nullable
    public String getDeviceId() {
        return readSecret(KEY_DEVICE_ID);
    }

    @Nullable
    public String getDeviceName() {
        return readSecret(KEY_DEVICE_NAME);
    }

    /* ------------------------------------------------------------------ */
    /* Backend location and feature flags                                  */
    /* ------------------------------------------------------------------ */

    /** Not a secret, but kept in the same store so enrollment state is atomic. */
    @NonNull
    public String getBaseUrl(@NonNull String fallback) {
        String value = readSecret(KEY_BASE_URL);
        return value == null || value.trim().isEmpty() ? fallback : value;
    }

    public void setBaseUrl(@NonNull String baseUrl) {
        writeSecret(KEY_BASE_URL, baseUrl.trim(), true);
    }

    /**
     * Cached mirror of the server's SMS switch, so the UI can explain why the
     * capability is unavailable while offline. The server remains the
     * authority: it refuses to queue an SMS command when the switch is off.
     */
    public boolean isSmsEnabled() {
        return prefs.getBoolean(KEY_SMS_ENABLED, false);
    }

    public void setSmsEnabled(boolean enabled) {
        prefs.edit().putBoolean(KEY_SMS_ENABLED, enabled).apply();
    }
}
