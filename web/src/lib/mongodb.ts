/**
 * Mongoose connection helper.
 *
 * Next.js hot-reloads modules in development, so the connection promise is
 * cached on `globalThis` to avoid opening a new pool on every reload and
 * exhausting MongoDB connections.
 */
import mongoose, { type Mongoose } from "mongoose";
import { env } from "./env";
import { logger } from "./logger";

type ConnectionCache = {
  conn: Mongoose | null;
  promise: Promise<Mongoose> | null;
};

const globalForMongoose = globalThis as unknown as {
  __mongooseCache?: ConnectionCache;
};

const cache: ConnectionCache = (globalForMongoose.__mongooseCache ??= {
  conn: null,
  promise: null,
});

// Reject writes that reference fields not declared in a schema.
mongoose.set("strictQuery", true);

export async function connectToDatabase(): Promise<Mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    const { MONGODB_URI, MONGODB_DB_NAME } = env();
    cache.promise = mongoose
      .connect(MONGODB_URI, {
        dbName: MONGODB_DB_NAME,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10_000,
        // Models declare their own indexes; building them automatically is
        // convenient in dev but must be an explicit migration in production.
        autoIndex: env().NODE_ENV !== "production",
      })
      .then((m) => {
        logger.info("MongoDB connected", { db: MONGODB_DB_NAME });
        return m;
      })
      .catch((err) => {
        // Clear the cached promise so the next request can retry.
        cache.promise = null;
        throw err;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

export async function disconnectFromDatabase(): Promise<void> {
  if (cache.conn) {
    await cache.conn.disconnect();
    cache.conn = null;
    cache.promise = null;
  }
}
