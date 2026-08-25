import type { Types } from "mongoose";
import type { DeviceConfig } from "@/models/Device";
import type { DeviceStatus, NetworkType } from "@/types";

export type DeviceDto = {
  id: string;
  organizationId: string;
  deviceId: string;
  deviceName: string;
  manufacturer: string | null;
  model: string | null;
  androidVersion: string | null;
  sdkVersion: number | null;
  appVersion: string | null;
  status: DeviceStatus;
  lastSeenAt: string | null;
  batteryLevel: number | null;
  isCharging: boolean | null;
  networkType: NetworkType | null;
  config: DeviceConfig;
  enrolledAt: string | null;
  blockedAt: string | null;
  blockedReason: string | null;
  tokenIssuedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeviceLike = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  deviceId: string;
  deviceName: string;
  manufacturer?: string | null;
  model?: string | null;
  androidVersion?: string | null;
  sdkVersion?: number | null;
  appVersion?: string | null;
  status: DeviceStatus;
  lastSeenAt?: Date | null;
  batteryLevel?: number | null;
  isCharging?: boolean | null;
  networkType?: NetworkType | null;
  config: DeviceConfig;
  enrolledAt?: Date | null;
  blockedAt?: Date | null;
  blockedReason?: string | null;
  tokenIssuedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Note what is absent: `tokenId`, `tokenHash` and `installationId` never leave
 * the server through this DTO.
 */
export function toDeviceDto(device: DeviceLike): DeviceDto {
  return {
    id: String(device._id),
    organizationId: String(device.organizationId),
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    manufacturer: device.manufacturer ?? null,
    model: device.model ?? null,
    androidVersion: device.androidVersion ?? null,
    sdkVersion: device.sdkVersion ?? null,
    appVersion: device.appVersion ?? null,
    status: device.status,
    lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
    batteryLevel: device.batteryLevel ?? null,
    isCharging: device.isCharging ?? null,
    networkType: device.networkType ?? null,
    config: device.config,
    enrolledAt: device.enrolledAt ? device.enrolledAt.toISOString() : null,
    blockedAt: device.blockedAt ? device.blockedAt.toISOString() : null,
    blockedReason: device.blockedReason ?? null,
    tokenIssuedAt: device.tokenIssuedAt ? device.tokenIssuedAt.toISOString() : null,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
}
