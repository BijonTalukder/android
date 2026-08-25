import { Schema, model, models, type Model, type Types } from "mongoose";
import { LOG_LEVEL_VALUES, type LogLevel } from "@/types";

export type DeviceLogAttrs = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  deviceId: Types.ObjectId;
  level: LogLevel;
  /** Machine-readable event key, e.g. `command.result.received`. */
  event: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

const deviceLogSchema = new Schema<DeviceLogAttrs>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    deviceId: { type: Schema.Types.ObjectId, ref: "Device", required: true },
    level: { type: String, enum: LOG_LEVEL_VALUES, required: true, default: "INFO" },
    event: { type: String, required: true, trim: true, maxlength: 120 },
    message: { type: String, required: true, maxlength: 2_000 },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

deviceLogSchema.index({ organizationId: 1, createdAt: -1 });
deviceLogSchema.index({ organizationId: 1, deviceId: 1, createdAt: -1 });
deviceLogSchema.index({ organizationId: 1, level: 1, createdAt: -1 });
// 90-day retention; adjust per tenant policy before production.
deviceLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7_776_000 });

export const DeviceLog: Model<DeviceLogAttrs> =
  (models.DeviceLog as Model<DeviceLogAttrs>) ??
  model<DeviceLogAttrs>("DeviceLog", deviceLogSchema);
