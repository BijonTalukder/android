import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { handler, ok, readJson } from "@/lib/response";
import { GatewayService, heartbeatSchema, requireDeviceAuth } from "@/modules/gateway";

export const runtime = "nodejs";

export const POST = handler(async (req: Request) => {
  const device = await requireDeviceAuth(req);
  enforceRateLimit("gatewayHeartbeat", String(device._id), RATE_LIMITS.gatewayHeartbeat);

  const input = heartbeatSchema.parse(await readJson(req));
  return ok(await GatewayService.heartbeat(device, input), "Heartbeat accepted");
});
