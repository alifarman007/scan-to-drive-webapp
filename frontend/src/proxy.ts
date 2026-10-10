import { NextResponse, type NextRequest } from "next/server";

/**
 * Admin pages without an admin session cookie go straight to the sign-in page, which comes back here afterwards.
 * (Only checks that the cookie is there; the admin layout checks it with the backend.) Also tells the layout
 * which page was asked for, so an expired session can come back to the same page after signing in again.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const here = `${pathname}${search}`;
  if (pathname !== "/admin/login" && !request.cookies.has("s2d_admin")) {
    const url = new URL("/admin/login", request.url);
    url.searchParams.set("next", here);
    return NextResponse.redirect(url);
  }
  const headers = new Headers(request.headers);
  headers.set("x-s2d-path", here);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
