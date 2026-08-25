import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { handler, ok, readJson } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { DeviceService, updateDeviceSchema } from "@/modules/device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  const { id } = await params;
  return ok(await DeviceService.getById(ctx, id), "Device");
});

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  enforceRateLimit("adminWrite", ctx.userId, RATE_LIMITS.adminWrite);

  const { id } = await params;
  const input = updateDeviceSchema.parse(await readJson(req));
  return ok(
    await DeviceService.update(ctx, id, input, { ip: clientIp(req) }),
    "Device updated",
  );
});

export const DELETE = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  enforceRateLimit("adminWrite", ctx.userId, RATE_LIMITS.adminWrite);

  const { id } = await params;
  await DeviceService.remove(ctx, id, { ip: clientIp(req) });
  return ok({ deleted: true }, "Device deleted");
});
