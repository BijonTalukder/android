/**
 * Organization (tenant) administration. Only SUPER_ADMIN may create, list
 * across, or suspend tenants; an ORGANIZATION_ADMIN may read and tune settings
 * for their own tenant only.
 */
import { Types } from "mongoose";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { hashPassword } from "@/lib/crypto";
import { env } from "@/lib/env";
import { withTransaction } from "@/lib/transaction";
import { paginationSchema, toPaginated, type PaginationInput } from "@/lib/pagination";
import { Organization, type OrganizationSettings } from "@/models/Organization";
import { User } from "@/models/User";
import { Device } from "@/models/Device";
import type { AuthContext } from "@/lib/auth";
import {
  isSuperAdmin,
  requireOrgAdmin,
  requireSuperAdmin,
  resolveOrganizationScope,
  toObjectId,
} from "@/middleware/role.middleware";
import { AuditLogService } from "@/modules/audit-log";
import { ROLES } from "@/types";
import { toOrganizationDto, type OrganizationDto } from "./organization.dto";
import { slugify } from "./organization.util";
import type { CreateOrganizationInput, UpdateOrganizationInput } from "./organization.schema";

/** Effective settings = tenant overrides on top of platform defaults. */
export type EffectiveOrgSettings = {
  offlineThresholdSeconds: number;
  pollingIntervalSeconds: number;
  heartbeatIntervalSeconds: number;
  smsEnabled: boolean;
};

export function resolveEffectiveSettings(
  settings: OrganizationSettings | undefined | null,
): EffectiveOrgSettings {
  const config = env();
  return {
    offlineThresholdSeconds:
      settings?.offlineThresholdSeconds ?? config.DEVICE_OFFLINE_THRESHOLD_SECONDS,
    pollingIntervalSeconds:
      settings?.pollingIntervalSeconds ?? config.DEFAULT_POLLING_INTERVAL_SECONDS,
    heartbeatIntervalSeconds:
      settings?.heartbeatIntervalSeconds ?? config.DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    // Both the platform switch and the tenant switch must be on.
    smsEnabled: config.SMS_COMMAND_ENABLED && Boolean(settings?.smsEnabled),
  };
}

export const OrganizationService = {
  async getEffectiveSettings(
    organizationId: Types.ObjectId | string,
  ): Promise<EffectiveOrgSettings> {
    const org = await Organization.findById(organizationId).select({ settings: 1 }).lean();
    if (!org) throw new NotFoundError("Organization");
    return resolveEffectiveSettings(org.settings);
  },

  async list(
    ctx: AuthContext,
    pagination: PaginationInput = paginationSchema.parse({}),
    search?: string,
  ) {
    requireSuperAdmin(ctx);

    const query: Record<string, unknown> = {};
    if (search?.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      query.$or = [{ name: rx }, { slug: rx }];
    }

    const [organizations, total] = await Promise.all([
      Organization.find(query)
        .sort({ createdAt: -1 })
        .skip((pagination.page - 1) * pagination.limit)
        .limit(pagination.limit)
        .lean(),
      Organization.countDocuments(query),
    ]);

    const ids = organizations.map((o) => o._id);
    const [userCounts, deviceCounts] = await Promise.all([
      User.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { organizationId: { $in: ids } } },
        { $group: { _id: "$organizationId", count: { $sum: 1 } } },
      ]),
      Device.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { organizationId: { $in: ids } } },
        { $group: { _id: "$organizationId", count: { $sum: 1 } } },
      ]),
    ]);

    const userMap = new Map(userCounts.map((c) => [String(c._id), c.count]));
    const deviceMap = new Map(deviceCounts.map((c) => [String(c._id), c.count]));

    const items = organizations.map((org) => ({
      ...toOrganizationDto(org),
      userCount: userMap.get(String(org._id)) ?? 0,
      deviceCount: deviceMap.get(String(org._id)) ?? 0,
    }));

    return toPaginated(items, total, pagination);
  },

  async getById(ctx: AuthContext, id: string): Promise<OrganizationDto> {
    requireOrgAdmin(ctx);
    const scope = resolveOrganizationScope(ctx, id);
    const organizationId = scope.organizationId ?? toObjectId(id, "id");

    const org = await Organization.findById(organizationId).lean();
    if (!org) throw new NotFoundError("Organization");
    return toOrganizationDto(org);
  },

  async create(
    ctx: AuthContext,
    input: CreateOrganizationInput,
    meta: { ip?: string | null } = {},
  ): Promise<OrganizationDto> {
    requireSuperAdmin(ctx);

    const slug = input.slug ?? (await uniqueSlug(input.name));
    if (await Organization.exists({ slug })) {
      throw new ConflictError("An organization with this slug already exists", {
        slug: ["Already in use"],
      });
    }

    if (input.admin && (await User.exists({ email: input.admin.email }))) {
      throw new ConflictError("An account with this email already exists", {
        "admin.email": ["Already in use"],
      });
    }

    const passwordHash = input.admin ? await hashPassword(input.admin.password) : null;

    const organizationId = await withTransaction(async (session) => {
      const [organization] = await Organization.create(
        [
          {
            name: input.name,
            slug,
            status: "ACTIVE",
            settings: { smsEnabled: false, ...(input.settings ?? {}) },
          },
        ],
        { session },
      );

      if (input.admin && passwordHash) {
        await User.create(
          [
            {
              organizationId: organization._id,
              name: input.admin.name,
              email: input.admin.email,
              passwordHash,
              role: ROLES.ORGANIZATION_ADMIN,
              status: "ACTIVE",
            },
          ],
          { session },
        );
      }

      return organization._id;
    });

    void AuditLogService.record({
      organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: "organization.create",
      targetType: "Organization",
      targetId: organizationId,
      metadata: { name: input.name, slug, withAdmin: Boolean(input.admin) },
      ip: meta.ip,
    });

    const created = await Organization.findById(organizationId).lean();
    return toOrganizationDto(created!);
  },

  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateOrganizationInput,
    meta: { ip?: string | null } = {},
  ): Promise<OrganizationDto> {
    requireOrgAdmin(ctx);
    const scope = resolveOrganizationScope(ctx, id);
    const organizationId = scope.organizationId ?? toObjectId(id, "id");

    // Suspending a tenant is a platform action, not a tenant-admin action.
    if (input.status !== undefined && !isSuperAdmin(ctx)) {
      requireSuperAdmin(ctx);
    }

    const update: Record<string, unknown> = {};
    if (input.name !== undefined) update.name = input.name;
    if (input.status !== undefined) update.status = input.status;
    for (const [key, value] of Object.entries(input.settings ?? {})) {
      if (value !== undefined) update[`settings.${key}`] = value;
    }

    const org = await Organization.findByIdAndUpdate(
      organizationId,
      { $set: update },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!org) throw new NotFoundError("Organization");

    void AuditLogService.record({
      organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: "organization.update",
      targetType: "Organization",
      targetId: organizationId,
      metadata: { changes: update },
      ip: meta.ip,
    });

    return toOrganizationDto(org);
  },
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "org";
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (!(await Organization.exists({ slug: candidate }))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
