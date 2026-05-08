"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DASHBOARD_AUTH_COOKIE, createDashboardSessionToken, getSessionMaxAge, verifyDashboardPassword } from "../../lib/dashboard-auth";

export type LoginActionState = {
  status: "idle" | "error";
  message: string;
};

function getSafeRedirect(value: FormDataEntryValue | null) {
  const next = String(value ?? "/dashboard");

  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/login") || next.startsWith("/api/")) {
    return "/dashboard";
  }

  return next;
}

export async function loginAction(_previousState: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const configuredPassword = process.env.DASHBOARD_PASSWORD;
  const submittedPassword = String(formData.get("password") ?? "");

  if (!configuredPassword) {
    return {
      status: "error",
      message: "DASHBOARD_PASSWORD is not configured."
    };
  }

  if (!(await verifyDashboardPassword(submittedPassword, configuredPassword))) {
    return {
      status: "error",
      message: "Incorrect password."
    };
  }

  const token = await createDashboardSessionToken(configuredPassword);

  if (!token) {
    return {
      status: "error",
      message: "Unable to create dashboard session."
    };
  }

  const cookieStore = await cookies();
  cookieStore.set({
    name: DASHBOARD_AUTH_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: getSessionMaxAge()
  });

  redirect(getSafeRedirect(formData.get("next")));
}
