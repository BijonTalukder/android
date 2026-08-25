/* eslint-disable @typescript-eslint/no-explicit-any --
 * This is a black-box test client: it asserts against raw JSON envelopes from
 * the API on purpose, so it must not import the app's own types. Typing every
 * probe would couple the test to the implementation it is checking. */
/**
 * End-to-end MVP verification against a running server.
 *
 *   npm run dev            # in one terminal
 *   npm run smoke          # in another
 *
 * Walks the full happy path from the MVP definition and then probes the
 * security and concurrency properties the design claims:
 *   - a command is claimed by exactly one concurrent poll
 *   - result submission is idempotent
 *   - a device token cannot reach an admin route
 *   - one tenant cannot see another tenant's device
 *   - a member cannot queue commands
 *   - SEND_SMS is refused while the switch is off
 */
import { existsSync } from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  const full = path.resolve(process.cwd(), file);
  if (existsSync(full)) {
    process.loadEnvFile(full);
    break;
  }
}

const BASE = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3100";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${label}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${label}`);
    if (detail !== undefined) console.log("        ", JSON.stringify(detail, null, 2));
  }
}

/** Minimal cookie-jar fetch so the admin session behaves like a browser. */
class Client {
  private cookies = new Map<string, string>();

  constructor(private readonly base = BASE) {}

  private cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorb(response: Response) {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      if (idx === -1) continue;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
  }

