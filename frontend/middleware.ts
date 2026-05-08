import { NextResponse, type NextRequest } from "next/server";
import { DASHBOARD_AUTH_COOKIE, verifyDashboardSessionToken } from "./lib/dashboard-auth";

function isPublicRoute(pathname: string) {
  return pathname === "/login" || pathname === "/api/health";
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(DASHBOARD_AUTH_COOKIE)?.value;
  const isAuthenticated = await verifyDashboardSessionToken(sessionCookie, process.env.DASHBOARD_PASSWORD);

  if (isAuthenticated) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"]
};
