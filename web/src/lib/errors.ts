/**
 * Typed application errors.
 *
 * Services throw these; the route-handler wrapper in `lib/response.ts` turns
 * them into the platform's standard error envelope. Business logic therefore
 * never needs to know about `NextResponse`.
 */

export type FieldErrors = Record<string, string[]>;

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: FieldErrors;
  /** Errors flagged `expose: false` are logged but replaced by a generic message. */
  readonly expose: boolean;

  constructor(
    message: string,
    opts: { status?: number; code?: string; errors?: FieldErrors; expose?: boolean } = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.status = opts.status ?? 500;
    this.code = opts.code ?? "INTERNAL_ERROR";
    this.errors = opts.errors ?? {};
    this.expose = opts.expose ?? true;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(errors: FieldErrors, message = "Validation failed") {
    super(message, { status: 422, code: "VALIDATION_ERROR", errors });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", code = "UNAUTHORIZED") {
    super(message, { status: 401, code });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, { status: 403, code: "FORBIDDEN" });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, { status: 404, code: "NOT_FOUND" });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, errors: FieldErrors = {}) {
    super(message, { status: 409, code: "CONFLICT", errors });
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Too many requests. Please try again later.", {
      status: 429,
      code: "RATE_LIMITED",
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
