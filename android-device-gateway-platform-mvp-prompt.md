# Android Device Gateway Platform — MVP Development Prompt

Build a production-oriented MVP for an **Android Device Gateway Platform**.

## Product Concept

The Android Device Gateway Platform turns Android phones/tablets into remotely managed gateway devices.

The system has three parts:

1. Next.js Admin Dashboard
2. Next.js Backend API
3. Native Android Java Gateway App

The MVP must use:

- Next.js latest stable
- TypeScript
- Next.js App Router
- MongoDB
- Mongoose
- Native Android Java
- REST API initially
- JWT authentication
- Clean modular architecture

Do NOT use microservices for the MVP.

The Next.js application should contain both:

- Admin Web Dashboard
- Backend API

However, the architecture must be modular enough that the backend can later be extracted into separate services without rewriting core business logic.

---

# Core Product Flow

```text
Admin Dashboard
      │
      ▼
Next.js Backend API
      │
      ├── MongoDB
      │
      ▼
Android Gateway Device
      │
      ├── Device Information
      ├── Device Status
      ├── Command Execution
      ├── SMS Module
      └── Offline Command Queue
```

The Android application acts as a Gateway Agent.

The Admin can register and manage Android devices remotely.

The backend can send commands to a specific device.

Initially, the Android app should poll the backend for pending commands.

Later, this polling system should be replaceable with WebSocket, MQTT, RabbitMQ, or another real-time transport.

Therefore, keep the Command Transport layer abstract.

---

# Multi-Tenant Architecture

The system must support multiple organizations.

Hierarchy:

```text
Platform
   │
   ├── Organization A
   │      ├── Admin Users
   │      └── Android Devices
   │
   └── Organization B
          ├── Admin Users
          └── Android Devices
```

Users must never access devices from another organization.

Every relevant database query must enforce organization isolation.

---

# User Roles

Implement:

1. `SUPER_ADMIN`
2. `ORGANIZATION_ADMIN`
3. `ORGANIZATION_MEMBER`

Permissions:

### SUPER_ADMIN

- Manage all organizations
- View all users
- View all devices

### ORGANIZATION_ADMIN

- Manage organization users
- Register/manage organization devices
- Send commands
- View device logs

### ORGANIZATION_MEMBER

- View assigned/organization devices
- Limited permissions

Use role-based authorization middleware/helpers.

---

# Next.js Project Structure

Use a structure similar to:

```text
src/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── register/
│   │
│   ├── dashboard/
│   │   ├── page.tsx
│   │   ├── devices/
│   │   ├── commands/
│   │   ├── logs/
│   │   └── settings/
│   │
│   └── api/
│       ├── auth/
│       ├── devices/
│       ├── commands/
│       ├── gateway/
│       └── health/
│
├── modules/
│   ├── auth/
│   ├── organization/
│   ├── user/
│   ├── device/
│   ├── command/
│   ├── gateway/
│   └── audit-log/
│
├── models/
│   ├── User.ts
│   ├── Organization.ts
│   ├── Device.ts
│   ├── DeviceCommand.ts
│   ├── DeviceLog.ts
│   └── RefreshToken.ts
│
├── lib/
│   ├── mongodb.ts
│   ├── auth.ts
│   └── response.ts
│
├── middleware/
│   ├── auth.middleware.ts
│   └── role.middleware.ts
│
├── services/
│   ├── DeviceService.ts
│   ├── CommandService.ts
│   └── GatewayService.ts
│
└── types/
```

Important:

Route Handlers must remain thin.

Business logic must NOT be placed directly inside API route handlers.

Use:

```text
Route
→ Service
→ Model/Repository
```

---

# MongoDB Collections

## Organization

```text
_id
name
slug
status
createdAt
updatedAt
```

---

## User

```text
_id
organizationId
name
email
passwordHash
role
status
createdAt
updatedAt
```

Create proper MongoDB indexes.

---

## Device

```text
_id
organizationId

deviceId
deviceName

manufacturer
model
androidVersion
sdkVersion

appVersion

status
lastSeenAt

batteryLevel
isCharging

networkType

createdAt
updatedAt
```

