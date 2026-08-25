/**
 * Derives ONLINE/OFFLINE from heartbeat recency.
 *
 * The MVP has no guaranteed cron runner, so presence is evaluated lazily: any
 * read path that cares about status calls `sweepStaleDevices()` first. The
 * sweep is a single indexed `updateMany`, and is throttled per scope so a burst
 * of dashboard requests cannot turn into a burst of writes.
 */
import { Types } from "mongoose";
import { env } from "@/lib/env";
import { Device } from "@/models/Device";
import { Organization } from "@/models/Organization";
import { logger } from "@/lib/logger";

const SWEEP_MIN_INTERVAL_MS = 5_000;

const globalForSweep = globalThis as unknown as {
  __deviceSweepAt?: Map<string, number>;
};
const lastSweepAt: Map<string, number> = (globalForSweep.__deviceSweepAt ??= new Map());

function cutoff(thresholdSeconds: number): Date {
  return new Date(Date.now() - thresholdSeconds * 1000);
}

async function markOffline(filter: Record<string, unknown>): Promise<number> {
  const result = await Device.updateMany(filter, { $set: { status: "OFFLINE" } });
  return result.modifiedCount ?? 0;
}

/**
 * Flip ONLINE devices whose last heartbeat is older than their organization's
 * threshold to OFFLINE. Pass an organization to limit the scope; omit it to
 * sweep the whole platform (super-admin views).
 *
 * BLOCKED and INACTIVE are administrative states and are never touched.
 */
export async function sweepStaleDevices(
  organizationId?: Types.ObjectId | null,
): Promise<number> {
  const scopeKey = organizationId ? String(organizationId) : "__all__";
  const now = Date.now();
  const previous = lastSweepAt.get(scopeKey) ?? 0;
  if (now - previous < SWEEP_MIN_INTERVAL_MS) return 0;
  lastSweepAt.set(scopeKey, now);

  try {
    const defaultThreshold = env().DEVICE_OFFLINE_THRESHOLD_SECONDS;

    if (organizationId) {
      const org = await Organization.findById(organizationId)
        .select({ "settings.offlineThresholdSeconds": 1 })
        .lean();
      const threshold = org?.settings?.offlineThresholdSeconds ?? defaultThreshold;
      return await markOffline({
        organizationId,
        status: "ONLINE",
        lastSeenAt: { $lt: cutoff(threshold) },
      });
    }

    // Platform-wide: organizations with a custom threshold are handled
    // individually, everyone else in one pass against the default.
    const overrides = await Organization.find({
      "settings.offlineThresholdSeconds": { $exists: true, $ne: null },
    })
      .select({ "settings.offlineThresholdSeconds": 1 })
      .lean();

    let modified = await markOffline({
      status: "ONLINE",
      lastSeenAt: { $lt: cutoff(defaultThreshold) },
      ...(overrides.length
        ? { organizationId: { $nin: overrides.map((o) => o._id) } }
        : {}),
    });

    for (const org of overrides) {
      modified += await markOffline({
        organizationId: org._id,
        status: "ONLINE",
        lastSeenAt: {
          $lt: cutoff(org.settings!.offlineThresholdSeconds ?? defaultThreshold),
        },
      });
    }

    return modified;
  } catch (error) {
    // Presence is advisory; never fail the caller's read because of it.
    logger.error("Device presence sweep failed", { error });
    return 0;
  }
}

/** Test helper. */
export function resetPresenceSweepThrottle() {
  lastSweepAt.clear();
}
