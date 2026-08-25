/**
 * Transaction helper that degrades gracefully.
 *
 * MongoDB multi-document transactions require a replica set or a sharded
 * cluster. A developer running a standalone `mongod` still has to be able to
 * boot the app, so this helper probes the topology once and, when transactions
 * are unavailable, runs the callback without a session.
 *
 * Callers must therefore treat the atomicity as best-effort and keep their own
 * compensating logic (unique indexes, idempotent writes) rather than relying on
 * rollback. Production deployments should use a replica set.
 */
import mongoose, { type ClientSession } from "mongoose";
import { connectToDatabase } from "./mongodb";
import { logger } from "./logger";

let transactionsSupported: boolean | null = null;

async function supportsTransactions(): Promise<boolean> {
  if (transactionsSupported !== null) return transactionsSupported;

  await connectToDatabase();
  try {
    const admin = mongoose.connection.db?.admin();
    const info = (await admin?.command({ hello: 1 })) as
      | { setName?: string; msg?: string }
      | undefined;
    transactionsSupported = Boolean(info?.setName) || info?.msg === "isdbgrid";
  } catch (error) {
    logger.warn("Could not determine MongoDB topology; assuming standalone", { error });
    transactionsSupported = false;
  }

  if (!transactionsSupported) {
    logger.warn(
      "MongoDB is standalone: multi-document transactions are disabled. " +
        "Use a replica set in production.",
    );
  }
  return transactionsSupported;
}

/**
 * Run `fn` inside a transaction when the deployment supports one.
 * `session` is `null` in the degraded path; pass it straight through to your
 * model calls, which accept `{ session: null }` without complaint.
 */
export async function withTransaction<T>(
  fn: (session: ClientSession | null) => Promise<T>,
): Promise<T> {
  if (!(await supportsTransactions())) {
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}

/** Test helper: forget the cached topology probe. */
export function resetTransactionSupportCache() {
  transactionsSupported = null;
}
