import { handler, ok } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { CommandService } from "@/modules/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  const { id } = await params;
  return ok(await CommandService.getById(ctx, id), "Command");
});
