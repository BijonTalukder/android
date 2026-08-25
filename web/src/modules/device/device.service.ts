/**
 * Device lifecycle and administration (admin-facing).
 *
 * Enrollment itself lives in `modules/gateway` because it is authenticated by
 * an enrollment code rather than a user session; this module owns everything an
 * administrator does to a device afterwards.
 */
import { Types } from "mongoose";
import { NotFoundError } from "@/lib/errors";
import { env } from "@/lib/env";
import { generateEnrollmentCode, randomId, sha256 } from "@/lib/crypto";
import { toPaginated } from "@/lib/pagination";
import { Device } from "@/models/Device";
import { DeviceCommand } from "@/models/DeviceCommand";
import { DeviceLog } from "@/models/DeviceLog";
import { EnrollmentToken } from "@/models/EnrollmentToken";
import type { AuthContext } from "@/lib/auth";
import {
  requireOrgAdmin,
  resolveOrganizationScope,
  resolveWriteOrganization,
  toObjectId,
} from "@/middleware/role.middleware";
import { AuditLogService } from "@/modules/audit-log";
import { OrganizationService } from "@/modules/organization";
import { COMMAND_STATUS } from "@/types";
import { toDeviceDto, type DeviceDto } from "./device.dto";
import { sweepStaleDevices } from "./device.presence";
import type {
  CreateEnrollmentTokenInput,
  ListDeviceLogsQuery,
  ListDevicesQuery,
  ListLogsQuery,
  UpdateDeviceInput,
} from "./device.schema";

export type EnrollmentTokenDto = {
  id: string;
  organizationId: string;
  /** Only returned once, at creation time. */
  token?: string;
  tokenPreview: string;
  deviceNameHint: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

/** A public device id that is short enough to read aloud but still unguessable. */
async function generateDeviceId(organizationId: Types.ObjectId): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `DEV-${randomId(4).toUpperCase()}`;
    if (!(await Device.exists({ organizationId, deviceId: candidate }))) return candidate;
  }
  return `DEV-${randomId(8).toUpperCase()}`;
}

