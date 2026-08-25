/**
 * Device activity log writer.
 *
 * Like the audit log, writes never propagate failures to the caller: losing a
 * log line must not fail a heartbeat or a command result.
 */
import type { Types } from "mongoose";
import { DeviceLog } from "@/models/DeviceLog";
import { logger } from "@/lib/logger";
import type { LogLevel } from "@/types";

export type DeviceLogEntry = {
  organizationId: Types.ObjectId;
  deviceId: Types.ObjectId;
  level: LogLevel;
  event: string;
  message: string;
  metadata?: Record<string, unknown> | null;
};

export const DeviceLogService = {
  async record(entry: DeviceLogEntry): Promise<void> {
    try {
      await DeviceLog.create({
        organizationId: entry.organizationId,
        deviceId: entry.deviceId,
        level: entry.level,
        event: entry.event,
        message: entry.message.slice(0, 2_000),
        metadata: entry.metadata ?? null,
      });
    } catch (error) {
      logger.error("Failed to write device log", { error, event: entry.event });
    }
  },
};
