/**
 * Edge proxy (formerly `middleware.ts`).
 *
 * Deliberately shallow: it only checks whether a refresh cookie is *present*
 * so that a signed-out visitor is bounced to /login before a dashboard shell
 * is streamed, and a signed-in one skips the login page. It does not verify
 * the token -- the real authorization happens in `requireAuth` on the Node
 * runtime, where the database is reachable.
 */
import { NextResponse, type NextRequest } from "next/server";

const REFRESH_COOKIE = "adg_refresh";
const AUTH_PAGES = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(REFRESH_COOKIE)?.value);

  if (pathname.startsWith("/dashboard") && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Preserve where the visitor was heading so login can return them there.
    if (pathname !== "/dashboard") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (AUTH_PAGES.includes(pathname) && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip API routes (they authenticate themselves) and all static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
