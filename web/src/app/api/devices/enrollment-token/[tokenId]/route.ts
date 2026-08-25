import { clientIp } from "@/lib/rate-limit";
import { handler, ok } from "@/lib/response";
import { requireAuth } from "@/middleware/auth.middleware";
import { DeviceService } from "@/modules/device";

export const runtime = "nodejs";

type Params = { params: Promise<{ tokenId: string }> };

export const DELETE = handler(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req);
  const { tokenId } = await params;
  await DeviceService.revokeEnrollmentToken(ctx, tokenId, { ip: clientIp(req) });
  return ok({ revoked: true }, "Enrollment token revoked");
});
