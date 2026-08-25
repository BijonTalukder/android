"use client";

/**
 * Browser API client.
 *
 * The dashboard talks to the platform over the same public REST API the
 * Android app uses -- there is no private server-side back door. That keeps
 * the API the single contract and means the whole UI keeps working if the
 * backend is later extracted onto its own host.
 *
 * Access tokens are short lived, so a 401 triggers one silent refresh and a
 * single retry. Concurrent 401s share one refresh in flight rather than
 * stampeding the endpoint.
 */
import type { ApiResponseBody } from "@/types";

export class ApiError extends Error {
  readonly status: number;
  readonly errors: Record<string, string[]>;
  readonly code?: string;

  constructor(
    message: string,
    status: number,
    errors: Record<string, string[]> = {},
    code?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
    this.code = code;
  }

  /** First message for a field, for inline form errors. */
  fieldError(field: string): string | undefined {
    return this.errors[field]?.[0];
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Internal: prevents a refresh loop. */
  _retried?: boolean;
};

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Release the shared promise on the next tick so concurrent callers
      // awaiting this one all observe the same result first.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal, _retried = false } = options;

  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });

  let payload: ApiResponseBody<T> | null = null;
  try {
    payload = (await response.json()) as ApiResponseBody<T>;
  } catch {
    payload = null;
  }

  if (response.status === 401 && !_retried && path !== "/api/auth/refresh") {
    if (await refreshSession()) {
      return apiFetch<T>(path, { ...options, _retried: true });
    }
  }

  if (!response.ok || !payload || payload.success === false) {
    const failure = payload && payload.success === false ? payload : null;
    throw new ApiError(
      failure?.message ?? `Request failed with status ${response.status}`,
      response.status,
      failure?.errors ?? {},
      failure?.code,
    );
  }

  return payload.data;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiFetch<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

/** Build a query string, dropping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}
