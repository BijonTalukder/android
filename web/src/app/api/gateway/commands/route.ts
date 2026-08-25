import { searchParamsToObject } from "@/lib/pagination";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { handler, ok } from "@/lib/response";
import { claimCommandsQuerySchema } from "@/modules/command";
import { GatewayService, requireDeviceAuth } from "@/modules/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Claim pending commands for the authenticated device.
 *
 * Each returned command has already been moved out of PENDING atomically, so a
 * second concurrent poll -- from this device or any other -- cannot receive the
 * same command.
 */
export const GET = handler(async (req: Request) => {
  const device = await requireDeviceAuth(req);
  enforceRateLimit("gatewayPoll", String(device._id), RATE_LIMITS.gatewayPoll);

  const { limit } = claimCommandsQuerySchema.parse(searchParamsToObject(req.url));
  const commands = await GatewayService.fetchCommands(device, limit);

  return ok({ commands, serverTime: new Date().toISOString() }, "Commands claimed");
});
