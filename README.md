# Android Device Gateway Platform

Turn Android phones and tablets into remotely managed gateway devices.

An administrator enrolls a handset from a web dashboard, the handset runs a
background agent, and the administrator can then see its live state and send it
commands. Multi-tenant, role-aware, and built so the polling transport can be
replaced with a push transport without rewriting the business logic.

```
Admin Dashboard  ──►  Next.js Backend API  ──►  MongoDB
   (Next.js)              (same app)                │
                                │                   │
                                ▼                   │
                    Android Gateway Agent ◄─────────┘
                    (native Java, polling)
```

## What is in the repository

| Path | What it is |
| --- | --- |
| [`web/`](web/) | Next.js 16 app: the admin dashboard **and** the REST API |
| [`android/`](android/) | Native Android gateway agent, Java, Gradle |
| [`web/scripts/simulate-device.ts`](web/scripts/simulate-device.ts) | A virtual gateway that speaks the same protocol — exercise the whole system without an Android device |
| [`web/scripts/smoke-test.ts`](web/scripts/smoke-test.ts) | 55 end-to-end assertions over the live API |

## Quick start

You need Node 20+, a MongoDB instance, and (for the app) JDK 17+ with the
Android SDK.

```bash
# 1. Backend + dashboard
cd web
cp .env.example .env.local          # then set MONGODB_URI and JWT_SECRET
npm install
npm run seed                        # creates a super admin, a demo org, two users
npm run dev                         # http://localhost:3000
```

Sign in at <http://localhost:3000/login> with the credentials `npm run seed`
prints (by default `admin@acme.test` / `OrgAdmin123!`).

```bash
# 2. A device, without building the app
cd web
npm run simulate -- --token XXXX-XXXX-XXXX   # code from Devices → New enrollment token
```

```bash
# 3. The real Android app
cd android
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

On an emulator the host is reachable at `10.0.2.2`, which is the app's default
server URL (`http://10.0.2.2:3000/`). On a physical device, enter your machine's
LAN address in the app's Server URL field.

## The end-to-end flow

```
Admin signs in
      ↓
Creates an enrollment token          POST /api/devices/enrollment-token
      ↓
Android app redeems it               POST /api/gateway/register       → device API token
      ↓
Device appears in the dashboard
      ↓
Android sends heartbeats             POST /api/gateway/heartbeat      → status ONLINE
      ↓
Admin queues a command               POST /api/devices/:id/commands   → PENDING
      ↓
Android claims it atomically         GET  /api/gateway/commands       → DELIVERED
      ↓
Android executes it locally
      ↓
Android reports the result           POST /api/gateway/commands/:id/result → SUCCESS
      ↓
Admin sees the result and the logs
```

## Design decisions worth knowing

**A command is delivered to exactly one poll.** Claiming is a single
`findOneAndUpdate` that filters on `status: PENDING` and flips the status in the
same round trip, sorted by priority then age. Two concurrent polls cannot both
win, because the loser's filter no longer matches. A read-then-write would race
here, which is why it is not used. See
[`command.service.ts`](web/src/modules/command/command.service.ts).

**A result can be retried forever without re-running the command.** The device
executes a command once, immediately after claiming it. If reporting the outcome
fails, only the *outcome* is queued (in Room on the device). Submitting a result
for a command that is already finished returns the stored outcome and changes
nothing.

**Admin and device authentication share nothing.** Administrators get a JWT
access token plus a rotating refresh token in httpOnly cookies. Devices get an
opaque API token whose secret half is stored only as a SHA-256 hash. A device
token cannot reach any `/api/devices` route, and an admin JWT cannot reach any
`/api/gateway` route.

**Tenant isolation is enforced in one place.** Every tenant-scoped query builds
its filter through `resolveOrganizationScope`, and every device operation loads
its device through `DeviceService.findInScope`. A client-supplied
`organizationId` is a 403, not an empty result set.

**Presence and queue hygiene work without a cron runner.** Devices go OFFLINE
and commands EXPIRE through throttled lazy sweeps on the read paths, so the MVP
needs no scheduler. Both are single indexed `updateMany` calls.

**The transport is an interface on both sides.** Server-side
[`CommandTransport`](web/src/modules/gateway/transport/command-transport.ts) and
client-side [`CommandTransport`](android/app/src/main/java/com/example/gateway/transport/CommandTransport.java)
have exactly one implementation each today (polling). Adding WebSocket, MQTT or
RabbitMQ means adding an implementation on each side; no command handler, route
or worker changes.

