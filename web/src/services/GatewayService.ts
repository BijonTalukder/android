/** Stable import path for the gateway service. See `services/DeviceService.ts`. */
export { GatewayService } from "@/modules/gateway/gateway.service";
export { requireDeviceAuth, type DeviceAuthContext } from "@/modules/gateway/device-auth";
export {
  getCommandTransport,
  type CommandTransport,
  type DispatchResult,
} from "@/modules/gateway/transport";
