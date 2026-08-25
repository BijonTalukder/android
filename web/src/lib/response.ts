/**
 * Standard API envelope plus the route-handler wrapper.
 *
 * Route handlers stay thin because `handler()` owns the cross-cutting
 * concerns: DB connection, error translation and response shaping.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import mongoose from "mongoose";
import { AppError, RateLimitError, ValidationError, type FieldErrors } from "./errors";
import { connectToDatabase } from "./mongodb";
import { logger } from "./logger";
import { isProduction } from "./env";
import type { ApiFailure, ApiSuccess } from "@/types";

export function ok<T>(
  data: T,
  message = "Success",
  init?: { status?: number; headers?: HeadersInit },
): NextResponse<ApiSuccess<T>> {
  return NextResponse.json(
    { success: true as const, data, message },
    { status: init?.status ?? 200, headers: init?.headers },
  );
}

export function created<T>(data: T, message = "Created"): NextResponse<ApiSuccess<T>> {
  return ok(data, message, { status: 201 });
}

export function fail(
  message: string,
  opts: {
    status?: number;
    errors?: FieldErrors;
    code?: string;
    headers?: HeadersInit;
  } = {},
): NextResponse<ApiFailure> {
  return NextResponse.json(
    {
      success: false as const,
      message,
      errors: opts.errors ?? {},
      ...(opts.code ? { code: opts.code } : {}),
    },
    { status: opts.status ?? 400, headers: opts.headers },
  );
}

/** Flatten a ZodError into `{ "path.to.field": ["message"] }`. */
export function zodToFieldErrors(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_root";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function translate(error: unknown): NextResponse<ApiFailure> {
  if (error instanceof ZodError) {
    return fail("Validation failed", {
      status: 422,
      code: "VALIDATION_ERROR",
      errors: zodToFieldErrors(error),
    });
  }

  if (error instanceof RateLimitError) {
    return fail(error.message, {
      status: error.status,
      code: error.code,
      headers: { "Retry-After": String(error.retryAfterSeconds) },
    });
  }

  if (error instanceof AppError) {
    if (!error.expose) {
      logger.error("Suppressed application error", { error, code: error.code });
      return fail("Something went wrong", { status: error.status, code: error.code });
    }
    return fail(error.message, {
      status: error.status,
      code: error.code,
      errors: error.errors,
    });
  }

  // Duplicate key -> conflict, with the offending field surfaced.
  if (
    error instanceof mongoose.mongo.MongoServerError &&
    (error as { code?: number }).code === 11000
  ) {
    const keys = Object.keys(
      (error as unknown as { keyPattern?: Record<string, unknown> }).keyPattern ?? {},
    );
    const errors: FieldErrors = {};
    for (const k of keys) errors[k] = ["Already in use"];
    return fail("Resource already exists", {
      status: 409,
      code: "DUPLICATE_KEY",
      errors,
    });
  }

  if (error instanceof mongoose.Error.ValidationError) {
    const errors: FieldErrors = {};
    for (const [path, err] of Object.entries(error.errors)) errors[path] = [err.message];
    return fail("Validation failed", { status: 422, code: "VALIDATION_ERROR", errors });
  }

  if (error instanceof mongoose.Error.CastError) {
    return fail("Malformed identifier", {
      status: 400,
      code: "INVALID_ID",
      errors: { [error.path]: ["Invalid value"] },
    });
  }

  logger.error("Unhandled route error", { error });
  return fail(isProduction() ? "Internal server error" : String(error), {
    status: 500,
    code: "INTERNAL_ERROR",
  });
}

/**
 * Wrap a route handler: connect to Mongo, run it, translate any throw into the
 * standard failure envelope.
 */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      await connectToDatabase();
      return await fn(...args);
    } catch (error) {
      return translate(error);
    }
  };
}

/** Parse a JSON body, converting malformed input into a validation error. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    return JSON.parse(text);
  } catch {
    throw new ValidationError({ _root: ["Request body must be valid JSON"] });
  }
}
