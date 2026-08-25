import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/mongodb";
import { fail, ok } from "@/lib/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + database readiness. Intentionally unauthenticated. */
export async function GET() {
  try {
    await connectToDatabase();
    await mongoose.connection.db?.admin().command({ ping: 1 });
    return ok(
      {
        status: "ok",
        database: "connected",
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      "Service healthy",
    );
  } catch {
    return fail("Service unhealthy", {
      status: 503,
      code: "UNHEALTHY",
      errors: { database: ["Unable to reach MongoDB"] },
    });
  }
}
