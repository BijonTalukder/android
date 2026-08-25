import { clearSessionCookies, readRefreshCookie } from "@/lib/auth";
import { handler, ok } from "@/lib/response";
import { AuthService } from "@/modules/auth";

export const runtime = "nodejs";

export const POST = handler(async () => {
  const refreshToken = await readRefreshCookie();
  await AuthService.logout(refreshToken);
  await clearSessionCookies();
  return ok({ signedOut: true }, "Signed out");
});
