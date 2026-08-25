# Backend API & Admin Dashboard

Next.js 16 (App Router) + TypeScript + MongoDB/Mongoose. One deployable that
serves both the admin dashboard and the REST API the Android agent talks to.

## Running it

```bash
cp .env.example .env.local     # set MONGODB_URI and a 32+ char JWT_SECRET
npm install
npm run seed
npm run dev                    # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run seed` | Idempotent: super admin, demo organization, two users |
| `npm run smoke` | 55 end-to-end assertions against a running server |
| `npm test` | Unit tests (`src/**/*.test.ts`) |
| `npm run simulate` | Virtual gateway device — see below |
| `npm run typecheck` / `npm run lint` | Types and lint |

### The device simulator

A Node implementation of the same protocol the Android app speaks, including the
offline result queue. It is the fastest way to exercise the whole system.

```bash
npm run simulate -- --token XXXX-XXXX-XXXX --name "Warehouse 01"   # enroll
npm run simulate -- --name "Warehouse 01"                          # keep running
npm run simulate -- --name "Warehouse 01" --once                   # one cycle
```

State lives in `.device-simulator/<name>.json` (git-ignored: it holds a real
device API token).

## Structure

```
src/
├── app/
│   ├── (auth)/login, register          Client-rendered auth pages
│   ├── dashboard/                      Overview, devices, commands, logs,
│   │                                   settings, organizations
│   └── api/
│       ├── auth/                       login, logout, refresh, me, register
│       ├── devices/                    list, detail, commands, logs,
│       │                               enrollment-token, revoke-token
│       ├── commands/                   list, detail, cancel
│       ├── organizations/, users/      Tenant + team administration
│       ├── logs/, dashboard/summary    Reporting
│       ├── gateway/                    register, heartbeat, commands, result, config
│       └── health/                     Liveness + DB readiness
│
├── modules/                            Business logic, one folder per domain
│   ├── auth/            login, refresh-token rotation, registration
│   ├── organization/    tenants and their settings
│   ├── user/            team management and role rules
│   ├── device/          lifecycle, enrollment tokens, presence sweep, logs
│   ├── command/         creation, atomic claim, results, expiry reaper
│   ├── gateway/         device auth, enrollment, heartbeat, transport/
│   ├── dashboard/       aggregates
│   └── audit-log/       who did what
│
├── models/                             Mongoose schemas and indexes
├── lib/                                env, mongodb, auth, response, crypto,
│                                       rate-limit, transaction, pagination
├── middleware/                         auth.middleware, role.middleware
├── services/                           Stable import paths into modules/
├── components/                         UI primitives, dashboard shell, providers
├── hooks/                              useApi, useUrlFilters
└── types/                              Shared enums and API envelope types
```

Route handlers are thin by construction: `handler()` in
[`lib/response.ts`](src/lib/response.ts) owns the DB connection and error
translation, so a handler is authenticate → validate → call a service → wrap.
The chain is always **Route → Service → Model**.

`services/` re-exports from `modules/` so consumers import a stable path while
the module internals stay free to move — or to be extracted into a separate
service later.

## API

Every response uses one envelope:

```jsonc
{ "success": true,  "data": { }, "message": "Success" }
{ "success": false, "message": "Validation failed", "errors": { "email": ["Already in use"] }, "code": "VALIDATION_ERROR" }
```

### Admin — cookie session or `Authorization: Bearer <access token>`

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/login` | Sets `adg_access` + `adg_refresh` httpOnly cookies |
| POST | `/api/auth/logout` | Revokes the whole session chain |
| POST | `/api/auth/refresh` | Rotates the refresh token |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/register` | Self-serve org signup; needs `ALLOW_PUBLIC_REGISTRATION` |
| GET | `/api/devices` | `page limit status search sort order organizationId` |
| GET/PATCH/DELETE | `/api/devices/:id` | PATCH sets name, config, or `BLOCKED`/`INACTIVE`/`OFFLINE` |
| POST | `/api/devices/:id/revoke-token` | Device must re-enroll |
| GET/POST | `/api/devices/enrollment-token` | The plaintext code is returned **once** |
| DELETE | `/api/devices/enrollment-token/:tokenId` | Revoke |
| GET/POST | `/api/devices/:id/commands` | List / queue |
| GET | `/api/commands` | `deviceId type status priority from to` |
| GET | `/api/commands/:id` | |
| POST | `/api/commands/:id/cancel` | Only while still `PENDING` |
| GET | `/api/devices/:id/logs`, `/api/logs` | Per-device and organization-wide |
| GET | `/api/dashboard/summary` | Counts plus recent activity |
| GET/POST | `/api/organizations` | Super admin only |
| GET/PATCH | `/api/organizations/:id` | Tenant admins may read and tune their own |
| GET/POST | `/api/users`, GET/PATCH/DELETE `/api/users/:id` | |
| GET | `/api/health` | Unauthenticated |

