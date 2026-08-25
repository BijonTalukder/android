import { searchParamsToObject } from "@/lib/pagination";
import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { created, handler, ok, readJson } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { createEnrollmentTokenSchema, DeviceService } from "@/modules/device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const { organizationId } = searchParamsToObject(req.url);
  return ok(
    await DeviceService.listEnrollmentTokens(ctx, organizationId),
    "Enrollment tokens",
  );
});

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  enforceRateLimit("adminWrite", ctx.userId, RATE_LIMITS.adminWrite);

  const input = createEnrollmentTokenSchema.parse(await readJson(req));
  return created(
    await DeviceService.createEnrollmentToken(ctx, input, { ip: clientIp(req) }),
    "Enrollment token created. Copy it now: it is not shown again.",
  );
});
