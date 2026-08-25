/**
 * Audit trail. Writes are fire-and-forget on purpose: failing to record an
 * audit line must never fail the operation the user asked for, but it must be
 * loud in the logs.
 */
import { Types } from "mongoose";
import { AuditLog } from "@/models/AuditLog";
import { logger } from "@/lib/logger";
import { paginationSchema, toPaginated, type PaginationInput } from "@/lib/pagination";
import type { ActorType } from "@/types";

export type AuditEntry = {
  organizationId?: Types.ObjectId | string | null;
  actorType: ActorType;
  actorId?: Types.ObjectId | string | null;
  actorLabel?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: Types.ObjectId | string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
};

function oid(value: Types.ObjectId | string | null | undefined): Types.ObjectId | null {
  if (!value) return null;
  return typeof value === "string" ? new Types.ObjectId(value) : value;
}

export const AuditLogService = {
  async record(entry: AuditEntry): Promise<void> {
    try {
      await AuditLog.create({
        organizationId: oid(entry.organizationId),
        actorType: entry.actorType,
        actorId: oid(entry.actorId),
        actorLabel: entry.actorLabel ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: oid(entry.targetId),
        metadata: entry.metadata ?? null,
        ip: entry.ip ?? null,
      });
    } catch (error) {
      logger.error("Failed to write audit log", { error, action: entry.action });
    }
  },

  async list(
    filter: { organizationId?: Types.ObjectId; action?: string },
    pagination: PaginationInput = paginationSchema.parse({}),
  ) {
    const query: Record<string, unknown> = {};
    if (filter.organizationId) query.organizationId = filter.organizationId;
    if (filter.action) query.action = filter.action;

    const [items, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    return toPaginated(items, total, pagination);
  },
};
