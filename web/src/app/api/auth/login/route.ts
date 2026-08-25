import { setSessionCookies } from "@/lib/auth";
import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { handler, ok, readJson } from "@/lib/response";
import { AuthService, loginSchema } from "@/modules/auth";

export const runtime = "nodejs";

export const POST = handler(async (req: Request) => {
  enforceRateLimit("login", clientIp(req), RATE_LIMITS.login);

  const input = loginSchema.parse(await readJson(req));
  const session = await AuthService.login(input, {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });

  await setSessionCookies(session.accessToken, session.refreshToken);
  return ok({ user: session.user }, "Signed in");
});