  async request<T = any>(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(`${this.base}${url}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.cookies.size ? { cookie: this.cookieHeader() } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    this.absorb(response);
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return { status: response.status, body: parsed as T };
  }

  get = <T = any>(url: string, headers?: Record<string, string>) =>
    this.request<T>("GET", url, undefined, headers);
  post = <T = any>(url: string, body?: unknown, headers?: Record<string, string>) =>
    this.request<T>("POST", url, body, headers);
  patch = <T = any>(url: string, body?: unknown, headers?: Record<string, string>) =>
    this.request<T>("PATCH", url, body, headers);
  del = <T = any>(url: string, headers?: Record<string, string>) =>
    this.request<T>("DELETE", url, undefined, headers);
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function main() {
  console.log(`\nSmoke test against ${BASE}\n`);

  /* --- health ---------------------------------------------------------- */
  const anon = new Client();
  const health = await anon.get("/api/health");
  check("health endpoint reports ok", health.status === 200 && health.body.data?.status === "ok", health.body);

  /* --- admin login ----------------------------------------------------- */
  const admin = new Client();
  const login = await admin.post("/api/auth/login", {
    email: process.env.SEED_ORG_ADMIN_EMAIL ?? "admin@acme.test",
    password: process.env.SEED_ORG_ADMIN_PASSWORD ?? "OrgAdmin123!",
  });
  check("organization admin can sign in", login.status === 200 && login.body.success, login.body);

  const me = await admin.get("/api/auth/me");
  check("session resolves to the org admin", me.body.data?.user?.role === "ORGANIZATION_ADMIN", me.body);
  const organizationId: string = me.body.data?.user?.organizationId;

  const badLogin = await new Client().post("/api/auth/login", {
    email: process.env.SEED_ORG_ADMIN_EMAIL ?? "admin@acme.test",
    password: "definitely-wrong",
  });
  check("wrong password is rejected", badLogin.status === 401, badLogin.body);

  const anonDevices = await anon.get("/api/devices");
  check("unauthenticated device list is rejected", anonDevices.status === 401, anonDevices.body);

  /* --- enrollment ------------------------------------------------------ */
  const tokenResponse = await admin.post("/api/devices/enrollment-token", {
    deviceNameHint: "Smoke Test Gateway",
    maxUses: 1,
  });
  check("enrollment token created", tokenResponse.status === 201 && Boolean(tokenResponse.body.data?.token), tokenResponse.body);
  const enrollmentToken: string = tokenResponse.body.data.token;

  const installationId = `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const enroll = await anon.post("/api/gateway/register", {
    enrollmentToken,
    device: {
      installationId,
      deviceName: "Smoke Test Gateway",
      manufacturer: "Google",
      model: "Pixel 8",
      androidVersion: "15",
      sdkVersion: 35,
      appVersion: "1.0.0",
    },
  });
  check("device enrolls with a valid token", enroll.status === 201 && Boolean(enroll.body.data?.deviceApiToken), enroll.body);

  const deviceToken: string = enroll.body.data.deviceApiToken;
  const deviceObjectId: string = enroll.body.data.device.id;
  const devicePublicId: string = enroll.body.data.device.deviceId;

  const reuse = await anon.post("/api/gateway/register", {
    enrollmentToken,
    device: { installationId: `${installationId}-other`, deviceName: "Should Fail" },
  });
  check("single-use enrollment token cannot be reused", reuse.status === 401, reuse.body);

  const badToken = await anon.post("/api/gateway/register", {
    enrollmentToken: "ZZZZ-ZZZZ-ZZZZ",
    device: { installationId: `${installationId}-bad`, deviceName: "Should Fail" },
  });
  check("unknown enrollment token is rejected", badToken.status === 401, badToken.body);

  /* --- heartbeat ------------------------------------------------------- */
  const heartbeat = await anon.post(
    "/api/gateway/heartbeat",
    { batteryLevel: 85, isCharging: true, networkType: "WIFI" },
    bearer(deviceToken),
  );
  check("heartbeat accepted", heartbeat.status === 200 && heartbeat.body.data?.status === "ONLINE", heartbeat.body);
  check(
    "heartbeat returns device configuration",
    typeof heartbeat.body.data?.config?.pollingIntervalSeconds === "number",
    heartbeat.body,
  );

  const noAuthHeartbeat = await anon.post("/api/gateway/heartbeat", { batteryLevel: 10 });
  check("heartbeat without a device token is rejected", noAuthHeartbeat.status === 401, noAuthHeartbeat.body);

  const forgedHeartbeat = await anon.post(
    "/api/gateway/heartbeat",
    { batteryLevel: 10 },
    bearer("adgd_aaaaaaaaaaaaaaaaaaaaaaaa_forged"),
  );
  check("forged device token is rejected", forgedHeartbeat.status === 401, forgedHeartbeat.body);

  /* --- device visible to the admin ------------------------------------- */
  const devices = await admin.get(`/api/devices?search=${devicePublicId}`);
  const listed = devices.body.data?.items?.[0];
  check("device appears in the dashboard list", listed?.id === deviceObjectId && listed?.status === "ONLINE", devices.body);
  check("device list never leaks the token", !JSON.stringify(devices.body).includes("tokenHash"), devices.body);

  /* --- device token must not reach admin routes ------------------------ */
  const crossAuth = await anon.get("/api/devices", bearer(deviceToken));
  check("device token cannot call an admin route", crossAuth.status === 401, crossAuth.body);

  /* --- command creation and atomic claim ------------------------------- */
  const command = await admin.post(`/api/devices/${deviceObjectId}/commands`, {
    type: "GET_DEVICE_STATUS",
    payload: {},
    priority: "HIGH",
  });
  check("command queued", command.status === 201 && command.body.data?.status === "PENDING", command.body);
  const commandId: string = command.body.data.id;

  // Six simultaneous polls; MongoDB's atomic claim must give the command to
  // exactly one of them.
  const polls = await Promise.all(
    Array.from({ length: 6 }, () => anon.get("/api/gateway/commands?limit=10", bearer(deviceToken))),
  );
  const claims = polls.flatMap((p) => p.body.data?.commands ?? []).filter((c: any) => c.id === commandId);
  check(`command claimed exactly once under 6 concurrent polls (got ${claims.length})`, claims.length === 1, {
    claims,
  });

  const claim = claims[0];
  check("claimed command carries a claim id", typeof claim?.claimId === "string" && claim.claimId.length > 0, claim);

  const afterClaim = await admin.get(`/api/commands/${commandId}`);
  check("claimed command is DELIVERED", afterClaim.body.data?.status === "DELIVERED", afterClaim.body);

  /* --- result submission ----------------------------------------------- */
  const resultBody = {
    status: "SUCCESS",
    claimId: claim.claimId,
    result: { batteryLevel: 85, isCharging: true, networkType: "WIFI", appVersion: "1.0.0" },
  };
  const result = await anon.post(
    `/api/gateway/commands/${commandId}/result`,
    resultBody,
    bearer(deviceToken),
  );
  check("result accepted", result.status === 200 && result.body.data?.command?.status === "SUCCESS", result.body);
  check("first submission is not flagged idempotent", result.body.data?.idempotent === false, result.body);

  const retry = await anon.post(
    `/api/gateway/commands/${commandId}/result`,
    resultBody,
    bearer(deviceToken),
  );
  check("retried result is idempotent", retry.status === 200 && retry.body.data?.idempotent === true, retry.body);

  const stale = await anon.post(
    `/api/gateway/commands/${commandId}/result`,
    { status: "FAILED", claimId: "stale-claim", error: { code: "X", message: "y" } },
    bearer(deviceToken),
  );
  check("a finished command keeps its result", stale.body.data?.command?.status === "SUCCESS", stale.body);

  const finalCommand = await admin.get(`/api/commands/${commandId}`);
  check(
    "admin sees the reported result",
    finalCommand.body.data?.result?.batteryLevel === 85,
    finalCommand.body,
  );

  /* --- UPDATE_CONFIG round trip ---------------------------------------- */
  const configCommand = await admin.post(`/api/devices/${deviceObjectId}/commands`, {
    type: "UPDATE_CONFIG",
    payload: { pollingIntervalSeconds: 45, heartbeatIntervalSeconds: 90 },
  });
  check("UPDATE_CONFIG accepted", configCommand.status === 201, configCommand.body);

  // A confirmed UPDATE_CONFIG must stick: the server's copy of the device
  // configuration has to follow, or the next heartbeat silently reverts it.
  const configCommandId: string = configCommand.body.data.id;
  const configPoll = await anon.get("/api/gateway/commands?limit=5", bearer(deviceToken));
  const configClaim = (configPoll.body.data?.commands ?? []).find(
    (c: any) => c.id === configCommandId,
  );
  check("UPDATE_CONFIG is delivered to the device", Boolean(configClaim), configPoll.body);

  await anon.post(
    `/api/gateway/commands/${configCommandId}/result`,
    {
      status: "SUCCESS",
      claimId: configClaim?.claimId,
      result: { applied: true, pollingIntervalSeconds: 45, heartbeatIntervalSeconds: 90 },
    },
    bearer(deviceToken),
  );

  const afterConfig = await admin.get(`/api/devices/${deviceObjectId}`);
  check(
    "a confirmed UPDATE_CONFIG updates the device on the server",
    afterConfig.body.data?.config?.pollingIntervalSeconds === 45 &&
      afterConfig.body.data?.config?.heartbeatIntervalSeconds === 90,
    afterConfig.body,
  );

  const configHeartbeat = await anon.post(
    "/api/gateway/heartbeat",
    { batteryLevel: 80 },
    bearer(deviceToken),
  );
  check(
    "the next heartbeat returns the new configuration rather than reverting it",
    configHeartbeat.body.data?.config?.pollingIntervalSeconds === 45,
    configHeartbeat.body,
  );

  const badConfig = await admin.post(`/api/devices/${deviceObjectId}/commands`, {
    type: "UPDATE_CONFIG",
    payload: { pollingIntervalSeconds: 1 },
  });
  check("out-of-range config payload is rejected", badConfig.status === 422, badConfig.body);

  const badType = await admin.post(`/api/devices/${deviceObjectId}/commands`, {
    type: "NOT_A_COMMAND",
    payload: {},
  });
  check("unknown command type is rejected", badType.status === 422, badType.body);

  /* --- SEND_SMS gate ---------------------------------------------------- */
  const sms = await admin.post(`/api/devices/${deviceObjectId}/commands`, {
    type: "SEND_SMS",
    payload: { destination: "+8801712345678", message: "hello" },
  });
  check("SEND_SMS refused while the platform switch is off", sms.status === 403, sms.body);

  /* --- logs ------------------------------------------------------------- */
  const logs = await admin.get(`/api/devices/${deviceObjectId}/logs`);
  const events = (logs.body.data?.items ?? []).map((l: any) => l.event);
  check("device logs record enrollment", events.includes("device.enrolled"), events);
  check("device logs record command completion", events.includes("command.success"), events);

  /* --- dashboard -------------------------------------------------------- */
  const summary = await admin.get("/api/dashboard/summary");
  check("dashboard summary loads", summary.status === 200 && summary.body.data?.devices?.total >= 1, summary.body);

  /* --- role restrictions ------------------------------------------------ */
  const member = new Client();
  await member.post("/api/auth/login", {
    email: process.env.SEED_ORG_MEMBER_EMAIL ?? "member@acme.test",
    password: process.env.SEED_ORG_MEMBER_PASSWORD ?? "OrgMember123!",
  });
  const memberList = await member.get("/api/devices");
  check("member can read devices", memberList.status === 200, memberList.body);

  const memberCommand = await member.post(`/api/devices/${deviceObjectId}/commands`, {
    type: "SYNC_NOW",
    payload: {},
  });
  check("member cannot queue commands", memberCommand.status === 403, memberCommand.body);

  const memberToken = await member.post("/api/devices/enrollment-token", { maxUses: 1 });
  check("member cannot mint enrollment tokens", memberToken.status === 403, memberToken.body);

  /* --- tenant isolation -------------------------------------------------- */
  const superAdmin = new Client();
  const superLogin = await superAdmin.post("/api/auth/login", {
    email: process.env.SEED_SUPER_ADMIN_EMAIL ?? "superadmin@example.com",
    password: process.env.SEED_SUPER_ADMIN_PASSWORD ?? "SuperAdmin123!",
  });
  check("super admin can sign in", superLogin.status === 200, superLogin.body);

  const otherOrgSlug = `smoke-tenant-${Date.now().toString(36)}`;
  const otherAdminEmail = `${otherOrgSlug}@example.test`;
  const otherOrg = await superAdmin.post("/api/organizations", {
    name: `Smoke Tenant ${otherOrgSlug}`,
    slug: otherOrgSlug,
    admin: { name: "Other Admin", email: otherAdminEmail, password: "OtherAdmin123!" },
  });
  check("super admin can create an organization", otherOrg.status === 201, otherOrg.body);

  const other = new Client();
  await other.post("/api/auth/login", { email: otherAdminEmail, password: "OtherAdmin123!" });

  const crossRead = await other.get(`/api/devices/${deviceObjectId}`);
  check("another tenant cannot read the device", crossRead.status === 404, crossRead.body);

  const crossCommand = await other.post(`/api/devices/${deviceObjectId}/commands`, {
    type: "SYNC_NOW",
    payload: {},
  });
  check("another tenant cannot command the device", crossCommand.status === 404, crossCommand.body);

  const crossList = await other.get("/api/devices");
  check(
    "another tenant's device list is empty",
    (crossList.body.data?.items ?? []).length === 0,
    crossList.body,
  );

  const forgedScope = await other.get(`/api/devices?organizationId=${organizationId}`);
  check("organizationId cannot be forged in a query", forgedScope.status === 403, forgedScope.body);

  const orgCreateByTenant = await admin.post("/api/organizations", { name: "Nope" });
  check("org admin cannot create organizations", orgCreateByTenant.status === 403, orgCreateByTenant.body);

  const superSeesDevice = await superAdmin.get(`/api/devices/${deviceObjectId}`);
  check("super admin can read any device", superSeesDevice.status === 200, superSeesDevice.body);

  /* --- blocking ---------------------------------------------------------- */
  const pendingBeforeBlock = await admin.post(`/api/devices/${deviceObjectId}/commands`, {
    type: "SYNC_NOW",
    payload: {},
  });
  check("SYNC_NOW queued before blocking", pendingBeforeBlock.status === 201, pendingBeforeBlock.body);

  const block = await admin.patch(`/api/devices/${deviceObjectId}`, {
    status: "BLOCKED",
    blockedReason: "Smoke test",
  });
  check("device can be blocked", block.body.data?.status === "BLOCKED", block.body);

  const blockedPoll = await anon.get("/api/gateway/commands", bearer(deviceToken));
  check("a blocked device cannot poll", blockedPoll.status === 403, blockedPoll.body);

  const blockedCommand = await admin.post(`/api/devices/${deviceObjectId}/commands`, {
    type: "SYNC_NOW",
    payload: {},
  });
  check("a blocked device cannot be commanded", blockedCommand.status === 409, blockedCommand.body);

  const unblock = await admin.patch(`/api/devices/${deviceObjectId}`, { status: "OFFLINE" });
  check("device can be unblocked", unblock.body.data?.status === "OFFLINE", unblock.body);

  /* --- token rotation ----------------------------------------------------- */
  const revoked = await admin.post(`/api/devices/${deviceObjectId}/revoke-token`);
  check("device token can be revoked", revoked.status === 200, revoked.body);

  const afterRevoke = await anon.post(
    "/api/gateway/heartbeat",
    { batteryLevel: 50 },
    bearer(deviceToken),
  );
  check("revoked device token stops working", afterRevoke.status === 401, afterRevoke.body);

  /* --- refresh & logout ---------------------------------------------------- */
  const refreshed = await admin.post("/api/auth/refresh");
  check("session can be refreshed", refreshed.status === 200, refreshed.body);

  const afterRefresh = await admin.get("/api/auth/me");
  check("rotated session still works", afterRefresh.status === 200, afterRefresh.body);

  const logout = await admin.post("/api/auth/logout");
  check("logout succeeds", logout.status === 200, logout.body);

  const afterLogout = await admin.get("/api/devices");
  check("session is dead after logout", afterLogout.status === 401, afterLogout.body);

  /* --- cleanup -------------------------------------------------------------- */
  const cleanup = new Client();
  await cleanup.post("/api/auth/login", {
    email: process.env.SEED_ORG_ADMIN_EMAIL ?? "admin@acme.test",
    password: process.env.SEED_ORG_ADMIN_PASSWORD ?? "OrgAdmin123!",
  });
  const removed = await cleanup.del(`/api/devices/${deviceObjectId}`);
  check("device can be deleted", removed.status === 200, removed.body);

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nSmoke test crashed:", error);
  process.exitCode = 1;
});
