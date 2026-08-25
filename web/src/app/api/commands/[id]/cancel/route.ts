import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { handler, ok } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { CommandService } from "@/modules/command";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Cancels a command that has not been claimed by the device yet. */
export const POST = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  enforceRateLimit("adminWrite", ctx.userId, RATE_LIMITS.adminWrite);

  const { id } = await params;
  return ok(await CommandService.cancel(ctx, id, { ip: clientIp(req) }), "Command cancelled");
});