### Gateway — `Authorization: Bearer <device API token>`

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/gateway/register` | Authenticated by the enrollment code, not a token |
| POST | `/api/gateway/heartbeat` | Sets `ONLINE`, returns config + pending count |
| GET | `/api/gateway/commands?limit=10` | **Atomically claims** up to `limit` commands |
| POST | `/api/gateway/commands/:id/result` | Idempotent; echo `claimId` |
| GET | `/api/gateway/config` | Re-sync config outside a heartbeat |

## Data model

| Collection | Key indexes |
| --- | --- |
| `organizations` | `slug` unique |
| `users` | `email` unique, `(organizationId, role)` |
| `devices` | `(organizationId, deviceId)` unique, `(organizationId, installationId)` unique, `tokenId` unique partial, `(organizationId, status, lastSeenAt)`, `lastSeenAt` |
| `devicecommands` | `(deviceId, status, priorityWeight desc, createdAt)` — serves the claim query, `(organizationId, status, createdAt)`, `(status, expiresAt)`, `(status, claimedAt)` |
| `devicelogs` | `(organizationId, deviceId, createdAt)`, 90-day TTL |
| `enrollmenttokens` | `tokenHash` unique, TTL a week past expiry |
| `refreshtokens` | `tokenHash` unique, TTL a day past expiry |
| `auditlogs` | `(organizationId, createdAt)`, `(actorId, createdAt)` |

`Device.deviceId` is the public, human-quotable identifier (`DEV-1A2B3C4D`).
`DeviceCommand.deviceId` is an ObjectId referencing `Device._id`.

## Command lifecycle

```
PENDING ──claim──► DELIVERED ──ack──► PROCESSING ──result──► SUCCESS / FAILED
   │                   │                   │
   └── expiry ──► EXPIRED                  └── stall ──► PENDING (re-queued)
```

The claim is one `findOneAndUpdate` filtered on `status: PENDING`, sorted by
`priorityWeight` desc then `createdAt` asc, with a fresh `claimId` written in the
same operation. A re-queue mints a new `claimId`, so a late result carrying the
old one is refused with 409 rather than recorded against an attempt that has
been superseded.

`COMMAND_CLAIM_TIMEOUT_SECONDS` bounds how long a claim may stall before it is
re-queued, and `COMMAND_MAX_DELIVERY_ATTEMPTS` bounds how often that can happen
before the command is failed for good.

## Security

- **Passwords** — bcrypt, cost 12. Login answers identically for an unknown
  email and a wrong password, and spends comparable time on both.
- **Admin sessions** — 15-minute HS256 access token, 30-day opaque refresh token
  hashed with SHA-256 in Mongo. Rotation is mandatory; replaying an
  already-rotated token revokes the whole chain, because there is no safe way to
  tell the attacker from the victim.
- **Device tokens** — `adgd_<tokenId>_<secret>`. `tokenId` is indexed so
  verification is one point lookup; the secret is compared as a SHA-256 in
  constant time. High-entropy secrets do not need a work factor, and a
  deterministic hash is what makes the lookup possible.
- **Roles** — `SUPER_ADMIN`, `ORGANIZATION_ADMIN`, `ORGANIZATION_MEMBER`.
  Enforced in services, never in the UI alone. A member reading devices is fine;
  a member queueing a command is a 403.
- **Tenant isolation** — one `resolveOrganizationScope` helper builds every
  scoped filter. A cross-tenant id is a 404 (existence is not confirmed) and a
  forged `organizationId` query parameter is a 403.
- **Live re-checks** — `requireAuth` re-reads the user and organization on every
  request, so a suspension takes effect immediately rather than when the token
  expires. Blocking a device drops its queued commands in the same operation.
- **Validation** — Zod at every boundary, including a per-type payload schema for
  each command.
- **Rate limiting** — in-process fixed windows on login, registration, refresh,
  enrollment and gateway traffic. Swap `enforceRateLimit` for a Redis
  implementation before running more than one instance; no caller changes.
- **Audit log** — enrollment, token issuance and revocation, device changes,
  command creation, user and organization changes. SMS bodies are never audited
  verbatim, only the destination and the length.

## Configuration

Everything is validated once, at startup, in [`lib/env.ts`](src/lib/env.ts) —
see [`.env.example`](.env.example) for the annotated list. The ones that change
behaviour most:

| Variable | Default | Effect |
| --- | --- | --- |
| `DEVICE_OFFLINE_THRESHOLD_SECONDS` | 180 | Silence after which a device reads as OFFLINE |
| `COMMAND_DEFAULT_TTL_SECONDS` | 21600 | Command lifetime when the caller sets none |
| `COMMAND_CLAIM_TIMEOUT_SECONDS` | 300 | Stall before a claim is re-queued |
| `COMMAND_MAX_DELIVERY_ATTEMPTS` | 5 | Re-queues before a command is failed |
| `ALLOW_PUBLIC_REGISTRATION` | false | Enables `/register` |
| `SMS_COMMAND_ENABLED` | false | Platform-wide SEND_SMS switch |
| `COMMAND_TRANSPORT` | polling | Server-side transport implementation |

## Operational notes

- **MongoDB replica set.** `withTransaction` probes the topology and degrades to
  running without a session on a standalone `mongod`, so a developer can boot
  against a plain local instance. Production should use a replica set; the
  registration and organization-creation paths are the ones that want real
  atomicity.
- **No scheduler required.** Presence and command expiry are lazy sweeps on the
  read paths, throttled to at most once every 5 seconds per scope. If you do have
  a scheduler, calling `sweepStaleDevices()` and `sweepCommands()` on a timer is
  strictly better and needs no code change.
- **HTTPS.** A device API token sent over plain HTTP is a token handed to anyone
  on the network path. The Android app only permits cleartext to `10.0.2.2` and
  `localhost`, for development.
