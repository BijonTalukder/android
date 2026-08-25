/**
 * Token generation and hashing primitives.
 *
 * Two different hashing strategies are in play, on purpose:
 *
 *  - Passwords are low entropy and user chosen, so they get bcrypt (slow,
 *    salted).
 *  - Device API tokens, refresh tokens and enrollment tokens are 128+ bits of
 *    CSPRNG output. They get SHA-256, which is deterministic and therefore
 *    indexable, and needs no work factor because brute-forcing the preimage of
 *    a random 128-bit secret is not feasible.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** URL-safe random secret. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Short opaque identifier used as an indexable handle for a secret. */
export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString("hex");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Crockford base32 alphabet minus I, L, O, U so a human can retype an
 * enrollment code from a screen without ambiguity.
 */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Human-enterable code, e.g. `K4M2-9QTX-B3RD`. */
export function generateEnrollmentCode(groups = 3, groupSize = 4): string {
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) {
    let part = "";
    for (let i = 0; i < groupSize; i++) {
      part += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
    }
    parts.push(part);
  }
  return parts.join("-");
}

/** Accept a code typed with lowercase letters, spaces or missing dashes. */
export function normalizeEnrollmentCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return cleaned.replace(/(.{4})(?=.)/g, "$1-");
}

export const DEVICE_TOKEN_PREFIX = "adgd";

/**
 * Device API token: `adgd_<tokenId>_<secret>`.
 *
 * `tokenId` is stored in plaintext and indexed so verification is a single
 * point lookup; only the secret half is hashed. This avoids scanning every
 * device document on each gateway request.
 */
export function generateDeviceToken(): {
  token: string;
  tokenId: string;
  tokenHash: string;
} {
  const tokenId = randomId(12);
  const secret = randomToken(32);
  return {
    token: `${DEVICE_TOKEN_PREFIX}_${tokenId}_${secret}`,
    tokenId,
    tokenHash: sha256(secret),
  };
}

export function parseDeviceToken(
  token: string,
): { tokenId: string; secret: string } | null {
  // Split on the FIRST two underscores only. The secret is base64url, whose
  // alphabet includes `_`, so a naive `split("_")` rejects roughly half of all
  // valid tokens.
  const first = token.indexOf("_");
  if (first === -1) return null;
  const second = token.indexOf("_", first + 1);
  if (second === -1) return null;

  const prefix = token.slice(0, first);
  const tokenId = token.slice(first + 1, second);
  const secret = token.slice(second + 1);

  if (prefix !== DEVICE_TOKEN_PREFIX || !secret) return null;
  if (!/^[0-9a-f]{24}$/.test(tokenId)) return null;
  return { tokenId, secret };
}
