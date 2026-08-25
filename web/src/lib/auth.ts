/**
 * Admin (human) authentication primitives: JWT access tokens and the cookies
 * that carry them.
 *
 * Device authentication deliberately lives elsewhere (`modules/gateway`) and
 * shares nothing with this file: a device token can never satisfy an admin
 * route, and an admin JWT can never satisfy a gateway route.
 */
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { env, isProduction } from "./env";
import { UnauthorizedError } from "./errors";
import type { Role } from "@/types";

export const ACCESS_TOKEN_COOKIE = "adg_access";
export const REFRESH_TOKEN_COOKIE = "adg_refresh";

export type AccessTokenClaims = {
  sub: string;
  organizationId: string | null;
  role: Role;
  sessionId: string;
};

/** The authenticated caller, resolved once per request and passed to services. */
export type AuthContext = {
  userId: string;
  organizationId: string | null;
  role: Role;
  sessionId: string;
};

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().JWT_SECRET);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const { ACCESS_TOKEN_TTL_SECONDS, JWT_ISSUER, JWT_AUDIENCE } = env();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    organizationId: claims.organizationId,
    role: claims.role,
    sid: claims.sessionId,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<AuthContext> {
  const { JWT_ISSUER, JWT_AUDIENCE } = env();
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ["HS256"],
    }));
  } catch {
    throw new UnauthorizedError("Session expired or invalid", "INVALID_ACCESS_TOKEN");
  }

  const sub = payload.sub;
  const role = payload.role as Role | undefined;
  const sessionId = payload.sid as string | undefined;
  if (!sub || !role || !sessionId) {
    throw new UnauthorizedError("Malformed access token", "INVALID_ACCESS_TOKEN");
  }

  const organizationId = (payload.organizationId as string | null) ?? null;
  return { userId: sub, organizationId, role, sessionId };
}

type CookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
  domain?: string;
};

function cookieOptions(maxAge: number): CookieOptions {
  const { COOKIE_DOMAIN } = env();
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge,
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  };
}

export async function setSessionCookies(accessToken: string, refreshToken: string) {
  const store = await cookies();
  const { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } = env();
  store.set(ACCESS_TOKEN_COOKIE, accessToken, cookieOptions(ACCESS_TOKEN_TTL_SECONDS));
  store.set(REFRESH_TOKEN_COOKIE, refreshToken, cookieOptions(REFRESH_TOKEN_TTL_SECONDS));
}

export async function clearSessionCookies() {
  const store = await cookies();
  store.set(ACCESS_TOKEN_COOKIE, "", cookieOptions(0));
  store.set(REFRESH_TOKEN_COOKIE, "", cookieOptions(0));
}

export async function readRefreshCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_TOKEN_COOKIE)?.value ?? null;
}
