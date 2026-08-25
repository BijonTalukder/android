import { setSessionCookies } from "@/lib/auth";
import { clientIp, enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { created, handler, readJson } from "@/lib/response";
import { AuthService, registerSchema } from "@/modules/auth";

export const runtime = "nodejs";

/** Self-serve organization signup. Disabled unless ALLOW_PUBLIC_REGISTRATION=true. */
export const POST = handler(async (req: Request) => {
  enforceRateLimit("register", clientIp(req), RATE_LIMITS.register);

  const input = registerSchema.parse(await readJson(req));
  const session = await AuthService.register(input, {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });

  await setSessionCookies(session.accessToken, session.refreshToken);
  return created({ user: session.user }, "Organization created");
});
