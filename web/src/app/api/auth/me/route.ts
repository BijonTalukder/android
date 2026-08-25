import { handler, ok } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { AuthService } from "@/modules/auth";

export const runtime = "nodejs";

export const GET = handler(async (req: Request) => {
  const ctx = await requireAuth(req);
  return ok({ user: await AuthService.me(ctx) }, "Current user");
});
