/**
 * Role-based authorization and tenant scoping.
 *
 * Every service that touches tenant data takes its organization filter from
 * `resolveOrganizationScope`, never from a raw client-supplied id. A
 * SUPER_ADMIN may target another tenant explicitly; anybody else is pinned to
 * their own, and an attempt to reach across is a 403, not an empty result.
 */
import { Types } from "mongoose";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth";
import { ROLES, type Role } from "@/types";

export function hasRole(ctx: AuthContext, ...roles: Role[]): boolean {
  return roles.includes(ctx.role);
}

export function requireRole(ctx: AuthContext, ...roles: Role[]): void {
  if (!hasRole(ctx, ...roles)) {
    throw new ForbiddenError("You do not have permission to perform this action");
  }
}

export const isSuperAdmin = (ctx: AuthContext) => ctx.role === ROLES.SUPER_ADMIN;

/** SUPER_ADMIN or ORGANIZATION_ADMIN: everything except platform administration. */
export function requireOrgAdmin(ctx: AuthContext): void {
  requireRole(ctx, ROLES.SUPER_ADMIN, ROLES.ORGANIZATION_ADMIN);
}

export function requireSuperAdmin(ctx: AuthContext): void {
  requireRole(ctx, ROLES.SUPER_ADMIN);
}

export function toObjectId(value: string, field = "id"): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new ValidationError({ [field]: ["Invalid identifier"] });
  }
  return new Types.ObjectId(value);
}

/**
 * The organization filter fragment for a query.
 *
 * - Tenant user: always their own organization, `requested` must match or be absent.
 * - SUPER_ADMIN: the requested organization, or no filter at all (all tenants).
 */
export function resolveOrganizationScope(
  ctx: AuthContext,
  requested?: string | null,
): { organizationId?: Types.ObjectId } {
  if (isSuperAdmin(ctx)) {
    if (!requested) return {};
    return { organizationId: toObjectId(requested, "organizationId") };
  }

  if (!ctx.organizationId) {
    throw new ForbiddenError("Account is not attached to an organization");
  }

  if (requested && requested !== ctx.organizationId) {
    throw new ForbiddenError("Cross-organization access is not allowed");
  }

  return { organizationId: new Types.ObjectId(ctx.organizationId) };
}

/**
 * The organization a write should land in. Unlike a read scope this can never
 * be "all tenants", so a SUPER_ADMIN must name one.
 */
export function resolveWriteOrganization(
  ctx: AuthContext,
  requested?: string | null,
): Types.ObjectId {
  if (isSuperAdmin(ctx)) {
    if (!requested) {
      throw new ValidationError({
        organizationId: ["A super admin must specify the target organization"],
      });
    }
    return toObjectId(requested, "organizationId");
  }

  if (!ctx.organizationId) {
    throw new ForbiddenError("Account is not attached to an organization");
  }
  if (requested && requested !== ctx.organizationId) {
    throw new ForbiddenError("Cross-organization access is not allowed");
  }
  return new Types.ObjectId(ctx.organizationId);
}
