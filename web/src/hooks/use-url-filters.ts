"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Keeps table filters in the URL so a filtered view is shareable and survives
 * a reload. Returns the current values merged over `defaults`.
 */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const values = useMemo(() => {
    const out = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof T>) {
      const found = searchParams.get(String(key));
      if (found !== null) out[key] = found as T[keyof T];
    }
    return out;
  }, [defaults, searchParams]);

  const setFilters = useCallback(
    (patch: Partial<Record<keyof T, string>>, options: { resetPage?: boolean } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === "" || value === defaults[key as keyof T]) {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }
      // Any filter change invalidates the current page number.
      if (options.resetPage !== false && !("page" in patch)) next.delete("page");

      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [defaults, pathname, router, searchParams],
  );

  return { values, setFilters };
}
