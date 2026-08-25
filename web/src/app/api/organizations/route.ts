import { paginationSchema, searchParamsToObject } from "@/lib/pagination";
import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { created, handler, ok, readJson } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { createOrganizationSchema, OrganizationService } from "@/modules/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const params = searchParamsToObject(req.url);
  const pagination = paginationSchema.parse(params);
  return ok(await OrganizationService.list(ctx, pagination, params.search), "Organizations");
});

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  enforceRateLimit("adminWrite", ctx.userId, RATE_LIMITS.adminWrite);

  const input = createOrganizationSchema.parse(await readJson(req));
  return created(
    await OrganizationService.create(ctx, input, { ip: clientIp(req) }),
    "Organization created",
  );
});
