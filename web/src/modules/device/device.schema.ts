import { z } from "zod";
import { paginationSchema } from "@/lib/pagination";
import { DEVICE_STATUS_VALUES } from "@/types";

export const listDevicesQuerySchema = paginationSchema.extend({
  organizationId: z.string().optional(),
  status: z.enum(DEVICE_STATUS_VALUES).optional(),
  search: z.string().trim().max(120).optional(),
  sort: z.enum(["lastSeenAt", "createdAt", "deviceName"]).default("lastSeenAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListDevicesQuery = z.infer<typeof listDevicesQuerySchema>;

export const deviceConfigSchema = z.object({
  pollingIntervalSeconds: z.coerce.number().int().min(5).max(3_600),
  heartbeatIntervalSeconds: z.coerce.number().int().min(15).max(3_600),
});
export type DeviceConfigInput = z.infer<typeof deviceConfigSchema>;

export const updateDeviceSchema = z
  .object({
    deviceName: z.string().trim().min(1).max(120).optional(),
    config: deviceConfigSchema.partial().optional(),
    /**
     * Only the administrative statuses are settable. ONLINE/OFFLINE are
     * derived from heartbeats and can never be written by an admin.
     */
    status: z.enum(["BLOCKED", "INACTIVE", "OFFLINE"]).optional(),
    blockedReason: z.string().trim().max(400).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;

export const createEnrollmentTokenSchema = z.object({
  organizationId: z.string().optional(),
  deviceNameHint: z.string().trim().min(1).max(120).optional(),
  maxUses: z.coerce.number().int().min(1).max(500).default(1),
  expiresInSeconds: z.coerce
    .number()
    .int()
    .min(300)
    .max(60 * 60 * 24 * 30)
    .optional(),
});
export type CreateEnrollmentTokenInput = z.infer<typeof createEnrollmentTokenSchema>;

export const listDeviceLogsQuerySchema = paginationSchema.extend({
  level: z.enum(["INFO", "WARNING", "ERROR"]).optional(),
  event: z.string().trim().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListDeviceLogsQuery = z.infer<typeof listDeviceLogsQuerySchema>;

/** Organization-wide log feed (the Logs page), optionally filtered by device. */
export const listLogsQuerySchema = listDeviceLogsQuerySchema.extend({
  organizationId: z.string().optional(),
  deviceId: z.string().optional(),
  search: z.string().trim().max(200).optional(),
});
export type ListLogsQuery = z.infer<typeof listLogsQuerySchema>;
