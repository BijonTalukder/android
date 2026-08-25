# Android Gateway Agent

Native Android, Java. Enrolls itself against the backend, reports its state, and
executes commands sent from the dashboard.

| | |
| --- | --- |
| Language | Java 17 |
| `minSdk` | 26 (Android 8.0) — the first release with modern background rules and notification channels |
| `compileSdk` / `targetSdk` | 37 (Android 17) |
| Build | AGP 9.3.2, Gradle 9.7.1 |
| Networking | Retrofit 3 + OkHttp 5 + Gson |
| Background | WorkManager 2.11 + one opt-in foreground service |
| Storage | Room 2.8 + AES-256-GCM over the Android Keystore |

## Build and install

```bash
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

Point it at the backend in the app's **Server URL** field. On an emulator the
host machine is `10.0.2.2`, which is the built-in default; on a physical device
use your machine's LAN address.

```bash
./gradlew testDebugUnitTest   # 16 unit tests
./gradlew lintDebug           # 0 findings
```

## Enrolling a device

1. In the dashboard: **Devices → New enrollment token**. Copy the code — it is
   shown once.
2. In the app: enter the server URL, a device name and the code, then **Enroll**.
3. The backend returns a device API token. It is written to Keystore-encrypted
   storage immediately and never leaves the device.

Re-enrolling with the same install is idempotent: the backend recognises the
installation id, rotates the token, and does not create a duplicate device.

## Architecture

```
com.example.gateway
├── GatewayApplication      Composition root: builds the object graph, registers
│                           command handlers, schedules work on start
├── ui/MainActivity         Enrollment form, live status, manual controls
├── network/
│   ├── GatewayApi              Retrofit interface
│   ├── ApiClient               Client cache + envelope unwrapping
│   ├── DeviceAuthInterceptor   Bearer token on every call but enrollment
│   └── ApiException            Typed: unauthorized / forbidden / stale / retryable
├── transport/
│   ├── CommandTransport            How commands arrive (interface)
│   └── PollingCommandTransport     The MVP implementation
├── command/
│   ├── CommandHandler          One type, one handler
│   ├── CommandExecutor         Registry-based dispatch
│   ├── CommandResult           Success payload or typed failure
│   └── …CommandHandler         GET_DEVICE_STATUS, SYNC_NOW, UPDATE_CONFIG, SEND_SMS
├── sms/
│   ├── SmsSender               Interface
│   └── AndroidSmsSender        Platform implementation
├── repository/GatewayRepository    The cycle: enroll → heartbeat → claim → run → report
├── storage/
│   ├── SecureStorage           Device token, install id, server URL (encrypted)
│   ├── KeystoreCipher          AES-256-GCM, key in the Android Keystore
│   └── AppDatabase             Room: pending results + device config
├── worker/
│   ├── WorkScheduler           Every WorkManager registration lives here
│   ├── HeartbeatWorker
│   ├── CommandPollingWorker
│   └── ResultRetryWorker
├── service/GatewayForegroundService   Opt-in fast polling
├── receiver/BootReceiver             Re-arm after reboot or app update
└── util/DeviceInfoProvider, GatewayEvents
```

## Background execution: what actually happens

WorkManager's minimum periodic interval is **15 minutes**, and Doze can defer
even that. A 30-second polling interval is therefore not achievable with
periodic work, and the app does not pretend otherwise. It uses two layers:

**Periodic work — always on, the reliable floor.** `HeartbeatWorker` and
`CommandPollingWorker` are registered as unique periodic work with a network
constraint and exponential backoff. They survive reboot, process death and app
updates. A heartbeat that reports pending commands schedules an immediate
one-shot poll rather than waiting for the next period, so the effective latency
is usually far better than the interval suggests.

**Foreground service — opt-in, honours the configured interval.**
`GatewayForegroundService` polls at the configured cadence and shows a permanent
notification saying so, with a **Stop** action in the notification itself. It is
declared `dataSync`, which is what it does. It is never started automatically —
not at boot, not after an update — because starting a user-visible ongoing
service without being asked is exactly the behaviour modern Android restricts.

Stopping the service degrades the cadence to the 15-minute floor. It does not
break the agent.

## Offline result queue

```
Command claimed
      ↓
