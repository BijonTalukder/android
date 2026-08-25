import { searchParamsToObject } from "@/lib/pagination";
import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { created, handler, ok, readJson } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { createUserSchema, listUsersQuerySchema, UserService } from "@/modules/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const query = listUsersQuerySchema.parse(searchParamsToObject(req.url));
  return ok(await UserService.list(ctx, query), "Users");
});

export const POST = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  enforceRateLimit("adminWrite", ctx.userId, RATE_LIMITS.adminWrite);

  const input = createUserSchema.parse(await readJson(req));
  return created(await UserService.create(ctx, input, { ip: clientIp(req) }), "User created");
});
