/**
 * Organization user management.
 *
 * Guard rails encoded here:
 *  - only a SUPER_ADMIN can mint another SUPER_ADMIN;
 *  - an ORGANIZATION_ADMIN can only act inside their own tenant;
 *  - nobody can suspend, demote or delete their own account, so a tenant can
 *    never be left without an administrator by accident.
 */
import { Types } from "mongoose";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashPassword } from "@/lib/crypto";
import { toPaginated } from "@/lib/pagination";
import { User } from "@/models/User";
import { Organization } from "@/models/Organization";
import type { AuthContext } from "@/lib/auth";
import {
  isSuperAdmin,
  requireOrgAdmin,
  resolveOrganizationScope,
  resolveWriteOrganization,
  toObjectId,
} from "@/middleware/role.middleware";
import { AuthService } from "@/modules/auth/auth.service";
import { AuditLogService } from "@/modules/audit-log";
import { ROLES, type Role, type UserStatus } from "@/types";
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from "./user.schema";

export type UserDto = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  organizationId: string | null;
  organizationName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

function toDto(
  user: {
    _id: Types.ObjectId;
    name: string;
    email: string;
    role: Role;
    status: UserStatus;
    organizationId: Types.ObjectId | null;
    lastLoginAt?: Date | null;
    createdAt: Date;
  },
  organizationName: string | null = null,
): UserDto {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    organizationId: user.organizationId ? String(user.organizationId) : null,
    organizationName,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

function assertCanAssignRole(ctx: AuthContext, role: Role) {
  if (role === ROLES.SUPER_ADMIN && !isSuperAdmin(ctx)) {
    throw new ForbiddenError("Only a super admin can grant the super admin role");
  }
}

export const UserService = {
  async list(ctx: AuthContext, query: ListUsersQuery) {
    requireOrgAdmin(ctx);
    const scope = resolveOrganizationScope(ctx, query.organizationId);

    const filter: Record<string, unknown> = { ...scope };
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: rx }, { email: rx }];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const orgNames = await organizationNameMap(users.map((u) => u.organizationId));
    const items = users.map((u) =>
      toDto(u, u.organizationId ? (orgNames.get(String(u.organizationId)) ?? null) : null),
    );

    return toPaginated(items, total, query);
  },

  async create(
    ctx: AuthContext,
    input: CreateUserInput,
    meta: { ip?: string | null } = {},
  ): Promise<UserDto> {
    requireOrgAdmin(ctx);
    assertCanAssignRole(ctx, input.role);

    // A super admin belongs to no tenant; everybody else must have one.
    let organizationId: Types.ObjectId | null = null;
    if (input.role !== ROLES.SUPER_ADMIN) {
      organizationId = resolveWriteOrganization(ctx, input.organizationId);
      const org = await Organization.findById(organizationId).select({ _id: 1 }).lean();
      if (!org) throw new NotFoundError("Organization");
    }

    if (await User.exists({ email: input.email })) {
      throw new ConflictError("An account with this email already exists", {
        email: ["Already in use"],
      });
    }

    const user = await User.create({
      organizationId,
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      status: "ACTIVE",
    });

    void AuditLogService.record({
      organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: "user.create",
      targetType: "User",
      targetId: user._id,
      metadata: { email: input.email, role: input.role },
      ip: meta.ip,
    });

    return toDto(user);
  },

  async getById(ctx: AuthContext, id: string): Promise<UserDto> {
    requireOrgAdmin(ctx);
    const user = await this.findInScope(ctx, id);
    const orgNames = await organizationNameMap([user.organizationId]);
    return toDto(
      user,
      user.organizationId ? (orgNames.get(String(user.organizationId)) ?? null) : null,
    );
  },

  async update(
    ctx: AuthContext,
    id: string,
    input: UpdateUserInput,
    meta: { ip?: string | null } = {},
  ): Promise<UserDto> {
    requireOrgAdmin(ctx);
    const target = await this.findInScope(ctx, id);

    const isSelf = String(target._id) === ctx.userId;
    if (isSelf && (input.role !== undefined || input.status !== undefined)) {
      throw new ForbiddenError("You cannot change your own role or status");
    }
    if (input.role !== undefined) assertCanAssignRole(ctx, input.role);
    if (target.role === ROLES.SUPER_ADMIN && !isSuperAdmin(ctx)) {
      throw new ForbiddenError("Only a super admin can modify a super admin");
    }

    const update: Record<string, unknown> = {};
    if (input.name !== undefined) update.name = input.name;
    if (input.role !== undefined) update.role = input.role;
    if (input.status !== undefined) update.status = input.status;
    if (input.password !== undefined) update.passwordHash = await hashPassword(input.password);

    if (input.role !== undefined && input.role !== ROLES.SUPER_ADMIN && !target.organizationId) {
      throw new ValidationError({
        role: ["This account has no organization; move it to one before changing the role"],
      });
    }

    const updated = await User.findByIdAndUpdate(
      target._id,
      { $set: update },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!updated) throw new NotFoundError("User");

    // Any change to credentials or standing invalidates existing sessions.
    if (input.password !== undefined || input.status === "SUSPENDED" || input.role !== undefined) {
      await AuthService.revokeAllSessions(target._id);
    }

    void AuditLogService.record({
      organizationId: updated.organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: "user.update",
      targetType: "User",
      targetId: updated._id,
      metadata: { changes: Object.keys(update) },
      ip: meta.ip,
    });

    return toDto(updated);
  },

  async remove(ctx: AuthContext, id: string, meta: { ip?: string | null } = {}): Promise<void> {
    requireOrgAdmin(ctx);
    const target = await this.findInScope(ctx, id);

    if (String(target._id) === ctx.userId) {
      throw new ForbiddenError("You cannot delete your own account");
    }
    if (target.role === ROLES.SUPER_ADMIN && !isSuperAdmin(ctx)) {
      throw new ForbiddenError("Only a super admin can delete a super admin");
    }

    // Never orphan a tenant: refuse to remove its last active administrator.
    if (target.organizationId && target.role === ROLES.ORGANIZATION_ADMIN) {
      const remaining = await User.countDocuments({
        organizationId: target.organizationId,
        role: ROLES.ORGANIZATION_ADMIN,
        status: "ACTIVE",
        _id: { $ne: target._id },
      });
      if (remaining === 0) {
        throw new ForbiddenError(
          "This is the last active administrator of the organization",
        );
      }
    }

    await User.deleteOne({ _id: target._id });
    await AuthService.revokeAllSessions(target._id);

    void AuditLogService.record({
      organizationId: target.organizationId,
      actorType: "USER",
      actorId: ctx.userId,
      action: "user.delete",
      targetType: "User",
      targetId: target._id,
      metadata: { email: target.email },
      ip: meta.ip,
    });
  },

  /** Load a user, enforcing that the caller is allowed to see them. */
  async findInScope(ctx: AuthContext, id: string) {
    const userId = toObjectId(id, "id");
    const user = await User.findById(userId).lean();
    if (!user) throw new NotFoundError("User");

    if (!isSuperAdmin(ctx)) {
      if (!user.organizationId || String(user.organizationId) !== ctx.organizationId) {
        // Do not confirm existence outside the caller's tenant.
        throw new NotFoundError("User");
      }
    }
    return user;
  },
};

async function organizationNameMap(
  ids: (Types.ObjectId | null)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map((id) => String(id)))];
  if (unique.length === 0) return new Map();
  const orgs = await Organization.find({ _id: { $in: unique } })
    .select({ name: 1 })
    .lean();
  return new Map(orgs.map((o) => [String(o._id), o.name]));
}
