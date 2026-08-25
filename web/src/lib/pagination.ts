import { z } from "zod";
import type { Paginated } from "@/types";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export function toPaginated<T>(
  items: T[],
  total: number,
  { page, limit }: PaginationInput,
): Paginated<T> {
  return {
    items,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/** Turn `URLSearchParams` into a plain object Zod can parse. */
export function searchParamsToObject(url: string): Record<string, string> {
  const params = new URL(url).searchParams;
  const out: Record<string, string> = {};
  for (const [key, value] of params) {
    if (value !== "") out[key] = value;
  }
  return out;
}
