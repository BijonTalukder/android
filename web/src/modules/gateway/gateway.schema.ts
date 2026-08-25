import { z } from "zod";
import { NETWORK_TYPE_VALUES } from "@/types";

export const registerDeviceSchema = z.object({
  enrollmentToken: z.string().trim().min(4).max(64),
  device: z.object({
    /**
     * A UUID the app generates on first launch and keeps for its lifetime.
     * Deliberately app-scoped rather than IMEI/ANDROID_ID: hardware ids are
     * restricted on modern Android and are not an authentication mechanism.
     */
    installationId: z.string().trim().min(8).max(128),
    deviceName: z.string().trim().min(1).max(120),
    manufacturer: z.string().trim().max(80).optional(),
    model: z.string().trim().max(80).optional(),
    androidVersion: z.string().trim().max(32).optional(),
    sdkVersion: z.coerce.number().int().min(1).max(100).optional(),
    appVersion: z.string().trim().max(32).optional(),
  }),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const heartbeatSchema = z.object({
  batteryLevel: z.coerce.number().int().min(0).max(100).optional(),
  isCharging: z.boolean().optional(),
  networkType: z.enum(NETWORK_TYPE_VALUES).optional(),
  appVersion: z.string().trim().max(32).optional(),
});
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
