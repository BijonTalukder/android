/**
 * Audit trail. Writes are fire-and-forget on purpose: failing to record an
 * audit line must never fail the operation the user asked for, but it must be
 * loud in the logs.
 */
import { Types } from "mongoose";
import { AuditLog } from "@/models/AuditLog";
import { User } from "@/models/User";
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

  /**
   * Read the trail. Scoped like everything else: a tenant admin sees only
   * their own organization's entries.
   */
  async list(
    filter: { organizationId?: Types.ObjectId; action?: string },
    pagination: PaginationInput = paginationSchema.parse({}),
  ) {
    const query: Record<string, unknown> = {};
    if (filter.organizationId) query.organizationId = filter.organizationId;
    if (filter.action) query.action = filter.action;

    const [entries, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    // Older entries may predate `actorLabel`, and a user can be renamed, so
    // resolve names at read time rather than trusting the denormalised copy.
    const userIds = [
      ...new Set(
        entries
          .filter((entry) => entry.actorType === "USER" && entry.actorId)
          .map((entry) => String(entry.actorId)),
      ),
    ];
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } })
          .select({ name: 1, email: 1 })
          .lean()
      : [];
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const items = entries.map((entry) => {
      const user = entry.actorId ? userMap.get(String(entry.actorId)) : undefined;
      return {
        id: String(entry._id),
        action: entry.action,
        actorType: entry.actorType,
        actor: user?.name ?? entry.actorLabel ?? "System",
        actorEmail: user?.email ?? null,
        targetType: entry.targetType,
        targetId: entry.targetId ? String(entry.targetId) : null,
        metadata: entry.metadata ?? null,
        ip: entry.ip,
        createdAt: entry.createdAt.toISOString(),
      };
    });

    return toPaginated(items, total, pagination);
  },
};

export type AuditLogDto = Awaited<
  ReturnType<typeof AuditLogService.list>
>["items"][number];
