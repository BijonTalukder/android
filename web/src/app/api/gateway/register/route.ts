import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { created, handler, readJson } from "@/lib/response";
import { GatewayService, registerDeviceSchema } from "@/modules/gateway";

export const runtime = "nodejs";

/**
 * Device enrollment. Authenticated by the enrollment code in the body, not by
 * a session -- this is the only gateway route without a device token.
 */
export const POST = handler(async (req: Request) => {
  enforceRateLimit("gatewayRegister", clientIp(req), RATE_LIMITS.gatewayRegister);

  const input = registerDeviceSchema.parse(await readJson(req));
  const result = await GatewayService.register(input, { ip: clientIp(req) });

  return created(result, "Device enrolled");
});
