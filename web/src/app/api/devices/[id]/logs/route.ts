import { searchParamsToObject } from "@/lib/pagination";
import { handler, ok } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { DeviceService, listDeviceLogsQuerySchema } from "@/modules/device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  const { id } = await params;
  const query = listDeviceLogsQuerySchema.parse(searchParamsToObject(req.url));
  return ok(await DeviceService.listDeviceLogs(ctx, id, query), "Device logs");
});
