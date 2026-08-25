/**
 * Everything the Android gateway app talks to: enrollment, heartbeat, command
 * pull, result submission.
 *
 * Enrollment is the only gateway operation that is not authenticated by a
 * device token -- it is authenticated by a short-lived, admin-issued
 * enrollment code, and its output *is* the device token.
 */
import { Types } from "mongoose";
import { ConflictError, ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { generateDeviceToken, normalizeEnrollmentCode, sha256 } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { Device } from "@/models/Device";
import { EnrollmentToken } from "@/models/EnrollmentToken";
import { Organization } from "@/models/Organization";
import { DeviceCommand } from "@/models/DeviceCommand";
import { AuditLogService } from "@/modules/audit-log";
import { CommandService } from "@/modules/command/command.service";
import { DeviceService } from "@/modules/device/device.service";
import { DeviceLogService } from "@/modules/device/device-log.service";
import { OrganizationService } from "@/modules/organization";
import { toDeviceDto, type DeviceDto } from "@/modules/device/device.dto";
import { COMMAND_STATUS } from "@/types";
import type { DeviceAuthContext } from "./device-auth";
import type { HeartbeatInput, RegisterDeviceInput } from "./gateway.schema";

export type RegisterDeviceResult = {
  /** Returned exactly once. The server keeps only a hash. */
  deviceApiToken: string;
  device: DeviceDto;
  config: { pollingIntervalSeconds: number; heartbeatIntervalSeconds: number };
  serverTime: string;
};

export type HeartbeatResult = {
  serverTime: string;
  config: { pollingIntervalSeconds: number; heartbeatIntervalSeconds: number };
  pendingCommands: number;
  status: string;
};

export const GatewayService = {
  async register(
    input: RegisterDeviceInput,
    meta: { ip?: string | null } = {},
  ): Promise<RegisterDeviceResult> {
    const code = normalizeEnrollmentCode(input.enrollmentToken);
    const tokenHash = sha256(code);
    const now = new Date();

    const enrollment = await EnrollmentToken.findOne({ tokenHash }).lean();
    // One message for every failure mode so the endpoint cannot be used to
    // probe which codes exist.
    const rejected = new UnauthorizedError(
      "Invalid or expired enrollment token",
      "ENROLLMENT_TOKEN_INVALID",
    );
    if (!enrollment) throw rejected;
    if (enrollment.revokedAt) throw rejected;
    if (enrollment.expiresAt.getTime() <= now.getTime()) throw rejected;

    const organization = await Organization.findById(enrollment.organizationId)
      .select({ status: 1, settings: 1 })
      .lean();
    if (!organization) throw rejected;
    if (organization.status !== "ACTIVE") {
      throw new ForbiddenError("This organization is suspended");
    }

    const organizationId = enrollment.organizationId;
    const defaults = await DeviceService.defaultConfigFor(organizationId);

    // Re-enrollment of a handset we already know: rotate its token instead of
    // creating a duplicate, and do not spend one of the code's uses.
    const existing = await Device.findOne({
      organizationId,
      installationId: input.device.installationId,
    }).lean();

    if (existing) {
      if (existing.status === "BLOCKED") {
        throw new ForbiddenError("This device has been blocked");
      }
      const rotated = await rotateDeviceToken(existing._id, {
        deviceName: input.device.deviceName,
        manufacturer: input.device.manufacturer ?? null,
        model: input.device.model ?? null,
        androidVersion: input.device.androidVersion ?? null,
        sdkVersion: input.device.sdkVersion ?? null,
        appVersion: input.device.appVersion ?? null,
      });

      void DeviceLogService.record({
        organizationId,
        deviceId: existing._id,
        level: "INFO",
        event: "device.reenrolled",
        message: "Device re-enrolled and its API token was rotated",
        metadata: { ip: meta.ip ?? null },
      });
      void AuditLogService.record({
        organizationId,
        actorType: "DEVICE",
        actorId: existing._id,
        actorLabel: existing.deviceId,
        action: "gateway.device.reenroll",
        targetType: "Device",
        targetId: existing._id,
        ip: meta.ip,
      });

      return {
        deviceApiToken: rotated.token,
        device: toDeviceDto(rotated.device),
        config: rotated.device.config,
        serverTime: new Date().toISOString(),
        };
    }

    // New device: atomically spend one use of the enrollment code. The
    // `$expr` guard is what makes two simultaneous enrollments against a
    // single-use code resolve to exactly one winner.
    const consumed = await EnrollmentToken.findOneAndUpdate(
      {
        _id: enrollment._id,
        revokedAt: null,
        expiresAt: { $gt: now },
        $expr: { $lt: ["$usedCount", "$maxUses"] },
      },
      { $inc: { usedCount: 1 }, $set: { lastUsedAt: now } },
      { returnDocument: "after" },
    ).lean();

    if (!consumed) {
      throw new UnauthorizedError(
        "This enrollment token has already been used",
        "ENROLLMENT_TOKEN_EXHAUSTED",
      );
    }

    const credentials = generateDeviceToken();
    const publicDeviceId = await DeviceService.generateDeviceId(organizationId);

    let device;
    try {
      device = await Device.create({
        organizationId,
        deviceId: publicDeviceId,
        deviceName: enrollment.deviceNameHint || input.device.deviceName,
        installationId: input.device.installationId,
        manufacturer: input.device.manufacturer ?? null,
        model: input.device.model ?? null,
        androidVersion: input.device.androidVersion ?? null,
        sdkVersion: input.device.sdkVersion ?? null,
        appVersion: input.device.appVersion ?? null,
        status: "ONLINE",
        lastSeenAt: now,
        tokenId: credentials.tokenId,
        tokenHash: credentials.tokenHash,
        tokenIssuedAt: now,
        tokenVersion: 1,
        config: defaults,
        enrolledAt: now,
        enrolledByTokenId: enrollment._id,
      });
    } catch (error) {
      // Lost a race against a concurrent enrollment of the same install:
      // hand back the use and fall through to re-enrollment.
      await EnrollmentToken.updateOne({ _id: enrollment._id }, { $inc: { usedCount: -1 } });
      if (isDuplicateKey(error)) {
        logger.warn("Concurrent enrollment for the same installation id", {
          installationId: input.device.installationId,
        });
        throw new ConflictError("This device is already being enrolled. Try again.");
      }
      throw error;
    }

    void DeviceLogService.record({
      organizationId,
      deviceId: device._id,
      level: "INFO",
      event: "device.enrolled",
      message: `Device ${device.deviceId} enrolled`,
      metadata: {
        model: device.model,
        androidVersion: device.androidVersion,
        ip: meta.ip ?? null,
      },
    });
    void AuditLogService.record({
      organizationId,
      actorType: "DEVICE",
      actorId: device._id,
      actorLabel: device.deviceId,
      action: "gateway.device.enroll",
      targetType: "Device",
      targetId: device._id,
      metadata: { enrollmentTokenId: String(enrollment._id) },
      ip: meta.ip,
    });

    return {
      deviceApiToken: credentials.token,
      device: toDeviceDto(device),
      config: device.config,
      serverTime: new Date().toISOString(),
    };
  },

  async heartbeat(
    device: DeviceAuthContext,
    input: HeartbeatInput,
  ): Promise<HeartbeatResult> {
    const now = new Date();

    const update: Record<string, unknown> = { status: "ONLINE", lastSeenAt: now };
    if (input.batteryLevel !== undefined) update.batteryLevel = input.batteryLevel;
    if (input.isCharging !== undefined) update.isCharging = input.isCharging;
    if (input.networkType !== undefined) update.networkType = input.networkType;
    if (input.appVersion !== undefined) update.appVersion = input.appVersion;

    const updated = await Device.findOneAndUpdate(
      // Re-check BLOCKED here: the device may have been blocked between
      // authentication and this write.
      { _id: device._id, status: { $ne: "BLOCKED" } },
      { $set: update },
      { returnDocument: "after" },
    ).lean();

    if (!updated) throw new ForbiddenError("This device has been blocked");

    const pendingCommands = await DeviceCommand.countDocuments({
      deviceId: device._id,
      status: COMMAND_STATUS.PENDING,
    });

    return {
      serverTime: now.toISOString(),
      config: updated.config,
      pendingCommands,
      status: updated.status,
    };
  },

  /** Commands are claimed atomically; see `CommandService.claimPendingCommands`. */
  async fetchCommands(device: DeviceAuthContext, limit: number) {
    // Polling is also a liveness signal, so refresh presence here too.
    await Device.updateOne(
      { _id: device._id, status: { $nin: ["BLOCKED"] } },
      { $set: { status: "ONLINE", lastSeenAt: new Date() } },
    );
    return CommandService.claimPendingCommands(device, limit);
  },

  /** Config the app should apply, merged from tenant defaults and per-device overrides. */
  async resolveConfig(device: DeviceAuthContext) {
    const settings = await OrganizationService.getEffectiveSettings(device.organizationId);
    return {
      pollingIntervalSeconds:
        device.config?.pollingIntervalSeconds ?? settings.pollingIntervalSeconds,
      heartbeatIntervalSeconds:
        device.config?.heartbeatIntervalSeconds ?? settings.heartbeatIntervalSeconds,
      smsEnabled: settings.smsEnabled,
    };
  },
};

async function rotateDeviceToken(
  deviceId: Types.ObjectId,
  info: {
    deviceName: string;
    manufacturer: string | null;
    model: string | null;
    androidVersion: string | null;
    sdkVersion: number | null;
    appVersion: string | null;
  },
) {
  const credentials = generateDeviceToken();
  const now = new Date();

  const device = await Device.findByIdAndUpdate(
    deviceId,
    {
      $set: {
        ...info,
        tokenId: credentials.tokenId,
        tokenHash: credentials.tokenHash,
        tokenIssuedAt: now,
        status: "ONLINE",
        lastSeenAt: now,
        enrolledAt: now,
      },
      $inc: { tokenVersion: 1 },
    },
    { returnDocument: "after" },
  ).lean();

  if (!device) throw new ConflictError("Device disappeared during re-enrollment");
  return { token: credentials.token, device };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}
