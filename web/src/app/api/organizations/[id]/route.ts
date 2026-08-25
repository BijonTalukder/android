import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { handler, ok, readJson } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { OrganizationService, updateOrganizationSchema } from "@/modules/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  const { id } = await params;
  return ok(await OrganizationService.getById(ctx, id), "Organization");
});

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  enforceRateLimit("adminWrite", ctx.userId, RATE_LIMITS.adminWrite);

  const { id } = await params;
  const input = updateOrganizationSchema.parse(await readJson(req));
  return ok(
    await OrganizationService.update(ctx, id, input, { ip: clientIp(req) }),
    "Organization updated",
  );
});
