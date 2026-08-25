/**
 * Admin authentication: login, refresh-token rotation, logout, registration.
 *
 * Token model:
 *   access token  -> stateless JWT, short TTL, carries role + tenant
 *   refresh token -> opaque 256-bit secret, SHA-256 hashed in Mongo, rotated
 *                    on every use, grouped into a session chain
 *
 * Rotation means a stolen refresh token is single-use. If a token that has
 * already been rotated is presented again, the whole chain is revoked: either
 * the attacker or the legitimate client is replaying, and there is no safe way
 * to tell which, so both are logged out.
 */
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { env } from "@/lib/env";
import { ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { hashPassword, randomToken, sha256, verifyPassword } from "@/lib/crypto";
import { signAccessToken, type AuthContext } from "@/lib/auth";
import { withTransaction } from "@/lib/transaction";
import { logger } from "@/lib/logger";
import { Organization } from "@/models/Organization";
import { RefreshToken } from "@/models/RefreshToken";
import { User } from "@/models/User";
import { AuditLogService } from "@/modules/audit-log";
import { slugify } from "@/modules/organization/organization.util";
import { ROLES } from "@/types";
import { toSessionUserDto, type SessionUserDto } from "./auth.dto";
import type { LoginInput, RegisterInput } from "./auth.schema";

export type RequestMeta = { ip?: string | null; userAgent?: string | null };

export type SessionResult = {
  user: SessionUserDto;
  accessToken: string;
  refreshToken: string;
};

async function issueSession(
  user: {
    _id: Types.ObjectId;
    name: string;
    email: string;
    role: (typeof ROLES)[keyof typeof ROLES];
    status: "ACTIVE" | "SUSPENDED";
    organizationId: Types.ObjectId | null;
    lastLoginAt?: Date | null;
    createdAt: Date;
  },
  sessionId: string,
  meta: RequestMeta,
): Promise<SessionResult> {
  const organization = user.organizationId
    ? await Organization.findById(user.organizationId).select({ name: 1, slug: 1 }).lean()
    : null;

  const accessToken = await signAccessToken({
    sub: String(user._id),
    organizationId: user.organizationId ? String(user.organizationId) : null,
    role: user.role,
    sessionId,
  });

  const refreshToken = randomToken(32);
  await RefreshToken.create({
    userId: user._id,
    sessionId,
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_SECONDS * 1000),
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });

  return {
    user: toSessionUserDto(user, organization),
    accessToken,
    refreshToken,
  };
}

