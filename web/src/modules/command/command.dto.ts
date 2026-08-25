import type { Types } from "mongoose";
import type { CommandError } from "@/models/DeviceCommand";
import type { CommandPriority, CommandStatus, CommandType } from "@/types";

export type CommandDto = {
  id: string;
  organizationId: string;
  device: { id: string; deviceId: string; deviceName: string } | null;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  priority: CommandPriority;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  executedAt: string | null;
  expiresAt: string | null;
  deliveryAttempts: number;
  result: Record<string, unknown> | null;
  error: CommandError | null;
};

/** What a device receives. Intentionally minimal: no tenant or operator data. */
export type GatewayCommandDto = {
  id: string;
  type: CommandType;
  payload: Record<string, unknown>;
  priority: CommandPriority;
  /** Must be echoed back with the result so stale claims can be rejected. */
  claimId: string;
  createdAt: string;
  expiresAt: string | null;
};

export type CommandLike = {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  deviceId: Types.ObjectId;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  priority: CommandPriority;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  sentAt: Date | null;
  executedAt: Date | null;
  expiresAt: Date | null;
  deliveryAttempts: number;
  claimId?: string | null;
  result: Record<string, unknown> | null;
  error: CommandError | null;
};

export type DeviceRef = { _id: Types.ObjectId; deviceId: string; deviceName: string };

export function toCommandDto(
  command: CommandLike,
  device?: DeviceRef | null,
): CommandDto {
  return {
    id: String(command._id),
    organizationId: String(command.organizationId),
    device: device
      ? {
          id: String(device._id),
          deviceId: device.deviceId,
          deviceName: device.deviceName,
        }
      : null,
    type: command.type,
    payload: command.payload ?? {},
    status: command.status,
    priority: command.priority,
    createdBy: command.createdBy ? String(command.createdBy) : null,
    createdAt: command.createdAt.toISOString(),
    updatedAt: command.updatedAt.toISOString(),
    sentAt: command.sentAt ? command.sentAt.toISOString() : null,
    executedAt: command.executedAt ? command.executedAt.toISOString() : null,
    expiresAt: command.expiresAt ? command.expiresAt.toISOString() : null,
    deliveryAttempts: command.deliveryAttempts,
    result: command.result ?? null,
    error: command.error ?? null,
  };
}

export function toGatewayCommandDto(command: CommandLike): GatewayCommandDto {
  return {
    id: String(command._id),
    type: command.type,
    payload: command.payload ?? {},
    priority: command.priority,
    claimId: command.claimId ?? "",
    createdAt: command.createdAt.toISOString(),
    expiresAt: command.expiresAt ? command.expiresAt.toISOString() : null,
  };
}
