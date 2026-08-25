"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";

type State<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-fetch without clearing the current data, so polling does not flicker. */
  refresh: () => void;
};

type Result<T> = { key: string; data: T | null; error: string | null };

/**
 * Fetch a GET endpoint, with optional polling.
 *
 * `path` doubles as the cache key: change the query string and the hook
 * refetches. Pass `null` to skip the request entirely.
 *
 * `loading` is *derived* from whether the last settled result belongs to the
 * current path, rather than being written from inside the effect. That keeps
 * the effect free of synchronous state updates and means a background poll or
 * a manual `refresh()` never flips the UI back into a spinner.
 */
export function useApi<T>(path: string | null, pollMs?: number): State<T> {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [nonce, setNonce] = useState(0);
  const pollRef = useRef(pollMs);
  pollRef.current = pollMs;

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (path === null) return;

    const controller = new AbortController();
    let cancelled = false;

    const load = async (silent: boolean) => {
      try {
        const data = await api.get<T>(path, silent ? undefined : controller.signal);
        if (!cancelled) setResult({ key: path, data, error: null });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        // A failed background poll keeps the last good data on screen.
        setResult((previous) => ({
          key: path,
          data: silent ? (previous?.data ?? null) : null,
          error: error instanceof ApiError ? error.message : "Something went wrong",
        }));
      }
    };

    void load(false);

    const timer = pollRef.current ? setInterval(() => void load(true), pollRef.current) : null;

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [path, nonce]);

  const settled = result?.key === path;

  return {
    // Keep the previous page's rows visible while the next query resolves.
    data: result?.data ?? null,
    error: settled ? (result?.error ?? null) : null,
    loading: path !== null && !settled,
    refresh,
  };
}