Status:

```text
ONLINE
OFFLINE
INACTIVE
BLOCKED
```

Create indexes for:

```text
organizationId + deviceId
organizationId + status
lastSeenAt
```

---

## DeviceCommand

```text
_id

organizationId
deviceId

type
payload

status

priority

createdBy

createdAt
updatedAt

sentAt
executedAt

expiresAt

result
error
```

Command status:

```text
PENDING
DELIVERED
PROCESSING
SUCCESS
FAILED
EXPIRED
```

Priority:

```text
LOW
NORMAL
HIGH
CRITICAL
```

---

## DeviceLog

```text
_id

organizationId
deviceId

level

event

message

metadata

createdAt
```

Log level:

```text
INFO
WARNING
ERROR
```

---

# Device Registration

The Android app must register itself securely.

Flow:

```text
Android App Installed
        ↓
Generate persistent unique installation ID
        ↓
Admin creates Device Enrollment Token
        ↓
Android app enters/scans token
        ↓
POST /api/gateway/register
        ↓
Backend validates token
        ↓
Device registered
        ↓
Backend returns Device API Token
        ↓
Store token securely on Android
```

Do NOT use only IMEI or other restricted hardware identifiers as the primary authentication mechanism.

The Device API Token must identify the device.

Store hashed tokens on the backend if possible.

Implement token rotation capability.

---

# Android Device Authentication

Every Android Gateway request must include:

```text
Authorization: Bearer DEVICE_API_TOKEN
```

The backend must verify:

- Token is valid
- Device exists
- Device is active
- Organization exists
- Device is not blocked

The device token must NOT have admin permissions.

Separate Admin JWT authentication from Device authentication.

---

# MVP API

## Admin APIs

### Authentication

```text
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/refresh
GET  /api/auth/me
```

### Devices

```text
GET    /api/devices
POST   /api/devices/enrollment-token
GET    /api/devices/:id
PATCH  /api/devices/:id
DELETE /api/devices/:id
```

### Commands

```text
POST /api/devices/:id/commands
GET  /api/devices/:id/commands
GET  /api/commands/:id
```

### Logs

```text
GET /api/devices/:id/logs
```

---

# Gateway APIs

## Register

```text
POST /api/gateway/register
```

Request:

```json
{
  "enrollmentToken": "XXXX-XXXX",
  "device": {
    "installationId": "unique-app-installation-id",
    "deviceName": "Office Gateway 01",
    "manufacturer": "Samsung",
    "model": "Galaxy A54",
    "androidVersion": "15",
    "sdkVersion": 35,
    "appVersion": "1.0.0"
  }
}
```

---

## Heartbeat

```text
POST /api/gateway/heartbeat
```

The Android app sends heartbeat periodically.

Request:

```json
{
  "batteryLevel": 85,
  "isCharging": true,
  "networkType": "WIFI"
}
```

Update:

```text
status = ONLINE
lastSeenAt = now
```

A scheduled cleanup/status service should mark devices OFFLINE if:

```text
lastSeenAt > configured threshold
```

For MVP, this can be evaluated when querying devices if server cron infrastructure is unavailable.

---

## Fetch Commands

```text
GET /api/gateway/commands?limit=10
```

The backend returns pending commands assigned to that authenticated device.

Important:

Prevent the same command from being executed multiple times.

Use an atomic MongoDB update such as:

```text
findOneAndUpdate()
```

to claim a `PENDING` command and change it to `DELIVERED` or `PROCESSING`.

Do NOT use:

1. Find pending command
2. Then separately update

because multiple requests could receive the same command.

Use an atomic claim strategy.

---

## Command Acknowledge / Result

```text
POST /api/gateway/commands/:id/result
```

Example:

```json
{
  "status": "SUCCESS",
  "result": {
    "message": "Command executed successfully"
  }
}
```

Failure:

```json
{
  "status": "FAILED",
  "error": {
    "code": "COMMAND_FAILED",
    "message": "Reason for failure"
  }
}
```

---

