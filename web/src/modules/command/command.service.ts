/**
 * Command lifecycle.
 *
 *   PENDING --claim--> DELIVERED --ack--> PROCESSING --result--> SUCCESS/FAILED
 *      |                   |                   |
 *      +-- expiry -------> EXPIRED             +-- stall --> PENDING (re-queued)
 *
 * The two hard requirements the design turns on:
 *
 *  1. **Exactly-one delivery per claim.** Claiming uses a single
 *     `findOneAndUpdate` that filters on `status: PENDING` and flips the status
 *     in the same round trip. MongoDB guarantees the matched document is
 *     updated atomically, so two devices (or two concurrent polls from the same
 *     device) can never receive the same command: the loser's filter no longer
 *     matches. A read-then-write would race here, which is exactly why it is
 *     not used.
 *
 *  2. **Idempotent results.** A result for a command already in a terminal
 *     state is accepted and discarded, returning the stored outcome. The
 *     Android side can retry a result submission indefinitely without the
 *     command being executed twice.
 */
import { Types } from "mongoose";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { env } from "@/lib/env";
import { randomId } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { toPaginated } from "@/lib/pagination";
import { zodToFieldErrors } from "@/lib/response";
import { Device } from "@/models/Device";
import { DeviceCommand } from "@/models/DeviceCommand";
import type { AuthContext } from "@/lib/auth";
import {
  requireOrgAdmin,
  resolveOrganizationScope,
  toObjectId,
} from "@/middleware/role.middleware";
import { AuditLogService } from "@/modules/audit-log";
import { DeviceService } from "@/modules/device/device.service";
import { DeviceLogService } from "@/modules/device/device-log.service";
import { OrganizationService } from "@/modules/organization";
import { getCommandTransport } from "@/modules/gateway/transport";
import {
  COMMAND_PRIORITY_WEIGHT,
  COMMAND_STATUS,
  COMMAND_TYPE,
  TERMINAL_COMMAND_STATUSES,
  type CommandType,
} from "@/types";
import {
  toCommandDto,
  toGatewayCommandDto,
  type CommandDto,
  type DeviceRef,
  type GatewayCommandDto,
} from "./command.dto";
import { sweepCommands } from "./command.reaper";
import {
  COMMAND_PAYLOAD_SCHEMAS,
  type CommandResultInput,
  type CreateCommandInput,
  type ListCommandsQuery,
} from "./command.schema";

/** Validate a payload against the schema registered for its command type. */
export function validateCommandPayload(
  type: CommandType,
  payload: unknown,
): Record<string, unknown> {
  const schema = COMMAND_PAYLOAD_SCHEMAS[type];
  const parsed = schema.safeParse(payload ?? {});
  if (!parsed.success) {
    const errors = zodToFieldErrors(parsed.error);
    const prefixed: Record<string, string[]> = {};
    for (const [key, messages] of Object.entries(errors)) {
      prefixed[key === "_root" ? "payload" : `payload.${key}`] = messages;
    }
    throw new ValidationError(prefixed, `Invalid payload for ${type}`);
  }
  return parsed.data as Record<string, unknown>;
}