Executed exactly once                    ← the only place a handler ever runs
      ↓
Report the result
      ├── accepted (or 409 stale claim) → done
      └── network failure / 5xx         → row in Room `pending_results`
                                              ↓
                              ResultRetryWorker, network-constrained
                                              ↓
                                   flushed oldest-first
```

The queue holds **results, never commands**. By the time a row exists the
command has already run, so flushing can never cause a second execution. That is
the property that makes result delivery safe to retry indefinitely.

Each claim carries a `claimId`. If the backend re-queued the command while the
device was working on it, the claim id no longer matches and the result is
refused with 409 — the queued row is dropped rather than retried forever,
because a retry could never succeed and the command will be handed out again.

`pending_results` also records `abandoned` rows (retry limit reached, or
permanently rejected), so a delivery that genuinely failed is visible rather
than silently discarded.

## Adding a command type

1. Implement `CommandHandler`:

```java
public class RebootAppCommandHandler implements CommandHandler {
    @NonNull @Override public String getType() { return "REBOOT_APP"; }

    @NonNull @Override
    public CommandResult execute(@NonNull DeviceCommand command) {
        return new CommandResult.Builder().put("restarted", true).build();
    }
}
```

2. Register it in `GatewayApplication.buildRepository`.
3. Add the type and its payload schema to the backend
   (`web/src/types/index.ts` and `web/src/modules/command/command.schema.ts`).

There is no dispatch block to edit. An app that meets a command type it does not
know reports `UNSUPPORTED_COMMAND` back to the dashboard rather than failing
silently, so a version skew is visible to the operator.

## Replacing the transport

`CommandTransport` has one method: `receive(int limit)`. For polling it is a
network round trip; for a push transport it would drain a buffer the connection
has been filling. Implement the interface, change the one line in
`GatewayApplication.buildRepository`, and nothing else moves — not the executor,
not a handler, not the offline queue.

## Security

- **The device API token** is written through `KeystoreCipher`: AES-256-GCM with
  a non-exportable key in the Android Keystore, hardware-backed where a TEE or
  StrongBox exists. Every value gets a fresh platform-generated IV, and GCM
  authenticates the ciphertext so tampering fails loudly.

  Jetpack Security's `EncryptedSharedPreferences` would have been the obvious
  choice, but Google has deprecated that library. This is the supported
  equivalent and it removes a dependency rather than adding one.

- **No hardware identifiers.** Identity is a random UUID generated on first
  launch. IMEI and friends are restricted on modern Android and were never an
  authentication mechanism.

- **Nothing is backed up.** The Keystore key is not backed up, so a restored
  ciphertext would be unreadable anyway; both the encrypted store and the
  database are excluded from cloud backup and device transfer. A restored
  install simply re-enrolls.

- **Cleartext HTTP is off** except for `10.0.2.2` and `localhost`, for
  development. See `network_security_config.xml`.

- **A revoked token stops the agent.** A 401 or 403 clears the stored
  credentials, cancels scheduled work, and prompts for a new enrollment code.

## SEND_SMS

Three gates, all of which must be open before a message leaves the handset:

1. `SMS_COMMAND_ENABLED` on the backend (platform-wide, off by default);
2. the organization's own SMS setting in the dashboard;
3. the runtime `SEND_SMS` permission, granted by the person holding the phone.

`AndroidSmsSender` validates the destination, splits long bodies into a proper
concatenated multipart message, honours an explicit SIM subscription, and
returns a typed outcome. Every SMS command is recorded in the device log with
the destination and the message length — never the body.

What it does not do, and must not be extended to do: bypass or auto-dismiss the
platform's premium-SMS confirmation, use hidden or reflected APIs, use
accessibility automation or root, or send anything an operator has not queued
through the backend.

Outbound SMS from a managed device is subject to carrier rules, local law,
recipient consent and Google Play's SMS policy. This app assumes the deployment
has satisfied all four; it cannot verify them.

## Testing without a handset

`web/scripts/simulate-device.ts` is a Node implementation of this same protocol,
including the offline result queue. It is the quickest way to exercise the
backend and the dashboard end to end:

```bash
cd ../web
npm run simulate -- --token XXXX-XXXX-XXXX --name "Warehouse 01"
```