export const AuthService = {
  async login(input: LoginInput, meta: RequestMeta): Promise<SessionResult> {
    const user = await User.findOne({ email: input.email }).select("+passwordHash");

    // Same failure for "no such user" and "wrong password" so the endpoint
    // cannot be used to enumerate accounts.
    const invalid = new UnauthorizedError("Invalid email or password", "INVALID_CREDENTIALS");

    if (!user) {
      // Spend comparable time so timing does not reveal account existence.
      await verifyPassword(input.password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
      throw invalid;
    }

    const passwordOk = await verifyPassword(input.password, user.passwordHash);
    if (!passwordOk) throw invalid;

    if (user.status !== "ACTIVE") {
      throw new ForbiddenError("Your account is suspended");
    }

    if (user.organizationId) {
      const org = await Organization.findById(user.organizationId).select({ status: 1 }).lean();
      if (!org || org.status !== "ACTIVE") {
        throw new ForbiddenError("Your organization is suspended");
      }
    }

    user.lastLoginAt = new Date();
    await user.save();

    const session = await issueSession(user, randomUUID(), meta);

    void AuditLogService.record({
      organizationId: user.organizationId,
      actorType: "USER",
      actorId: user._id,
      actorLabel: user.email,
      action: "auth.login",
      ip: meta.ip,
    });

    return session;
  },

  /**
   * Rotate a refresh token. Returns a brand new pair and invalidates the one
   * that was presented.
   */
  async refresh(rawToken: string, meta: RequestMeta): Promise<SessionResult> {
    const tokenHash = sha256(rawToken);
    const stored = await RefreshToken.findOne({ tokenHash });

    if (!stored) throw new UnauthorizedError("Invalid session", "INVALID_REFRESH_TOKEN");

    if (stored.revokedAt) {
      // Replay of an already-rotated token: burn the whole chain.
      await RefreshToken.updateMany(
        { sessionId: stored.sessionId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      logger.warn("Refresh token replay detected; session revoked", {
        userId: String(stored.userId),
        sessionId: stored.sessionId,
      });
      void AuditLogService.record({
        actorType: "USER",
        actorId: stored.userId,
        action: "auth.refresh_replay_detected",
        metadata: { sessionId: stored.sessionId },
        ip: meta.ip,
      });
      throw new UnauthorizedError("Session revoked", "REFRESH_TOKEN_REUSED");
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError("Session expired", "REFRESH_TOKEN_EXPIRED");
    }

    const user = await User.findById(stored.userId);
    if (!user || user.status !== "ACTIVE") {
      await RefreshToken.updateMany(
        { sessionId: stored.sessionId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      throw new UnauthorizedError("Account is not active");
    }

    const session = await issueSession(user, stored.sessionId, meta);

    stored.revokedAt = new Date();
    stored.replacedByTokenHash = sha256(session.refreshToken);
    await stored.save();

    return session;
  },

  /** Revoke the whole chain the presented token belongs to. */
  async logout(rawToken: string | null, ctx?: AuthContext | null): Promise<void> {
    if (rawToken) {
      const stored = await RefreshToken.findOne({ tokenHash: sha256(rawToken) });
      if (stored) {
        await RefreshToken.updateMany(
          { sessionId: stored.sessionId, revokedAt: null },
          { $set: { revokedAt: new Date() } },
        );
        void AuditLogService.record({
          actorType: "USER",
          actorId: stored.userId,
          action: "auth.logout",
          metadata: { sessionId: stored.sessionId },
        });
        return;
      }
    }
    if (ctx) {
      await RefreshToken.updateMany(
        { sessionId: ctx.sessionId, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
    }
  },

  /** Revoke every active session of a user (password change, suspension). */
  async revokeAllSessions(userId: Types.ObjectId | string): Promise<void> {
    await RefreshToken.updateMany(
      { userId: new Types.ObjectId(String(userId)), revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  },

  async me(ctx: AuthContext): Promise<SessionUserDto> {
    const user = await User.findById(ctx.userId).lean();
    if (!user) throw new UnauthorizedError("Account no longer exists");
    const organization = user.organizationId
      ? await Organization.findById(user.organizationId).select({ name: 1, slug: 1 }).lean()
      : null;
    return toSessionUserDto(user, organization);
  },

  /**
   * Self-serve signup: creates an organization and its first
   * ORGANIZATION_ADMIN in a single transaction. Gated by
   * ALLOW_PUBLIC_REGISTRATION because most deployments invite users instead.
   */
  async register(input: RegisterInput, meta: RequestMeta): Promise<SessionResult> {
    if (!env().ALLOW_PUBLIC_REGISTRATION) {
      throw new ForbiddenError("Self-serve registration is disabled on this deployment");
    }

    const existing = await User.exists({ email: input.email });
    if (existing) {
      throw new ConflictError("An account with this email already exists", {
        email: ["Already in use"],
      });
    }

    const slug = await uniqueSlug(input.organizationName);
    const passwordHash = await hashPassword(input.password);

    const { userId, organizationId } = await withTransaction(async (session) => {
      const [organization] = await Organization.create(
        [
          {
            name: input.organizationName,
            slug,
            status: "ACTIVE",
            settings: { smsEnabled: false },
          },
        ],
        { session },
      );
      const [user] = await User.create(
        [
          {
            organizationId: organization._id,
            name: input.name,
            email: input.email,
            passwordHash,
            role: ROLES.ORGANIZATION_ADMIN,
            status: "ACTIVE",
          },
        ],
        { session },
      );
      return { userId: user._id, organizationId: organization._id };
    });

    const created = await User.findById(userId);
    if (!created) throw new ValidationError({ _root: ["Registration failed"] });

    void AuditLogService.record({
      organizationId,
      actorType: "USER",
      actorId: created._id,
      actorLabel: created.email,
      action: "auth.register",
      ip: meta.ip,
    });

    return issueSession(created, randomUUID(), meta);
  },
};

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "org";
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (!(await Organization.exists({ slug: candidate }))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
