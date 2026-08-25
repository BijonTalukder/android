/**
 * Admin request authentication.
 *
 * Resolves an `AuthContext` from the access-token cookie (dashboard) or an
 * `Authorization: Bearer` header (API clients / scripts), then re-checks the
 * live account so a suspended user or organization loses access immediately
 * rather than at the end of the token's lifetime.
 *
 * NOTE: this is a plain async helper, not Next.js `middleware.ts` edge
 * middleware. Route handlers call it explicitly, which keeps the DB-backed
 * checks on the Node runtime where Mongoose can run.
 */
import type { Types } from "mongoose";
import { ACCESS_TOKEN_COOKIE, verifyAccessToken, type AuthContext } from "@/lib/auth";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { Organization } from "@/models/Organization";
import { User } from "@/models/User";
import { ROLES } from "@/types";

function readBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!value || scheme.toLowerCase() !== "bearer") return null;
  return value.trim();
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const token = readCookie(req, ACCESS_TOKEN_COOKIE) ?? readBearer(req);
  if (!token) throw new UnauthorizedError();

  const context = await verifyAccessToken(token);

  const user = await User.findById(context.userId)
    .select({ status: 1, role: 1, organizationId: 1 })
    .lean();

  if (!user) throw new UnauthorizedError("Account no longer exists");
  if (user.status !== "ACTIVE") throw new ForbiddenError("Your account is suspended");

  // Trust the database over the token for role and tenant: a role change or a
  // tenant move must take effect without waiting for the token to expire.
  const organizationId = user.organizationId ? String(user.organizationId) : null;

  if (organizationId) {
    const org = await Organization.findById(organizationId).select({ status: 1 }).lean();
    if (!org) throw new UnauthorizedError("Organization no longer exists");
    if (org.status !== "ACTIVE") {
      throw new ForbiddenError("Your organization is suspended");
    }
  } else if (user.role !== ROLES.SUPER_ADMIN) {
    // Any non-super-admin must belong to a tenant; a null tenant is corrupt data.
    throw new ForbiddenError("Account is not attached to an organization");
  }

  return {
    userId: String(user._id as Types.ObjectId),
    organizationId,
    role: user.role,
    sessionId: context.sessionId,
  };
}