**SEND_SMS is off by default and gated three times.** The platform-wide
`SMS_COMMAND_ENABLED` flag, the organization's own setting, and the runtime
SEND_SMS permission on the handset must all be on. Nothing in the app bypasses
the platform's premium-SMS confirmation, uses hidden APIs, or automates the
dialog — see [`AndroidSmsSender`](android/app/src/main/java/com/example/gateway/sms/AndroidSmsSender.java).

## Verification

Everything below was run against this code, not asserted from the design.

| Check | Command | Result |
| --- | --- | --- |
| Backend end-to-end | `cd web && npm run smoke` | 58 assertions pass |
| Backend units | `cd web && npm test` | 8 pass |
| Types & lint | `cd web && npm run typecheck && npm run lint` | clean |
| Production build | `cd web && npm run build` | clean |
| Android build | `cd android && ./gradlew assembleDebug` | clean, no compiler warnings |
| Android lint | `cd android && ./gradlew lintDebug` | 0 findings |
| Android units | `cd android && ./gradlew testDebugUnitTest` | 15 pass |

The smoke test is not a happy-path script. Among other things it asserts that:

- a single command fired at **six concurrent polls** is claimed exactly once;
- resubmitting a result is idempotent and does not alter a finished command;
- a device token gets 401 on an admin route, and an admin session gets 401 on a
  gateway route;
- one tenant reading another tenant's device gets 404, and a forged
  `organizationId` query parameter gets 403;
- a single-use enrollment token cannot be redeemed twice;
- blocking a device stops its polling and drops its queued commands;
- revoking a device token stops it working immediately;
- a member can read devices but cannot queue commands or mint enrollment tokens.

### Verified on a real device

The APK was installed on an Android emulator (API 36) and driven through its own
UI against the live backend:

| Behaviour | Observed |
| --- | --- |
| Enrollment | App redeemed a dashboard code; device appeared as `DEV-F3587321`, `ONLINE`, reporting `sdk_gphone64_x86_64` / Android 16 / API 36 |
| Heartbeat + presence | Battery, charging state and network type arrived and rendered in the dashboard |
| Command execution | `GET_DEVICE_STATUS`, `SYNC_NOW`, `UPDATE_CONFIG` and `SEND_SMS` all executed and reported `SUCCESS` |
| `UPDATE_CONFIG` | New cadence applied on the handset *and* persisted server-side; the next heartbeat returned the new values rather than reverting them |
| Offline result queue | With result submission failing, the device queued the outcome locally (`1 result waiting to send`) and the command stayed `DELIVERED`. When delivery recovered, the result flushed and the command became `SUCCESS` **with `deliveryAttempts` still 1** — the command was never re-executed |
| Foreground service | Started as `dataSync` with an ongoing notification and a Stop action, polling at the configured 25s interval |
| SEND_SMS gates | Refused with a 403 while the platform switch was off; refused again while the tenant switch was off; reported a typed `SMS_UNAVAILABLE` failure without the runtime permission; succeeded only once all three were open |

Two real bugs came out of that run and are fixed:

1. **Device tokens were rejected about half the time.** The token is
   `adgd_<id>_<secret>` and the secret is base64url — whose alphabet contains
   `_`. Splitting on every underscore rejected any token whose secret happened
   to contain one. There is now a regression test that generates 500 tokens
   ([`crypto.test.ts`](web/src/lib/crypto.test.ts)).
2. **`UPDATE_CONFIG` silently reverted.** The device applied the new cadence,
   but the server never learned it, so the next heartbeat handed back the old
   values. A confirmed `UPDATE_CONFIG` now writes through to the device record,
   covered by two smoke assertions.

## Documentation

- [`web/README.md`](web/README.md) — backend and dashboard: structure, API
  reference, security model, operations
- [`android/README.md`](android/README.md) — the agent: architecture, background
  execution strategy, offline queue, SMS policy

## Deliberately out of scope for the MVP

RabbitMQ, MQTT, WebSocket, billing, push notifications, MDM/device-owner
features, remote APK installation, remote locking, root. The modules are shaped
so these can be added later; none of them is stubbed or half-built.