# Command System

Implement these MVP commands.

## 1. GET_DEVICE_STATUS

Android returns:

```json
{
  "batteryLevel": 85,
  "isCharging": false,
  "networkType": "WIFI",
  "appVersion": "1.0.0",
  "timestamp": "..."
}
```

---

## 2. SYNC_NOW

Android immediately performs a sync operation.

For MVP, implement this as a demonstrable command.

---

## 3. UPDATE_CONFIG

Payload:

```json
{
  "pollingIntervalSeconds": 30,
  "heartbeatIntervalSeconds": 60
}
```

The Android app saves the configuration locally.

---

## 4. SEND_SMS

This command should be architecturally implemented, but SMS execution must respect Android permissions, platform restrictions, carrier rules, user consent, and Google Play policies.

Payload:

```json
{
  "destination": "017XXXXXXXX",
  "message": "Test message"
}
```

Requirements:

- Validate destination
- Validate message length
- Support multipart SMS
- Support selecting the configured/default SMS subscription
- Return sent/failed result
- Log every SMS command
- Never implement a bypass for premium SMS confirmation dialogs
- Never use hidden APIs, accessibility automation, root, or security bypasses

Create an interface so the SMS implementation can later be replaced:

```text
SmsSender
  └── AndroidSmsSender
```

---

# Command Transport Abstraction

Do NOT tightly couple business logic to polling.

Create an abstraction conceptually similar to:

```text
CommandTransport
```

MVP implementation:

```text
PollingCommandTransport
```

Future implementations:

```text
WebSocketCommandTransport
MqttCommandTransport
RabbitMqCommandTransport
```

The command execution logic should not need to change when transport changes.

---

# Android App

Build using:

- Native Android
- Java
- Minimum SDK: choose a reasonable modern baseline
- Target latest stable Android SDK
- Retrofit or OkHttp
- WorkManager where appropriate
- Room for local persistence
- EncryptedSharedPreferences or a current supported secure storage approach for sensitive device credentials
- BroadcastReceiver where required
- Foreground Service only if genuinely required by Android background execution rules

Do NOT assume long-running background services will survive indefinitely.

Respect modern Android background restrictions.

---

# Android Architecture

Use:

```text
ui/
data/
network/
repository/
service/
worker/
command/
storage/
```

Suggested:

```text
com.example.gateway

├── ui
├── network
│   ├── ApiClient
│   └── GatewayApi
├── repository
│   └── GatewayRepository
├── storage
│   ├── SecureStorage
│   └── AppDatabase
├── worker
│   ├── HeartbeatWorker
│   └── CommandPollingWorker
├── command
│   ├── CommandExecutor
│   ├── CommandHandler
│   ├── DeviceStatusCommandHandler
│   ├── SyncCommandHandler
│   ├── UpdateConfigCommandHandler
│   └── SendSmsCommandHandler
└── model
```

---

# Android Command Execution

Use a handler pattern:

```text
CommandExecutor
       │
       ├── GET_DEVICE_STATUS
       ├── SYNC_NOW
       ├── UPDATE_CONFIG
       └── SEND_SMS
```

Example concept:

```java
interface CommandHandler {
    String getType();

    CommandResult execute(DeviceCommand command);
}
```

Do not place all command logic in one large if/else block.

Commands must be extensible.

---

# Offline Support

Android must handle network failures.

Use Room database for:

```text
pendingResults
failedResults
deviceConfiguration
```

Flow:

```text
Execute Command
      ↓
Need to send result
      ↓
Internet unavailable?
      ├── Yes → Save result locally
      └── No → Send immediately
                 ↓
              Success?
              ├── Yes → Done
              └── No → Save locally
```

WorkManager should retry sending pending results when network becomes available.

Use idempotency where appropriate.

A command result retry must not cause the command itself to execute repeatedly.

---

# Next.js Admin Dashboard

Create these pages.

## Dashboard

Display:

```text
Total Devices
Online Devices
Offline Devices
Pending Commands
Failed Commands
```

Recent:

- Device activity
- Command activity
- Errors

---

