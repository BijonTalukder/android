import { handler, ok } from "@/lib/response";
import { GatewayService, requireDeviceAuth } from "@/modules/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lets the app re-sync its configuration without waiting for a heartbeat. */
export const GET = handler(async (req: Request) => {
  const device = await requireDeviceAuth(req);
  const config = await GatewayService.resolveConfig(device);
  return ok(
    {
      config,
      device: { id: String(device._id), deviceId: device.deviceId, deviceName: device.deviceName },
      serverTime: new Date().toISOString(),
    },
    "Device configuration",
  );
});
