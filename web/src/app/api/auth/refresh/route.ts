import { clearSessionCookies, readRefreshCookie, setSessionCookies } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { handler, ok } from "@/lib/response";
import { AuthService } from "@/modules/auth";

export const runtime = "nodejs";

export const POST = handler(async (req: Request) => {
  enforceRateLimit("refresh", clientIp(req), RATE_LIMITS.refresh);

  const refreshToken = await readRefreshCookie();
  if (!refreshToken) {
    await clearSessionCookies();
    throw new UnauthorizedError("No active session", "NO_REFRESH_TOKEN");
  }

  try {
    const session = await AuthService.refresh(refreshToken, {
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    await setSessionCookies(session.accessToken, session.refreshToken);
    return ok({ user: session.user }, "Session refreshed");
  } catch (error) {
    // A refresh failure always ends the session; do not leave a dead cookie.
    await clearSessionCookies();
    throw error;
  }
});
