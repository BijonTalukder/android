import { handler, ok } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { DashboardService } from "@/modules/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  return ok(await DashboardService.summary(ctx), "Dashboard summary");
});
