/**
 * Read-only aggregates for the dashboard landing page. Kept in its own module
 * so the expensive queries live in one place and can be cached or moved to a
 * materialised view later without touching the UI.
 */
import type { Types } from "mongoose";
import type { AuthContext } from "@/lib/auth";
import { resolveOrganizationScope } from "@/middleware/role.middleware";
import { Device } from "@/models/Device";
import { DeviceCommand } from "@/models/DeviceCommand";
import { DeviceLog } from "@/models/DeviceLog";
import { sweepStaleDevices } from "@/modules/device/device.presence";
import { sweepCommands } from "@/modules/command/command.reaper";
import { COMMAND_STATUS, type CommandStatus, type DeviceStatus } from "@/types";

export type DashboardSummary = {
  devices: {
    total: number;
    online: number;
    offline: number;
    inactive: number;
    blocked: number;
  };
  commands: {
    total: number;
    pending: number;
    inFlight: number;
    success: number;
    failed: number;
    expired: number;
  };
  recentDevices: Array<{
    id: string;
    deviceId: string;
    deviceName: string;
    status: DeviceStatus;
    lastSeenAt: string | null;
    batteryLevel: number | null;
    model: string | null;
  }>;
  recentCommands: Array<{
    id: string;
    type: string;
    status: CommandStatus;
    priority: string;
    deviceName: string | null;
    devicePublicId: string | null;
    createdAt: string;
    executedAt: string | null;
  }>;
  recentErrors: Array<{
    id: string;
    deviceName: string | null;
    devicePublicId: string | null;
    event: string;
    message: string;
    createdAt: string;
  }>;
};

export const DashboardService = {
  async summary(ctx: AuthContext): Promise<DashboardSummary> {
    const scope = resolveOrganizationScope(ctx);
    const organizationId = scope.organizationId ?? null;

    // Make sure presence and queue state are current before counting them.
    await Promise.all([sweepStaleDevices(organizationId), sweepCommands(organizationId)]);

    const match = organizationId ? { organizationId } : {};

    const [deviceRows, commandRows, recentDeviceDocs, recentCommandDocs, recentErrorDocs] =
      await Promise.all([
        Device.aggregate<{ _id: DeviceStatus; count: number }>([
          { $match: match },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        DeviceCommand.aggregate<{ _id: CommandStatus; count: number }>([
          { $match: match },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Device.find(match)
          .sort({ lastSeenAt: -1, createdAt: -1 })
          .limit(8)
          .select({ deviceId: 1, deviceName: 1, status: 1, lastSeenAt: 1, batteryLevel: 1, model: 1 })
          .lean(),
        DeviceCommand.find(match).sort({ createdAt: -1 }).limit(8).lean(),
        DeviceLog.find({ ...match, level: "ERROR" }).sort({ createdAt: -1 }).limit(8).lean(),
      ]);

    const deviceCounts = countMap(deviceRows);
    const commandCounts = countMap(commandRows);

    const deviceIds = [
      ...recentCommandDocs.map((c) => c.deviceId),
      ...recentErrorDocs.map((l) => l.deviceId),
    ];
    const deviceNames = await deviceNameMap(deviceIds);

    return {
      devices: {
        total: sum(deviceRows),
        online: deviceCounts.ONLINE ?? 0,
        offline: deviceCounts.OFFLINE ?? 0,
        inactive: deviceCounts.INACTIVE ?? 0,
        blocked: deviceCounts.BLOCKED ?? 0,
      },
      commands: {
        total: sum(commandRows),
        pending: commandCounts[COMMAND_STATUS.PENDING] ?? 0,
        inFlight:
          (commandCounts[COMMAND_STATUS.DELIVERED] ?? 0) +
          (commandCounts[COMMAND_STATUS.PROCESSING] ?? 0),
        success: commandCounts[COMMAND_STATUS.SUCCESS] ?? 0,
        failed: commandCounts[COMMAND_STATUS.FAILED] ?? 0,
        expired: commandCounts[COMMAND_STATUS.EXPIRED] ?? 0,
      },
      recentDevices: recentDeviceDocs.map((d) => ({
        id: String(d._id),
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        status: d.status,
        lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
        batteryLevel: d.batteryLevel ?? null,
        model: d.model ?? null,
      })),
      recentCommands: recentCommandDocs.map((c) => {
        const device = deviceNames.get(String(c.deviceId));
        return {
          id: String(c._id),
          type: c.type,
          status: c.status,
          priority: c.priority,
          deviceName: device?.deviceName ?? null,
          devicePublicId: device?.deviceId ?? null,
          createdAt: c.createdAt.toISOString(),
          executedAt: c.executedAt ? c.executedAt.toISOString() : null,
        };
      }),
      recentErrors: recentErrorDocs.map((l) => {
        const device = deviceNames.get(String(l.deviceId));
        return {
          id: String(l._id),
          deviceName: device?.deviceName ?? null,
          devicePublicId: device?.deviceId ?? null,
          event: l.event,
          message: l.message,
          createdAt: l.createdAt.toISOString(),
        };
      }),
    };
  },
};

function countMap<T extends string>(rows: Array<{ _id: T; count: number }>) {
  return Object.fromEntries(rows.map((r) => [r._id, r.count])) as Partial<Record<T, number>>;
}

function sum(rows: Array<{ count: number }>) {
  return rows.reduce((total, r) => total + r.count, 0);
}

async function deviceNameMap(ids: Types.ObjectId[]) {
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) return new Map<string, { deviceId: string; deviceName: string }>();
  const devices = await Device.find({ _id: { $in: unique } })
    .select({ deviceId: 1, deviceName: 1 })
    .lean();
  return new Map(
    devices.map((d) => [String(d._id), { deviceId: d.deviceId, deviceName: d.deviceName }]),
  );
}
