import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { handler, ok, readJson } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { updateUserSchema, UserService } from "@/modules/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  const { id } = await params;
  return ok(await UserService.getById(ctx, id), "User");
});

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  enforceRateLimit("adminWrite", ctx.userId, RATE_LIMITS.adminWrite);

  const { id } = await params;
  const input = updateUserSchema.parse(await readJson(req));
  return ok(await UserService.update(ctx, id, input, { ip: clientIp(req) }), "User updated");
});

export const DELETE = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  enforceRateLimit("adminWrite", ctx.userId, RATE_LIMITS.adminWrite);

  const { id } = await params;
  await UserService.remove(ctx, id, { ip: clientIp(req) });
  return ok({ deleted: true }, "User deleted");
});
