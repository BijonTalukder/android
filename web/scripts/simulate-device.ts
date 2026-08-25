/**
 * Virtual gateway device.
 *
 * A faithful Node implementation of the same protocol the Android app speaks:
 * enroll -> heartbeat -> claim commands -> execute -> report result, including
 * the offline result queue and its retry behaviour. Use it to exercise the
 * backend and the dashboard end-to-end without building or flashing the APK.
 *
 *   npm run simulate -- --token ABCD-EFGH-IJKL          # first run: enroll
 *   npm run simulate                                    # later runs: reuse the saved token
 *   npm run simulate -- --name "Warehouse 01" --once    # one cycle, then exit
 *
 * State (the device API token and local config) is kept in
 * `.device-simulator/<name>.json`, mirroring EncryptedSharedPreferences on the
 * handset. Never commit that directory.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  const full = path.resolve(process.cwd(), file);
  if (existsSync(full)) {
    process.loadEnvFile(full);
    break;
  }
}

/* ---------------------------------------------------------------- */
/* CLI                                                               */
/* ---------------------------------------------------------------- */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const BASE = arg("base") ?? process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3100";
const NAME = arg("name") ?? "Virtual Gateway 01";
const ENROLLMENT_TOKEN = arg("token");
const ONCE = flag("once");

const STATE_DIR = path.resolve(process.cwd(), ".device-simulator");
const STATE_FILE = path.join(STATE_DIR, `${NAME.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`);

type State = {
  installationId: string;
  deviceApiToken: string | null;
  deviceId: string | null;
  config: { pollingIntervalSeconds: number; heartbeatIntervalSeconds: number };
  /** Results that could not be delivered; retried on every cycle. */
  pendingResults: Array<{ commandId: string; body: unknown; attempts: number }>;
};

function loadState(): State {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as State;
  }
  return {
    installationId: randomUUID(),
    deviceApiToken: null,
    deviceId: null,
    config: { pollingIntervalSeconds: 30, heartbeatIntervalSeconds: 60 },
    pendingResults: [],
  };
}

function saveState(state: State) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const state = loadState();

/* ---------------------------------------------------------------- */
/* Transport                                                         */
/* ---------------------------------------------------------------- */

type ApiResult<T> = { status: number; body: { success: boolean; data: T; message: string } };

async function call<T>(
  method: string,
  route: string,
  body?: unknown,
  auth = true,
): Promise<ApiResult<T>> {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth && state.deviceApiToken
        ? { authorization: `Bearer ${state.deviceApiToken}` }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : { success: false, data: null, message: "" },
  } as ApiResult<T>;
}

/* ---------------------------------------------------------------- */
/* Command handlers -- one per type, mirroring the Android package    */
/* ---------------------------------------------------------------- */

type Command = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  priority: string;
  claimId: string;
};

type Outcome =
  | { status: "SUCCESS"; result: Record<string, unknown> }
  | { status: "FAILED"; error: { code: string; message: string } };

const handlers: Record<string, (command: Command) => Promise<Outcome>> = {
  async GET_DEVICE_STATUS() {
    return {
      status: "SUCCESS",
      result: {
        batteryLevel: batteryLevel(),
        isCharging: true,
        networkType: "WIFI",
        appVersion: "1.0.0-simulator",
        timestamp: new Date().toISOString(),
      },
    };
  },

  async SYNC_NOW(command) {
    const scope = (command.payload.scope as string) ?? "ALL";
    return {
      status: "SUCCESS",
      result: { synced: true, scope, syncedAt: new Date().toISOString() },
    };
  },

  async UPDATE_CONFIG(command) {
    const polling = command.payload.pollingIntervalSeconds as number | undefined;
    const heartbeat = command.payload.heartbeatIntervalSeconds as number | undefined;
    if (polling !== undefined) state.config.pollingIntervalSeconds = polling;
    if (heartbeat !== undefined) state.config.heartbeatIntervalSeconds = heartbeat;
    saveState(state);
    return { status: "SUCCESS", result: { applied: true, config: state.config } };
  },

  async SEND_SMS(command) {
    const destination = String(command.payload.destination ?? "");
    const message = String(command.payload.message ?? "");
    if (!/^\+?[0-9]{6,15}$/.test(destination)) {
      return {
        status: "FAILED",
        error: { code: "INVALID_DESTINATION", message: "Destination is not a valid number" },
      };
    }
    // The real app checks the SEND_SMS runtime permission here and fails the
    // command when the user has not granted it. Nothing is actually sent.
    const segments = Math.max(1, Math.ceil(message.length / 153));
    return {
      status: "SUCCESS",
      result: { simulated: true, destination, segments, sentAt: new Date().toISOString() },
    };
  },
};

function batteryLevel() {
  // Drifts slowly so the dashboard shows something changing.
  return 40 + Math.round((Date.now() / 60_000) % 55);
}

/* ---------------------------------------------------------------- */
/* Lifecycle                                                         */
/* ---------------------------------------------------------------- */

