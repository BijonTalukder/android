import { z } from "zod";
import { ROLE_VALUES, USER_STATUS_VALUES } from "@/types";
import { emailSchema, passwordSchema } from "@/modules/auth/auth.schema";
import { paginationSchema } from "@/lib/pagination";

export const listUsersQuerySchema = paginationSchema.extend({
  organizationId: z.string().optional(),
  role: z.enum(ROLE_VALUES).optional(),
  status: z.enum(USER_STATUS_VALUES).optional(),
  search: z.string().trim().max(120).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(ROLE_VALUES),
  organizationId: z.string().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    role: z.enum(ROLE_VALUES).optional(),
    status: z.enum(USER_STATUS_VALUES).optional(),
    password: passwordSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
