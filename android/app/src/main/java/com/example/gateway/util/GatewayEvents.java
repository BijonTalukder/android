package com.example.gateway.util;

import android.os.Handler;
import android.os.Looper;

import androidx.annotation.MainThread;
import androidx.annotation.NonNull;

import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Tiny in-process event bus so background workers can nudge the UI.
 *
 * Deliberately not {@code LocalBroadcastManager} (deprecated) and not a
 * third-party bus: the app has exactly two events and one observer, so a
 * listener list dispatched onto the main thread is the whole requirement.
 * Listeners are held strongly, so an Activity must unregister in onStop.
 */
public final class GatewayEvents {

    public enum Event {
        /** Something a screen might be displaying has changed. */
        STATE_CHANGED,
        /** The backend rejected our device token; the app must re-enroll. */
        UNAUTHORIZED,
    }

    public interface Listener {
        @MainThread
        void onGatewayEvent(@NonNull Event event);
    }

    private static final CopyOnWriteArrayList<Listener> LISTENERS = new CopyOnWriteArrayList<>();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    public static void register(@NonNull Listener listener) {
        LISTENERS.addIfAbsent(listener);
    }

    public static void unregister(@NonNull Listener listener) {
        LISTENERS.remove(listener);
    }

    /** Safe to call from any thread. */
    public static void emit(@NonNull Event event) {
        if (LISTENERS.isEmpty()) {
            return;
        }
        MAIN.post(() -> {
            for (Listener listener : LISTENERS) {
                listener.onGatewayEvent(event);
            }
        });
    }

    private GatewayEvents() {
        throw new AssertionError("No instances");
    }
}
