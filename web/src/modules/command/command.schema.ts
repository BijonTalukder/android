import { z } from "zod";
import { paginationSchema } from "@/lib/pagination";
import {
  COMMAND_PRIORITY_VALUES,
  COMMAND_STATUS_VALUES,
  COMMAND_TYPE_VALUES,
} from "@/types";

/* ------------------------------------------------------------------ */
/* Per-type payload contracts                                          */
/*                                                                     */
/* These are the single source of truth for what a command may carry.  */
/* The Android handlers mirror them; keep the two in step.             */
/* ------------------------------------------------------------------ */

export const getDeviceStatusPayloadSchema = z.object({}).strict();

export const syncNowPayloadSchema = z
  .object({
    /** Optional hint the app may use to scope the sync. */
    scope: z.enum(["ALL", "CONFIG", "RESULTS"]).default("ALL"),
  })
  .strict();

export const updateConfigPayloadSchema = z
  .object({
    pollingIntervalSeconds: z.coerce.number().int().min(5).max(3_600).optional(),
    heartbeatIntervalSeconds: z.coerce.number().int().min(15).max(3_600).optional(),
  })
  .strict()
  .refine(
    (v) => v.pollingIntervalSeconds !== undefined || v.heartbeatIntervalSeconds !== undefined,
    "Provide at least one configuration value",
  );

/**
 * SMS destination.
 *
 * Accepts E.164 (`+8801712345678`) or a national number of 6-15 digits. It is
 * deliberately permissive about country conventions and deliberately strict
 * about characters: no letters, no shortcode-style separators. The device
 * performs the authoritative validation against the SIM's own rules.
 */
export const smsDestinationSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{6,15}$/, "Enter a valid phone number in E.164 or national format");

/**
 * 1530 characters is 10 concatenated GSM-7 segments. Anything longer is almost
 * always a mistake and is expensive on every carrier.
 */
export const smsMessageSchema = z
  .string()
  .min(1, "Message cannot be empty")
  .max(1_530, "Message is too long (maximum 10 SMS segments)");

export const sendSmsPayloadSchema = z
  .object({
    destination: smsDestinationSchema,
    message: smsMessageSchema,
    /** Optional SIM subscription id; the app falls back to the default SIM. */
    subscriptionId: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export const COMMAND_PAYLOAD_SCHEMAS = {
  GET_DEVICE_STATUS: getDeviceStatusPayloadSchema,
  SYNC_NOW: syncNowPayloadSchema,
  UPDATE_CONFIG: updateConfigPayloadSchema,
  SEND_SMS: sendSmsPayloadSchema,
} as const;

/* ------------------------------------------------------------------ */
/* Request schemas                                                     */
/* ------------------------------------------------------------------ */

export const createCommandSchema = z.object({
  type: z.enum(COMMAND_TYPE_VALUES),
  payload: z.record(z.string(), z.unknown()).default({}),
  priority: z.enum(COMMAND_PRIORITY_VALUES).default("NORMAL"),
  expiresInSeconds: z.coerce
    .number()
    .int()
    .min(30)
    .max(60 * 60 * 24 * 7)
    .optional(),
});
export type CreateCommandInput = z.infer<typeof createCommandSchema>;

export const listCommandsQuerySchema = paginationSchema.extend({
  organizationId: z.string().optional(),
  deviceId: z.string().optional(),
  type: z.enum(COMMAND_TYPE_VALUES).optional(),
  status: z.enum(COMMAND_STATUS_VALUES).optional(),
  priority: z.enum(COMMAND_PRIORITY_VALUES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListCommandsQuery = z.infer<typeof listCommandsQuerySchema>;

export const claimCommandsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
export type ClaimCommandsQuery = z.infer<typeof claimCommandsQuerySchema>;

export const commandResultSchema = z
  .object({
    /** PROCESSING is an acknowledgement; the other two are terminal. */
    status: z.enum(["PROCESSING", "SUCCESS", "FAILED"]),
    /** Echoed back from the claim so a stale retry can be detected. */
    claimId: z.string().trim().min(1).max(64).optional(),
    result: z.record(z.string(), z.unknown()).nullish(),
    error: z
      .object({
        code: z.string().trim().min(1).max(64),
        message: z.string().trim().min(1).max(1_000),
      })
      .nullish(),
  })
  .refine(
    (v) => v.status !== "FAILED" || Boolean(v.error),
    { message: "A failed command must include an error", path: ["error"] },
  );
export type CommandResultInput = z.infer<typeof commandResultSchema>;
