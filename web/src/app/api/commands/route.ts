import { searchParamsToObject } from "@/lib/pagination";
import { handler, ok } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { CommandService, listCommandsQuerySchema } from "@/modules/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  const query = listCommandsQuerySchema.parse(searchParamsToObject(req.url));
  return ok(await CommandService.list(ctx, query), "Commands");
});