export const CommandService = {
  validateCommandPayload,

  async create(
    ctx: AuthContext,
    deviceIdParam: string,
    input: CreateCommandInput,
    meta: { ip?: string | null } = {},
  ): Promise<CommandDto> {
    requireOrgAdmin(ctx);

    const device = await DeviceService.findInScope(ctx, deviceIdParam);

    if (device.status === "BLOCKED") {
      throw new ConflictError("This device is blocked and cannot receive commands");
    }
    if (!device.tokenId) {
      throw new ConflictError("This device has not completed enrollment");
    }

    // SEND_SMS is off unless both the platform and the tenant enable it.
    if (input.type === COMMAND_TYPE.SEND_SMS) {
      const settings = await OrganizationService.getEffectiveSettings(device.organizationId);
      if (!settings.smsEnabled) {
        throw new ForbiddenError(
          "SMS sending is not enabled for this deployment. Enable it only where " +
            "carrier rules, user consent and store policy allow.",
        );
      }
    }

    const payload = validateCommandPayload(input.type, input.payload);
    const ttl = input.expiresInSeconds ?? env().COMMAND_DEFAULT_TTL_SECONDS;

    const command = await DeviceCommand.create({
      organizationId: device.organizationId,
      deviceId: device._id,
      type: input.type,
      payload,
      status: COMMAND_STATUS.PENDING,
      priority: input.priority,
      priorityWeight: COMMAND_PRIORITY_WEIGHT[input.priority],
      createdBy: new Types.ObjectId(ctx.userId),
      expiresAt: new Date(Date.now() + ttl * 1000),
    });

    // Hand the command to the configured transport. Under polling this only
    // records intent; under a push transport it would notify the device now.
    const dispatch = await getCommandTransport().dispatch({
      id: String(command._id),
      organizationId: device.organizationId,
      deviceId: device._id,
      type: input.type,
      priority: input.priority,
    });

    void DeviceLogService.record({
      organizationId: device.organizationId,
      deviceId: device._id,
      level: "INFO",
      event: "command.created",
      message: `${input.type} queued`,
      metadata: {
        commandId: String(command._id),
        priority: input.priority,
        transport: dispatch.transport,
        mode: dispatch.mode,
      },
    });

    void AuditLogService.record({
      organizationId: device.organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: "command.create",
      targetType: "DeviceCommand",
      targetId: command._id,
      metadata: {
        type: input.type,
        deviceId: device.deviceId,
        // The SMS body is deliberately not audited verbatim.
        ...(input.type === COMMAND_TYPE.SEND_SMS
          ? { destination: payload.destination, messageLength: String(payload.message).length }
          : { payload }),
      },
      ip: meta.ip,
    });

    return toCommandDto(command, device);
  },

  async list(ctx: AuthContext, query: ListCommandsQuery) {
    const scope = resolveOrganizationScope(ctx, query.organizationId);
    await sweepCommands(scope.organizationId ?? null);

    const filter: Record<string, unknown> = { ...scope };

    if (query.deviceId) {
      // Resolve through the scoped finder so an id from another tenant 404s.
      const device = await DeviceService.findInScope(ctx, query.deviceId);
      filter.deviceId = device._id;
      filter.organizationId = device.organizationId;
    }
    if (query.type) filter.type = query.type;
    if (query.status) filter.status = query.status;
    if (query.priority) filter.priority = query.priority;
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }

    const [commands, total] = await Promise.all([
      DeviceCommand.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      DeviceCommand.countDocuments(filter),
    ]);

    const deviceMap = await deviceRefMap(commands.map((c) => c.deviceId));
    const items = commands.map((c) => toCommandDto(c, deviceMap.get(String(c.deviceId))));

    return toPaginated(items, total, query);
  },

  async getById(ctx: AuthContext, id: string): Promise<CommandDto> {
    const scope = resolveOrganizationScope(ctx);
    const filter: Record<string, unknown> = { _id: toObjectId(id, "id") };
    if (scope.organizationId) filter.organizationId = scope.organizationId;

    const command = await DeviceCommand.findOne(filter).lean();
    if (!command) throw new NotFoundError("Command");

    const deviceMap = await deviceRefMap([command.deviceId]);
    return toCommandDto(command, deviceMap.get(String(command.deviceId)));
  },

  async cancel(
    ctx: AuthContext,
    id: string,
    meta: { ip?: string | null } = {},
  ): Promise<CommandDto> {
    requireOrgAdmin(ctx);
    const scope = resolveOrganizationScope(ctx);
    const filter: Record<string, unknown> = {
      _id: toObjectId(id, "id"),
      status: COMMAND_STATUS.PENDING,
    };
    if (scope.organizationId) filter.organizationId = scope.organizationId;

    // Only a still-PENDING command can be cancelled: once claimed, the device
    // may already have run it, and pretending otherwise would be a lie.
    const command = await DeviceCommand.findOneAndUpdate(
      filter,
      {
        $set: {
          status: COMMAND_STATUS.EXPIRED,
          error: { code: "CANCELLED", message: "Cancelled by an administrator" },
        },
      },
      { returnDocument: "after" },
    ).lean();

    if (!command) {
      throw new ConflictError("Only a pending command can be cancelled");
    }

    void AuditLogService.record({
      organizationId: command.organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: "command.cancel",
      targetType: "DeviceCommand",
      targetId: command._id,
      ip: meta.ip,
    });

    const deviceMap = await deviceRefMap([command.deviceId]);
    return toCommandDto(command, deviceMap.get(String(command.deviceId)));
  },

  /* ---------------------------------------------------------------- */
  /* Gateway-facing                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Atomically hand up to `limit` pending commands to one device.
   *
   * Each iteration is a self-contained compare-and-set. Concurrency safety
   * does not depend on the loop, on a transaction, or on the caller.
   */
  async claimPendingCommands(
    device: { _id: Types.ObjectId; organizationId: Types.ObjectId },
    limit: number,
  ): Promise<GatewayCommandDto[]> {
    // Force the sweep: a device polling right now must not be handed a command
    // that expired a second ago, and a stalled claim should be re-queued in
    // time for this very poll.
    await sweepCommands(device.organizationId, true);

    const claimed: GatewayCommandDto[] = [];
    const now = new Date();

    for (let i = 0; i < limit; i++) {
      const claimId = randomId(8);

      const command = await DeviceCommand.findOneAndUpdate(
        {
          deviceId: device._id,
          organizationId: device.organizationId,
          status: COMMAND_STATUS.PENDING,
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        },
        {
          $set: {
            status: COMMAND_STATUS.DELIVERED,
            sentAt: now,
            claimedAt: now,
            claimId,
          },
          $inc: { deliveryAttempts: 1 },
        },
        {
          // Highest priority first, oldest first within a priority.
          sort: { priorityWeight: -1, createdAt: 1 },
          returnDocument: "after",
        },
      ).lean();

      if (!command) break;
      claimed.push(toGatewayCommandDto(command));
    }

    if (claimed.length > 0) {
      void DeviceLogService.record({
        organizationId: device.organizationId,
        deviceId: device._id,
        level: "INFO",
        event: "command.delivered",
        message: `${claimed.length} command(s) delivered`,
        metadata: { commandIds: claimed.map((c) => c.id) },
      });
    }

    return claimed;
  },

  /**
   * Apply a result reported by a device.
   *
   * Ownership, claim freshness and idempotency are all checked here, in that
   * order, before anything is written.
   */
  async submitResult(
    device: { _id: Types.ObjectId; organizationId: Types.ObjectId; deviceId: string },
    commandId: string,
    input: CommandResultInput,
  ): Promise<{ command: CommandDto; idempotent: boolean }> {
    const _id = toObjectId(commandId, "commandId");

    // Scoping by deviceId is the ownership check: a device can only ever
    // report on its own commands.
    const command = await DeviceCommand.findOne({
      _id,
      deviceId: device._id,
      organizationId: device.organizationId,
    }).lean();

    if (!command) throw new NotFoundError("Command");

    // Already finished: accept the retry, change nothing, return what we have.
    if (TERMINAL_COMMAND_STATUSES.includes(command.status)) {
      return { command: toCommandDto(command), idempotent: true };
    }

    if (command.status === COMMAND_STATUS.PENDING) {
      throw new ConflictError("This command has not been delivered to the device");
    }

    // A claim id from a superseded delivery means the command was re-queued
    // (and possibly re-executed) since. Refuse rather than record an outcome
    // that may not correspond to the current attempt.
    if (input.claimId && command.claimId && input.claimId !== command.claimId) {
      logger.warn("Rejected result from a stale command claim", {
        commandId,
        deviceId: device.deviceId,
      });
      throw new ConflictError("This command claim is no longer current", {
        claimId: ["Stale claim; the command was re-queued"],
      });
    }

    const now = new Date();

    if (input.status === "PROCESSING") {
      // Acknowledgement only. Refresh `claimedAt` so the reaper gives the
      // device another full timeout window to finish.
      const updated = await DeviceCommand.findOneAndUpdate(
        { _id, status: { $nin: TERMINAL_COMMAND_STATUSES } },
        { $set: { status: COMMAND_STATUS.PROCESSING, claimedAt: now } },
        { returnDocument: "after" },
      ).lean();
      if (!updated) {
        const current = await DeviceCommand.findById(_id).lean();
        return { command: toCommandDto(current!), idempotent: true };
      }
      return { command: toCommandDto(updated), idempotent: false };
    }

    const isSuccess = input.status === "SUCCESS";

    // The `status` filter makes the terminal transition itself a
    // compare-and-set: two concurrent result posts cannot both win.
    const updated = await DeviceCommand.findOneAndUpdate(
      { _id, status: { $nin: TERMINAL_COMMAND_STATUSES } },
      {
        $set: {
          status: isSuccess ? COMMAND_STATUS.SUCCESS : COMMAND_STATUS.FAILED,
          executedAt: now,
          result: input.result ?? null,
          error: isSuccess ? null : (input.error ?? null),
        },
      },
      { returnDocument: "after" },
    ).lean();

    if (!updated) {
      const current = await DeviceCommand.findById(_id).lean();
      return { command: toCommandDto(current!), idempotent: true };
    }

    void DeviceLogService.record({
      organizationId: device.organizationId,
      deviceId: device._id,
      level: isSuccess ? "INFO" : "ERROR",
      event: isSuccess ? "command.success" : "command.failed",
      message: isSuccess
        ? `${updated.type} completed`
        : `${updated.type} failed: ${input.error?.message ?? "unknown error"}`,
      metadata: { commandId: String(updated._id), type: updated.type },
    });

    return { command: toCommandDto(updated), idempotent: false };
  },

  /* ---------------------------------------------------------------- */
  /* Reporting                                                         */
  /* ---------------------------------------------------------------- */

  async statsFor(organizationId: Types.ObjectId | null) {
    const match = organizationId ? { organizationId } : {};
    const rows = await DeviceCommand.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    return {
      total: rows.reduce((sum, r) => sum + r.count, 0),
      pending: byStatus[COMMAND_STATUS.PENDING] ?? 0,
      delivered: byStatus[COMMAND_STATUS.DELIVERED] ?? 0,
      processing: byStatus[COMMAND_STATUS.PROCESSING] ?? 0,
      success: byStatus[COMMAND_STATUS.SUCCESS] ?? 0,
      failed: byStatus[COMMAND_STATUS.FAILED] ?? 0,
      expired: byStatus[COMMAND_STATUS.EXPIRED] ?? 0,
    };
  },
};

async function deviceRefMap(ids: Types.ObjectId[]): Promise<Map<string, DeviceRef>> {
  const unique = [...new Set(ids.map((id) => String(id)))];
  if (unique.length === 0) return new Map();
  const devices = await Device.find({ _id: { $in: unique } })
    .select({ deviceId: 1, deviceName: 1 })
    .lean();
  return new Map(devices.map((d) => [String(d._id), d as DeviceRef]));
}
