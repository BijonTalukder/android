/**
 * Keeps the command queue honest without a cron runner.
 *
 * Two problems need sweeping:
 *
 *  1. A PENDING command whose `expiresAt` has passed must not be handed to a
 *     device that comes back online days later.
 *  2. A command that was claimed but never acknowledged (app killed, network
 *     dropped between claim and execution) would otherwise sit in DELIVERED
 *     forever.
 *
 * For (2) the command goes back to PENDING so another poll can pick it up,
 * bounded by `COMMAND_MAX_DELIVERY_ATTEMPTS`. The claim id changes on every
 * re-claim, so a late result carrying the old claim id is rejected rather than
 * being applied to a command that has since been re-executed.
 */
import type { Types } from "mongoose";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { DeviceCommand } from "@/models/DeviceCommand";
import { COMMAND_STATUS } from "@/types";

const SWEEP_MIN_INTERVAL_MS = 5_000;

const globalForReaper = globalThis as unknown as {
  __commandSweepAt?: Map<string, number>;
};
const lastSweepAt: Map<string, number> = (globalForReaper.__commandSweepAt ??= new Map());

export type SweepResult = { expired: number; requeued: number; abandoned: number };

/**
 * @param organizationId limit the sweep to one tenant, or omit for platform-wide.
 * @param force skip the throttle (used on the gateway poll path, which must
 *              always see an accurate queue).
 */
export async function sweepCommands(
  organizationId?: Types.ObjectId | null,
  force = false,
): Promise<SweepResult> {
  const empty: SweepResult = { expired: 0, requeued: 0, abandoned: 0 };
  const scopeKey = organizationId ? String(organizationId) : "__all__";
  const now = Date.now();

  if (!force) {
    const previous = lastSweepAt.get(scopeKey) ?? 0;
    if (now - previous < SWEEP_MIN_INTERVAL_MS) return empty;
  }
  lastSweepAt.set(scopeKey, now);

  const scope = organizationId ? { organizationId } : {};
  const nowDate = new Date(now);
  const { COMMAND_CLAIM_TIMEOUT_SECONDS, COMMAND_MAX_DELIVERY_ATTEMPTS } = env();
  const staleClaimBefore = new Date(now - COMMAND_CLAIM_TIMEOUT_SECONDS * 1000);

  try {
    const expired = await DeviceCommand.updateMany(
      {
        ...scope,
        status: COMMAND_STATUS.PENDING,
        expiresAt: { $ne: null, $lte: nowDate },
      },
      {
        $set: {
          status: COMMAND_STATUS.EXPIRED,
          error: { code: "COMMAND_EXPIRED", message: "Command expired before delivery" },
        },
      },
    );

    // Stalled claims that still have attempts left go back on the queue.
    const requeued = await DeviceCommand.updateMany(
      {
        ...scope,
        status: { $in: [COMMAND_STATUS.DELIVERED, COMMAND_STATUS.PROCESSING] },
        claimedAt: { $ne: null, $lte: staleClaimBefore },
        deliveryAttempts: { $lt: COMMAND_MAX_DELIVERY_ATTEMPTS },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: nowDate } }],
      },
      {
        $set: {
          status: COMMAND_STATUS.PENDING,
          claimId: null,
          claimedAt: null,
          sentAt: null,
        },
      },
    );

    // Out of attempts, or expired while in flight: give up for good.
    const abandoned = await DeviceCommand.updateMany(
      {
        ...scope,
        status: { $in: [COMMAND_STATUS.DELIVERED, COMMAND_STATUS.PROCESSING] },
        claimedAt: { $ne: null, $lte: staleClaimBefore },
        $or: [
          { deliveryAttempts: { $gte: COMMAND_MAX_DELIVERY_ATTEMPTS } },
          { expiresAt: { $ne: null, $lte: nowDate } },
        ],
      },
      {
        $set: {
          status: COMMAND_STATUS.FAILED,
          error: {
            code: "DELIVERY_TIMEOUT",
            message: "Device never acknowledged the command",
          },
          executedAt: nowDate,
        },
      },
    );

    const result: SweepResult = {
      expired: expired.modifiedCount ?? 0,
      requeued: requeued.modifiedCount ?? 0,
      abandoned: abandoned.modifiedCount ?? 0,
    };

    if (result.expired || result.requeued || result.abandoned) {
      logger.info("Command sweep", { scope: scopeKey, ...result });
    }
    return result;
  } catch (error) {
    logger.error("Command sweep failed", { error, scope: scopeKey });
    return empty;
  }
}

/** Test helper. */
export function resetCommandSweepThrottle() {
  lastSweepAt.clear();
}
