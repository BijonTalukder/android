import { Schema, model, models, type Model, type HydratedDocument, type Types } from "mongoose";
import {
  DEVICE_STATUS_VALUES,
  NETWORK_TYPE_VALUES,
  type DeviceStatus,
  type NetworkType,
} from "@/types";

/** Configuration the gateway app mirrors locally (see UPDATE_CONFIG). */
export type DeviceConfig = {
  pollingIntervalSeconds: number;
  heartbeatIntervalSeconds: number;
};

export type DeviceAttrs = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;

  /** Public, human-quotable device identifier (`DEV-XXXXXXXX`). */
  deviceId: string;
  deviceName: string;

  /** App-generated install id; used to make re-enrollment idempotent. */
  installationId: string;

  manufacturer: string | null;
  model: string | null;
  androidVersion: string | null;
  sdkVersion: number | null;
  appVersion: string | null;

  status: DeviceStatus;
  lastSeenAt: Date | null;

  batteryLevel: number | null;
  isCharging: boolean | null;
  networkType: NetworkType | null;

  /** Indexed handle for the device API token; the secret half is hashed. */
  tokenId: string | null;
  tokenHash: string | null;
  tokenIssuedAt: Date | null;
  /** Bumped on every rotation so old tokens cannot be resurrected. */
  tokenVersion: number;

  config: DeviceConfig;

  enrolledAt: Date | null;
  enrolledByTokenId: Types.ObjectId | null;
  blockedAt: Date | null;
  blockedReason: string | null;

  createdAt: Date;
  updatedAt: Date;
};

export type DeviceDocument = HydratedDocument<DeviceAttrs>;

const configSchema = new Schema<DeviceConfig>(
  {
    pollingIntervalSeconds: { type: Number, required: true, min: 5, max: 3_600 },
    heartbeatIntervalSeconds: { type: Number, required: true, min: 15, max: 3_600 },
  },
  { _id: false },
);

const deviceSchema = new Schema<DeviceAttrs>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },

    deviceId: { type: String, required: true, trim: true, maxlength: 64 },
    deviceName: { type: String, required: true, trim: true, maxlength: 120 },

    installationId: { type: String, required: true, trim: true, maxlength: 128 },

    manufacturer: { type: String, default: null, trim: true, maxlength: 80 },
    model: { type: String, default: null, trim: true, maxlength: 80 },
    androidVersion: { type: String, default: null, trim: true, maxlength: 32 },
    sdkVersion: { type: Number, default: null, min: 1, max: 100 },
    appVersion: { type: String, default: null, trim: true, maxlength: 32 },

    status: {
      type: String,
      enum: DEVICE_STATUS_VALUES,
      default: "INACTIVE",
      required: true,
    },
    lastSeenAt: { type: Date, default: null },

    batteryLevel: { type: Number, default: null, min: 0, max: 100 },
    isCharging: { type: Boolean, default: null },
    networkType: { type: String, enum: [...NETWORK_TYPE_VALUES, null], default: null },

    tokenId: { type: String, default: null },
    tokenHash: { type: String, default: null, select: false },
    tokenIssuedAt: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0, required: true },

    config: { type: configSchema, required: true },

    enrolledAt: { type: Date, default: null },
    enrolledByTokenId: {
      type: Schema.Types.ObjectId,
      ref: "EnrollmentToken",
      default: null,
    },
    blockedAt: { type: Date, default: null },
    blockedReason: { type: String, default: null, maxlength: 400 },
  },
  { timestamps: true, versionKey: false },
);

// Tenant isolation: every lookup is prefixed by organizationId.
deviceSchema.index({ organizationId: 1, deviceId: 1 }, { unique: true });
deviceSchema.index({ organizationId: 1, installationId: 1 }, { unique: true });
deviceSchema.index({ organizationId: 1, status: 1, lastSeenAt: -1 });
deviceSchema.index({ organizationId: 1, createdAt: -1 });
deviceSchema.index({ lastSeenAt: 1 });
// Gateway auth path: single point lookup on the token handle.
deviceSchema.index(
  { tokenId: 1 },
  { unique: true, partialFilterExpression: { tokenId: { $type: "string" } } },
);

export const Device: Model<DeviceAttrs> =
  (models.Device as Model<DeviceAttrs>) ?? model<DeviceAttrs>("Device", deviceSchema);