export const DeviceService = {
  generateDeviceId,

  async list(ctx: AuthContext, query: ListDevicesQuery) {
    const scope = resolveOrganizationScope(ctx, query.organizationId);
    await sweepStaleDevices(scope.organizationId ?? null);

    const filter: Record<string, unknown> = { ...scope };
    if (query.status) filter.status = query.status;
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ deviceName: rx }, { deviceId: rx }, { model: rx }, { manufacturer: rx }];
    }

    const direction = query.order === "asc" ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [query.sort]: direction, _id: -1 };

    const [devices, total] = await Promise.all([
      Device.find(filter)
        .sort(sort)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Device.countDocuments(filter),
    ]);

    return toPaginated(devices.map(toDeviceDto), total, query);
  },

  /**
   * Load a device the caller is entitled to see. Every device-scoped operation
   * in the platform funnels through here, which is what makes "verify device
   * ownership on every request" a single enforceable rule.
   */
  async findInScope(ctx: AuthContext, id: string) {
    const deviceObjectId = toObjectId(id, "id");
    const filter: Record<string, unknown> = { _id: deviceObjectId };
    const scope = resolveOrganizationScope(ctx);
    if (scope.organizationId) filter.organizationId = scope.organizationId;

    const device = await Device.findOne(filter).lean();
    if (!device) throw new NotFoundError("Device");
    return device;
  },

  async getById(ctx: AuthContext, id: string): Promise<DeviceDto> {
    const scope = resolveOrganizationScope(ctx);
    await sweepStaleDevices(scope.organizationId ?? null);
    return toDeviceDto(await this.findInScope(ctx, id));
  },

  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateDeviceInput,
    meta: { ip?: string | null } = {},
  ): Promise<DeviceDto> {
    requireOrgAdmin(ctx);
    const device = await this.findInScope(ctx, id);

    const update: Record<string, unknown> = {};
    if (input.deviceName !== undefined) update.deviceName = input.deviceName;
    if (input.config?.pollingIntervalSeconds !== undefined) {
      update["config.pollingIntervalSeconds"] = input.config.pollingIntervalSeconds;
    }
    if (input.config?.heartbeatIntervalSeconds !== undefined) {
      update["config.heartbeatIntervalSeconds"] = input.config.heartbeatIntervalSeconds;
    }

    if (input.status !== undefined) {
      update.status = input.status;
      if (input.status === "BLOCKED") {
        update.blockedAt = new Date();
        update.blockedReason = input.blockedReason ?? null;
      } else {
        update.blockedAt = null;
        update.blockedReason = null;
      }
    }

    const updated = await Device.findByIdAndUpdate(
      device._id,
      { $set: update },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!updated) throw new NotFoundError("Device");

    // Blocking must take effect immediately: drop anything still queued.
    if (input.status === "BLOCKED") {
      await DeviceCommand.updateMany(
        {
          deviceId: device._id,
          status: { $in: [COMMAND_STATUS.PENDING, COMMAND_STATUS.DELIVERED] },
        },
        {
          $set: {
            status: COMMAND_STATUS.EXPIRED,
            error: { code: "DEVICE_BLOCKED", message: "Device was blocked" },
          },
        },
      );
    }

    void AuditLogService.record({
      organizationId: device.organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: input.status === "BLOCKED" ? "device.block" : "device.update",
      targetType: "Device",
      targetId: device._id,
      metadata: { changes: update },
      ip: meta.ip,
    });

    return toDeviceDto(updated);
  },

  async remove(ctx: AuthContext, id: string, meta: { ip?: string | null } = {}): Promise<void> {
    requireOrgAdmin(ctx);
    const device = await this.findInScope(ctx, id);

    // Cascade: an orphaned command or log would leak into no tenant's view.
    await Promise.all([
      DeviceCommand.deleteMany({ deviceId: device._id }),
      DeviceLog.deleteMany({ deviceId: device._id }),
    ]);
    await Device.deleteOne({ _id: device._id });

    void AuditLogService.record({
      organizationId: device.organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: "device.delete",
      targetType: "Device",
      targetId: device._id,
      metadata: { deviceId: device.deviceId, deviceName: device.deviceName },
      ip: meta.ip,
    });
  },

  /**
   * Invalidate the device's API token. The device must re-enroll with a new
   * enrollment code, which is the intended behaviour for a lost or
   * compromised handset.
   */
  async revokeToken(
    ctx: AuthContext,
    id: string,
    meta: { ip?: string | null } = {},
  ): Promise<DeviceDto> {
    requireOrgAdmin(ctx);
    const device = await this.findInScope(ctx, id);

    const updated = await Device.findByIdAndUpdate(
      device._id,
      {
        $set: {
          tokenId: null,
          tokenHash: null,
          tokenIssuedAt: null,
          status: "INACTIVE",
        },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: "after" },
    ).lean();

    void AuditLogService.record({
      organizationId: device.organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: "device.token_revoke",
      targetType: "Device",
      targetId: device._id,
      ip: meta.ip,
    });

    return toDeviceDto(updated!);
  },

  async createEnrollmentToken(
    ctx: AuthContext,
    input: CreateEnrollmentTokenInput,
    meta: { ip?: string | null } = {},
  ): Promise<EnrollmentTokenDto> {
    requireOrgAdmin(ctx);
    const organizationId = resolveWriteOrganization(ctx, input.organizationId);

    const code = generateEnrollmentCode();
    const ttl = input.expiresInSeconds ?? env().ENROLLMENT_TOKEN_TTL_SECONDS;

    const token = await EnrollmentToken.create({
      organizationId,
      tokenHash: sha256(code),
      tokenPreview: code.slice(0, 4),
      deviceNameHint: input.deviceNameHint ?? null,
      maxUses: input.maxUses,
      usedCount: 0,
      expiresAt: new Date(Date.now() + ttl * 1000),
      createdBy: new Types.ObjectId(ctx.userId),
    });

    void AuditLogService.record({
      organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: "device.enrollment_token.create",
      targetType: "EnrollmentToken",
      targetId: token._id,
      metadata: { maxUses: input.maxUses, expiresInSeconds: ttl },
      ip: meta.ip,
    });

    // The plaintext code is returned exactly once, here.
    return { ...toEnrollmentTokenDto(token), token: code };
  },

  async listEnrollmentTokens(ctx: AuthContext, organizationId?: string) {
    requireOrgAdmin(ctx);
    const scope = resolveOrganizationScope(ctx, organizationId);
    const tokens = await EnrollmentToken.find({ ...scope })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return tokens.map(toEnrollmentTokenDto);
  },

  async revokeEnrollmentToken(
    ctx: AuthContext,
    id: string,
    meta: { ip?: string | null } = {},
  ): Promise<void> {
    requireOrgAdmin(ctx);
    const scope = resolveOrganizationScope(ctx);
    const filter: Record<string, unknown> = { _id: toObjectId(id, "id") };
    if (scope.organizationId) filter.organizationId = scope.organizationId;

    const token = await EnrollmentToken.findOneAndUpdate(
      filter,
      { $set: { revokedAt: new Date() } },
      { returnDocument: "after" },
    ).lean();
    if (!token) throw new NotFoundError("Enrollment token");

    void AuditLogService.record({
      organizationId: token.organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: "device.enrollment_token.revoke",
      targetType: "EnrollmentToken",
      targetId: token._id,
      ip: meta.ip,
    });
  },

  async listDeviceLogs(ctx: AuthContext, deviceId: string, query: ListDeviceLogsQuery) {
    const device = await this.findInScope(ctx, deviceId);

    const filter: Record<string, unknown> = {
      organizationId: device.organizationId,
      deviceId: device._id,
    };
    if (query.level) filter.level = query.level;
    if (query.event) filter.event = query.event;
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }

    const [logs, total] = await Promise.all([
      DeviceLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      DeviceLog.countDocuments(filter),
    ]);

    return toPaginated(
      logs.map((log) => ({
        id: String(log._id),
        deviceId: String(log.deviceId),
        deviceName: device.deviceName,
        devicePublicId: device.deviceId,
        level: log.level,
        event: log.event,
        message: log.message,
        metadata: log.metadata ?? null,
        createdAt: log.createdAt.toISOString(),
      })),
      total,
      query,
    );
  },

  /** Organization-wide log feed backing the Logs page. */
  async listLogs(ctx: AuthContext, query: ListLogsQuery) {
    const scope = resolveOrganizationScope(ctx, query.organizationId);
    const filter: Record<string, unknown> = { ...scope };

    if (query.deviceId) {
      const device = await this.findInScope(ctx, query.deviceId);
      filter.deviceId = device._id;
      filter.organizationId = device.organizationId;
    }
    if (query.level) filter.level = query.level;
    if (query.event) filter.event = query.event;
    if (query.search) {
      filter.message = new RegExp(
        query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    }
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }

    const [logs, total] = await Promise.all([
      DeviceLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      DeviceLog.countDocuments(filter),
    ]);

    const devices = await Device.find({
      _id: { $in: [...new Set(logs.map((l) => String(l.deviceId)))] },
    })
      .select({ deviceId: 1, deviceName: 1 })
      .lean();
    const deviceMap = new Map(devices.map((d) => [String(d._id), d]));

    return toPaginated(
      logs.map((log) => {
        const device = deviceMap.get(String(log.deviceId));
        return {
          id: String(log._id),
          deviceId: String(log.deviceId),
          deviceName: device?.deviceName ?? null,
          devicePublicId: device?.deviceId ?? null,
          level: log.level,
          event: log.event,
          message: log.message,
          metadata: log.metadata ?? null,
          createdAt: log.createdAt.toISOString(),
        };
      }),
      total,
      query,
    );
  },

  /** Default device config for a newly enrolled device in this organization. */
  async defaultConfigFor(organizationId: Types.ObjectId) {
    const settings = await OrganizationService.getEffectiveSettings(organizationId);
    return {
      pollingIntervalSeconds: settings.pollingIntervalSeconds,
      heartbeatIntervalSeconds: settings.heartbeatIntervalSeconds,
    };
  },
};

function toEnrollmentTokenDto(token: {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  tokenPreview: string;
  deviceNameHint: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}): EnrollmentTokenDto {
  return {
    id: String(token._id),
    organizationId: String(token.organizationId),
    tokenPreview: `${token.tokenPreview}-****-****`,
    deviceNameHint: token.deviceNameHint,
    maxUses: token.maxUses,
    usedCount: token.usedCount,
    expiresAt: token.expiresAt.toISOString(),
    revokedAt: token.revokedAt ? token.revokedAt.toISOString() : null,
    lastUsedAt: token.lastUsedAt ? token.lastUsedAt.toISOString() : null,
    createdAt: token.createdAt.toISOString(),
  };
}

