import { Schema, model, models, type Model, type HydratedDocument, type Types } from "mongoose";
import {
  COMMAND_PRIORITY_VALUES,
  COMMAND_STATUS_VALUES,
  COMMAND_TYPE_VALUES,
  type CommandPriority,
  type CommandStatus,
  type CommandType,
} from "@/types";

export type CommandError = { code: string; message: string };

export type DeviceCommandAttrs = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /** Reference to `Device._id` (not the public `Device.deviceId` string). */
  deviceId: Types.ObjectId;

  type: CommandType;
  payload: Record<string, unknown>;

  status: CommandStatus;
  priority: CommandPriority;
  /** Denormalised numeric priority so the claim query can sort on an index. */
  priorityWeight: number;

  createdBy: Types.ObjectId | null;

  sentAt: Date | null;
  executedAt: Date | null;
  expiresAt: Date | null;

  /**
   * Incremented each time a device claims the command. A command that is
   * claimed but never acknowledged is re-queued by the reaper, and this count
   * bounds how often that can happen.
   */
  deliveryAttempts: number;
  /** Identifies the current claim; results from a stale claim are rejected. */
  claimId: string | null;
  claimedAt: Date | null;

  result: Record<string, unknown> | null;
  error: CommandError | null;

  createdAt: Date;
  updatedAt: Date;
};

export type DeviceCommandDocument = HydratedDocument<DeviceCommandAttrs>;

const errorSchema = new Schema<CommandError>(
  {
    code: { type: String, required: true, maxlength: 64 },
    message: { type: String, required: true, maxlength: 1_000 },
  },
  { _id: false },
);

const deviceCommandSchema = new Schema<DeviceCommandAttrs>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    deviceId: { type: Schema.Types.ObjectId, ref: "Device", required: true },

    type: { type: String, enum: COMMAND_TYPE_VALUES, required: true },
    payload: { type: Schema.Types.Mixed, default: () => ({}) },

    status: {
      type: String,
      enum: COMMAND_STATUS_VALUES,
      default: "PENDING",
      required: true,
    },
    priority: {
      type: String,
      enum: COMMAND_PRIORITY_VALUES,
      default: "NORMAL",
      required: true,
    },
    priorityWeight: { type: Number, required: true, default: 20 },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    sentAt: { type: Date, default: null },
    executedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },

    deliveryAttempts: { type: Number, required: true, default: 0, min: 0 },
    claimId: { type: String, default: null },
    claimedAt: { type: Date, default: null },

    result: { type: Schema.Types.Mixed, default: null },
    error: { type: errorSchema, default: null },
  },
  { timestamps: true, versionKey: false },
);

/**
 * The atomic claim in `CommandService.claimPendingCommands` filters on
 * (deviceId, status) and sorts by (priorityWeight desc, createdAt asc). This
 * compound index serves that query without an in-memory sort.
 */
deviceCommandSchema.index({
  deviceId: 1,
  status: 1,
  priorityWeight: -1,
  createdAt: 1,
});
deviceCommandSchema.index({ organizationId: 1, createdAt: -1 });
deviceCommandSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
deviceCommandSchema.index({ organizationId: 1, deviceId: 1, createdAt: -1 });
deviceCommandSchema.index({ organizationId: 1, type: 1, createdAt: -1 });
// Supports the lazy expiry sweep.
deviceCommandSchema.index({ status: 1, expiresAt: 1 });
// Supports the stalled-claim reaper.
deviceCommandSchema.index({ status: 1, claimedAt: 1 });

export const DeviceCommand: Model<DeviceCommandAttrs> =
  (models.DeviceCommand as Model<DeviceCommandAttrs>) ??
  model<DeviceCommandAttrs>("DeviceCommand", deviceCommandSchema);