async function enroll() {
  if (!ENROLLMENT_TOKEN) {
    throw new Error(
      "No device token stored yet. Create an enrollment token in the dashboard and " +
        "pass it: npm run simulate -- --token XXXX-XXXX-XXXX",
    );
  }

  const response = await call<{
    deviceApiToken: string;
    device: { id: string; deviceId: string };
    config: State["config"];
  }>(
    "POST",
    "/api/gateway/register",
    {
      enrollmentToken: ENROLLMENT_TOKEN,
      device: {
        installationId: state.installationId,
        deviceName: NAME,
        manufacturer: "Simulator",
        model: "Virtual Gateway",
        androidVersion: "15",
        sdkVersion: 35,
        appVersion: "1.0.0-simulator",
      },
    },
    false,
  );

  if (!response.body.success) {
    throw new Error(`Enrollment failed (${response.status}): ${response.body.message}`);
  }

  state.deviceApiToken = response.body.data.deviceApiToken;
  state.deviceId = response.body.data.device.deviceId;
  state.config = response.body.data.config;
  saveState(state);

  console.log(`Enrolled as ${state.deviceId} (${NAME})`);
}

async function heartbeat() {
  const response = await call<{ config: State["config"]; pendingCommands: number }>(
    "POST",
    "/api/gateway/heartbeat",
    { batteryLevel: batteryLevel(), isCharging: true, networkType: "WIFI" },
  );

  if (response.status === 401) throw new UnauthorizedDevice();
  if (!response.body.success) {
    console.warn(`  heartbeat rejected: ${response.body.message}`);
    return;
  }

  // The server is authoritative about configuration.
  state.config = response.body.data.config;
  saveState(state);
  console.log(
    `  heartbeat ok · ${response.body.data.pendingCommands} pending · ` +
      `poll ${state.config.pollingIntervalSeconds}s`,
  );
}

/** Retry anything the last cycle could not deliver, oldest first. */
async function flushPendingResults() {
  if (state.pendingResults.length === 0) return;
  console.log(`  flushing ${state.pendingResults.length} queued result(s)`);

  const remaining: State["pendingResults"] = [];
  for (const entry of state.pendingResults) {
    try {
      const response = await call(
        "POST",
        `/api/gateway/commands/${entry.commandId}/result`,
        entry.body,
      );
      // A 409 means the claim went stale; retrying can never succeed, so drop it.
      if (response.body.success || response.status === 409) continue;
      remaining.push({ ...entry, attempts: entry.attempts + 1 });
    } catch {
      remaining.push({ ...entry, attempts: entry.attempts + 1 });
    }
  }
  state.pendingResults = remaining.filter((entry) => entry.attempts < 20);
  saveState(state);
}

async function pollAndExecute() {
  const response = await call<{ commands: Command[] }>(
    "GET",
    "/api/gateway/commands?limit=10",
  );

  if (response.status === 401) throw new UnauthorizedDevice();
  if (!response.body.success) {
    console.warn(`  poll rejected: ${response.body.message}`);
    return;
  }

  const commands = response.body.data.commands;
  if (commands.length === 0) {
    console.log("  no pending commands");
    return;
  }

  for (const command of commands) {
    console.log(`  executing ${command.type} (${command.id})`);
    const handler = handlers[command.type];

    const outcome: Outcome = handler
      ? await handler(command).catch((error) => ({
          status: "FAILED" as const,
          error: { code: "HANDLER_ERROR", message: String(error) },
        }))
      : {
          status: "FAILED",
          // Forward compatibility: an unknown type is reported, not swallowed.
          error: {
            code: "UNSUPPORTED_COMMAND",
            message: `This app version cannot execute ${command.type}`,
          },
        };

    const body = { ...outcome, claimId: command.claimId };

    try {
      const result = await call(
        "POST",
        `/api/gateway/commands/${command.id}/result`,
        body,
      );
      if (!result.body.success && result.status !== 409) {
        throw new Error(result.body.message);
      }
      console.log(`    -> ${outcome.status}`);
    } catch (error) {
      // Offline queue: the command has already run, so only the *result*
      // is retried. Re-execution never happens.
      console.log(`    -> could not report result, queued locally (${String(error)})`);
      state.pendingResults.push({ commandId: command.id, body, attempts: 1 });
      saveState(state);
    }
  }
}

class UnauthorizedDevice extends Error {
  constructor() {
    super("Device token rejected. Re-enroll with a fresh enrollment token.");
  }
}

async function cycle() {
  await flushPendingResults();
  await heartbeat();
  await pollAndExecute();
}

async function main() {
  console.log(`Virtual gateway "${NAME}" against ${BASE}`);
  console.log(`State file: ${STATE_FILE}\n`);

  if (!state.deviceApiToken || ENROLLMENT_TOKEN) await enroll();

  await cycle();
  if (ONCE) return;

  console.log("\nRunning. Press Ctrl+C to stop.\n");
  for (;;) {
    await new Promise((resolve) =>
      setTimeout(resolve, state.config.pollingIntervalSeconds * 1000),
    );
    try {
      await cycle();
    } catch (error) {
      if (error instanceof UnauthorizedDevice) {
        console.error(`\n${error.message}`);
        process.exitCode = 1;
        return;
      }
      console.warn(`  cycle failed: ${String(error)}`);
    }
  }
}

main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
