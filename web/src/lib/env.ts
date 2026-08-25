/**
 * Centralised, validated runtime configuration.
 *
 * Everything the platform can be tuned with lives here so no module reaches
 * into `process.env` directly. Values are read lazily on first access so that
 * importing a module in a build step does not require a full environment.
 */
import { z } from "zod";

const booleanish = z
  .string()
  .transform((v) => ["1", "true", "yes", "on"].includes(v.trim().toLowerCase()));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z.string().min(1).default("android_gateway"),

  /** Signing secret for admin access tokens. Must be >= 32 chars. */
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_ISSUER: z.string().default("android-device-gateway"),
  JWT_AUDIENCE: z.string().default("android-device-gateway-admin"),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

  /** Seconds without a heartbeat after which a device is considered OFFLINE. */
  DEVICE_OFFLINE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(180),
  /** Default lifetime of an enrollment token. */
  ENROLLMENT_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24),
  /** Default lifetime applied to a command when the caller does not set one. */
  COMMAND_DEFAULT_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 6),
  /** How long a DELIVERED/PROCESSING command may stall before it is re-queued. */
  COMMAND_CLAIM_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  /** Max delivery attempts before a stalled command is failed for good. */
  COMMAND_MAX_DELIVERY_ATTEMPTS: z.coerce.number().int().positive().default(5),

  DEFAULT_POLLING_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),

  /** Allow self-serve organization signup on /register. */
  ALLOW_PUBLIC_REGISTRATION: booleanish.default(false),
  /** Master switch for the SEND_SMS capability across the platform. */
  SMS_COMMAND_ENABLED: booleanish.default(false),

  RATE_LIMIT_ENABLED: booleanish.default(true),

  COOKIE_DOMAIN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: drop the memoised config so a new environment is picked up. */
export function resetEnvCache() {
  cached = null;
}

export const isProduction = () => env().NODE_ENV === "production";
