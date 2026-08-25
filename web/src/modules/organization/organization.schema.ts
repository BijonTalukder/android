import { z } from "zod";
import { ORGANIZATION_STATUS_VALUES } from "@/types";

export const organizationSettingsSchema = z.object({
  offlineThresholdSeconds: z.coerce.number().int().min(30).max(86_400).optional(),
  pollingIntervalSeconds: z.coerce.number().int().min(5).max(3_600).optional(),
  heartbeatIntervalSeconds: z.coerce.number().int().min(15).max(3_600).optional(),
  smsEnabled: z.boolean().optional(),
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, digits and dashes")
    .max(60)
    .optional(),
  settings: organizationSettingsSchema.optional(),
  /** Optionally provision the first organization admin in the same call. */
  admin: z
    .object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().toLowerCase().email().max(254),
      password: z.string().min(10).max(128),
    })
    .optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(ORGANIZATION_STATUS_VALUES).optional(),
    settings: organizationSettingsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
