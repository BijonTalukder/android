import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email("Enter a valid email address");

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((v) => /[a-z]/.test(v), "Password must contain a lowercase letter")
  .refine((v) => /[A-Z]/.test(v), "Password must contain an uppercase letter")
  .refine((v) => /[0-9]/.test(v), "Password must contain a digit");

export const loginSchema = z.object({
  email: emailSchema,
  // Not `passwordSchema`: login must not leak the policy, and legacy passwords
  // that predate a policy change still have to be able to sign in.
  password: z.string().min(1, "Password is required").max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
