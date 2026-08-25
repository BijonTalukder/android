/**
 * Device authentication for gateway routes.
 *
 * Completely separate from admin authentication: a device token carries no
 * user, no role and no ability to reach any `/api/devices` route. Verification
 * is a single indexed lookup on the token handle followed by a constant-time
 * comparison of the hashed secret.
 */
import type { Types } from "mongoose";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { parseDeviceToken, safeEqual, sha256 } from "@/lib/crypto";
import { Device } from "@/models/Device";
import { Organization } from "@/models/Organization";
import type { DeviceConfig } from "@/models/Device";

export type DeviceAuthContext = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  deviceId: string;
  deviceName: string;
  config: DeviceConfig;
  appVersion: string | null;
};

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!value || scheme.toLowerCase() !== "bearer") return null;
  return value.trim();
}

export async function requireDeviceAuth(req: Request): Promise<DeviceAuthContext> {
  const raw = bearer(req);
  if (!raw) throw new UnauthorizedError("Device token required", "DEVICE_TOKEN_MISSING");

  const parsed = parseDeviceToken(raw);
  if (!parsed) {
    throw new UnauthorizedError("Malformed device token", "DEVICE_TOKEN_INVALID");
  }

  const device = await Device.findOne({ tokenId: parsed.tokenId })
    .select("+tokenHash")
    .lean();

  // Same error for "no such handle" and "wrong secret".
  const invalid = new UnauthorizedError("Invalid device token", "DEVICE_TOKEN_INVALID");
  if (!device || !device.tokenHash) throw invalid;
  if (!safeEqual(device.tokenHash, sha256(parsed.secret))) throw invalid;

  if (device.status === "BLOCKED") {
    throw new ForbiddenError("This device has been blocked");
  }

  const organization = await Organization.findById(device.organizationId)
    .select({ status: 1 })
    .lean();
  if (!organization) throw new UnauthorizedError("Organization no longer exists");
  if (organization.status !== "ACTIVE") {
    throw new ForbiddenError("This organization is suspended");
  }

  return {
    _id: device._id,
    organizationId: device.organizationId,
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    config: device.config,
    appVersion: device.appVersion ?? null,
  };
}
