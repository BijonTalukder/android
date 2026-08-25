/**
 * In-process fixed-window rate limiter.
 *
 * Deliberately simple and honest about its limits: the counters live in the
 * Node process, so they do not survive a restart and are per-instance. That is
 * adequate for a single-node MVP and for blunting credential stuffing. Swap
 * `consume()` for a Redis/Upstash implementation before running more than one
 * instance -- no caller needs to change.
 */
import { env } from "./env";
import { RateLimitError } from "./errors";

type Bucket = { count: number; resetAt: number };

const globalForLimiter = globalThis as unknown as {
  __rateLimitBuckets?: Map<string, Bucket>;
};
const buckets: Map<string, Bucket> = (globalForLimiter.__rateLimitBuckets ??= new Map());

let lastSweep = 0;
function sweep(now: number) {
  // Amortised cleanup so the map cannot grow without bound.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitRule = { limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  register: { limit: 5, windowSeconds: 3600 },
  refresh: { limit: 60, windowSeconds: 300 },
  gatewayRegister: { limit: 20, windowSeconds: 600 },
  gatewayHeartbeat: { limit: 240, windowSeconds: 300 },
  gatewayPoll: { limit: 600, windowSeconds: 300 },
  adminWrite: { limit: 300, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Throws `RateLimitError` when the caller exceeds the rule. */
export function enforceRateLimit(scope: string, identity: string, rule: RateLimitRule) {
  if (!env().RATE_LIMIT_ENABLED) return;

  const now = Date.now();
  sweep(now);

  const key = `${scope}:${identity}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowSeconds * 1000 });
    return;
  }

  existing.count += 1;
  if (existing.count > rule.limit) {
    throw new RateLimitError(Math.max(1, Math.ceil((existing.resetAt - now) / 1000)));
  }
}

/** Best-effort client IP from the usual proxy headers. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test helper. */
export function resetRateLimits() {
  buckets.clear();
}
