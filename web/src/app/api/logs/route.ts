import { searchParamsToObject } from "@/lib/pagination";
import { handler, ok } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { DeviceService, listLogsQuerySchema } from "@/modules/device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const query = listLogsQuerySchema.parse(searchParamsToObject(req.url));
  return ok(await DeviceService.listLogs(ctx, query), "Logs");
});