## Devices Page

Table:

```text
Device Name
Device ID
Model
Android Version
Status
Battery
Last Seen
Actions
```

Actions:

- View
- Edit
- Send Command
- Block Device

---

## Device Details

Sections:

```text
Overview
Device Information
Live Status
Recent Commands
Recent Logs
```

Command buttons:

```text
Get Status
Sync Now
Update Config
Send SMS
```

`SEND_SMS` should be clearly restricted according to authorized product use and Android policy.

---

## Commands Page

Display:

```text
Command ID
Device
Type
Status
Priority
Created At
Executed At
```

Filters:

- Device
- Type
- Status
- Date

---

## Logs Page

Display:

```text
Timestamp
Device
Level
Event
Message
```

---

# Security Requirements

Implement:

- Password hashing using bcrypt or Argon2
- JWT access tokens
- Refresh token strategy
- Separate admin and device authentication
- Organization-level data isolation
- Input validation using Zod
- Rate limiting where practical
- Enrollment tokens with expiration
- Device token hashing/storage strategy
- Token revocation
- Audit logging
- Do not expose secrets to the client
- Never trust organizationId from arbitrary client input without authorization checks
- Verify device ownership on every device request

---

# Response Format

Use a consistent API response format.

Success:

```json
{
  "success": true,
  "data": {},
  "message": "Success"
}
```

Error:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {}
}
```

Use appropriate HTTP status codes.

---

# MVP Out of Scope

Do NOT implement initially:

- RabbitMQ
- MQTT
- WebSocket
- Billing
- Push notifications
- Complex MDM/device owner features
- Remote APK installation
- Remote device locking
- Root functionality
- Hidden Android APIs
- Premium SMS confirmation bypass
- Security restriction bypasses

However, design the modules so these can be added later.

---

# Deliverables

Build the project step by step.

## Phase 1 — Foundation

1. Initialize Next.js project
2. Configure MongoDB + Mongoose
3. Create database models
4. Authentication
5. Organization + role authorization

## Phase 2 — Device Management

6. Device enrollment
7. Device authentication
8. Heartbeat
9. Device management APIs

## Phase 3 — Command System

10. Command model
11. Atomic command claiming
12. Command result API
13. Admin command creation

## Phase 4 — Android Gateway App

14. Android Java app
15. Enrollment
16. Secure device token storage
17. API client
18. Heartbeat worker
19. Command polling
20. Command handler architecture
21. Offline result queue

## Phase 5 — Next.js Admin Dashboard

22. Dashboard
23. Device list
24. Device details
25. Command management
26. Logs

## Phase 6 — Core Commands

27. Add `GET_DEVICE_STATUS`
28. Add `SYNC_NOW`
29. Add `UPDATE_CONFIG`
30. Add a policy-compliant `SEND_SMS` implementation

For every phase:

- Show the file structure
- Provide complete code for new or changed files
- Explain where each file belongs
- Do not skip important implementation details
- Do not use pseudo-code when real implementation can be provided
- Ensure TypeScript and Java code are consistent with each other
- Check for race conditions, especially command polling and command claiming

---

# MVP Definition

The MVP is complete when these core capabilities work end-to-end:

```text
Admin Login
    ↓
Create Enrollment Token
    ↓
Android Device Enrolls
    ↓
Device Appears in Dashboard
    ↓
Android Sends Heartbeat
    ↓
Admin Creates Command
    ↓
Android Polls and Atomically Claims Command
    ↓
Android Executes Command
    ↓
Android Returns Result
    ↓
Admin Sees Result and Logs
```

For the first release, prioritize:

1. `GET_DEVICE_STATUS`
2. `SYNC_NOW`
3. `UPDATE_CONFIG`

`SEND_SMS` may be included only where the deployment, permissions, carrier rules, user consent, and store policies permit it.

---

# Final Instruction

Start by designing the complete architecture and file structure.

Then implement the project phase by phase, beginning with **Phase 1**.

Do not skip to later phases until the current phase is complete and verified.

When implementation is requested, provide production-quality code rather than pseudo-code.
