import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DASHBOARD_AUTH_COOKIE } from "../../../lib/dashboard-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set({
    name: DASHBOARD_AUTH_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });

  return NextResponse.json({ status: "logged_out" });
}
