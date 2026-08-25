import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { handler, ok } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { DeviceService } from "@/modules/device";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Invalidate the device's API token; it must re-enroll to come back. */
export const POST = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  enforceRateLimit("adminWrite", ctx.userId, RATE_LIMITS.adminWrite);

  const { id } = await params;
  return ok(
    await DeviceService.revokeToken(ctx, id, { ip: clientIp(req) }),
    "Device token revoked",
  );
});
