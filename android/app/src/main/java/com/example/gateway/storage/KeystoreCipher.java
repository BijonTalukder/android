package com.example.gateway.storage;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * AES-256-GCM encryption with a key that never leaves the Android Keystore.
 *
 * This replaces Jetpack Security's {@code EncryptedSharedPreferences}, which
 * Google has deprecated. The guarantees that mattered are preserved:
 *
 *  - the key is generated inside the Keystore and is non-exportable,
 *    hardware-backed on devices with a TEE or StrongBox;
 *  - every value gets a fresh platform-generated IV (GCM is catastrophically
 *    broken by IV reuse, so the IV is never derived or reused) and is stored
 *    alongside the ciphertext;
 *  - GCM authenticates the ciphertext, so tampering fails loudly at decrypt
 *    time instead of yielding garbage.
 *
 * The key is deliberately <em>not</em> bound to user authentication: the
 * gateway's workers must read the device token while the screen is locked,
 * which is the entire point of an unattended agent.
 */
final class KeystoreCipher {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int KEY_SIZE_BITS = 256;
    private static final int IV_LENGTH_BYTES = 12;
    private static final int TAG_LENGTH_BITS = 128;

    private final String alias;

    KeystoreCipher(@NonNull String alias) {
        this.alias = alias;
    }

    @NonNull
    String encrypt(@NonNull String plaintext) throws CipherFailure {
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key());

            byte[] iv = cipher.getIV();
            if (iv == null || iv.length != IV_LENGTH_BYTES) {
                throw new CipherFailure("Unexpected IV length from the platform");
            }

            byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            // Layout: [12-byte IV][ciphertext || 16-byte GCM tag]
            byte[] combined = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);

            return Base64.encodeToString(combined, Base64.NO_WRAP);
        } catch (CipherFailure failure) {
            throw failure;
        } catch (Exception error) {
            throw new CipherFailure("Encryption failed", error);
        }
    }

    @NonNull
    String decrypt(@NonNull String encoded) throws CipherFailure {
        try {
            byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
            if (combined.length <= IV_LENGTH_BYTES) {
                throw new CipherFailure("Stored value is truncated");
            }

            byte[] iv = new byte[IV_LENGTH_BYTES];
            System.arraycopy(combined, 0, iv, 0, IV_LENGTH_BYTES);

            byte[] ciphertext = new byte[combined.length - IV_LENGTH_BYTES];
            System.arraycopy(combined, IV_LENGTH_BYTES, ciphertext, 0, ciphertext.length);

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_LENGTH_BITS, iv));

            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (CipherFailure failure) {
            throw failure;
        } catch (Exception error) {
            // Includes AEADBadTagException (tampering) and
            // KeyPermanentlyInvalidatedException (key lost after a restore).
            throw new CipherFailure("Decryption failed", error);
        }
    }

    /** Drop the key, making every existing ciphertext permanently unreadable. */
    void deleteKey() {
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias);
            }
        } catch (Exception ignored) {
            // Nothing useful to do here: the caller is already recovering.
        }
    }

    private synchronized SecretKey key() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);

        KeyStore.Entry entry = keyStore.getEntry(alias, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }

        KeyGenerator generator =
                KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);

        generator.init(
                new KeyGenParameterSpec.Builder(
                        alias,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(KEY_SIZE_BITS)
                        // The platform must pick the IV; supplying our own would
                        // risk reuse, which destroys GCM's security entirely.
                        .setRandomizedEncryptionRequired(true)
                        // Workers read the token while the device is locked.
                        .setUserAuthenticationRequired(false)
                        .build(),
                SecureRandom.getInstanceStrong());

        return generator.generateKey();
    }

    /** Checked failure, so every caller has to decide how to recover. */
    static final class CipherFailure extends Exception {
        CipherFailure(String message) {
            super(message);
        }

        CipherFailure(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
