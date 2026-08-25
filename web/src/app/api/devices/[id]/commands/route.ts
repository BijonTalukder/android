import { searchParamsToObject } from "@/lib/pagination";
import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { created, handler, ok, readJson } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { CommandService, createCommandSchema, listCommandsQuerySchema } from "@/modules/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  const { id } = await params;
  const query = listCommandsQuerySchema.parse({
    ...searchParamsToObject(req.url),
    deviceId: id,
  });
  return ok(await CommandService.list(ctx, query), "Device commands");
});

export const POST = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  enforceRateLimit("adminWrite", ctx.userId, RATE_LIMITS.adminWrite);

  const { id } = await params;
  const input = createCommandSchema.parse(await readJson(req));
  return created(
    await CommandService.create(ctx, id, input, { ip: clientIp(req) }),
    "Command queued",
  );
});
