import { NextResponse } from "next/server";
import { queryPostgres } from "../../../lib/postgres-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HealthCheckStatus = "ok" | "missing" | "failed";

function envStatus(name: string): HealthCheckStatus {
  return process.env[name]?.trim() ? "ok" : "missing";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return redactKnownSecrets(error.message);
  }

  return "Unknown health check failure";
}

function redactKnownSecrets(message: string) {
  const secrets = [process.env.DATABASE_URL, process.env.DASHBOARD_PASSWORD].filter(
    (value): value is string => Boolean(value?.trim())
  );

  return secrets.reduce((redacted, secret) => redacted.replaceAll(secret, "***"), message);
}

export async function GET() {
  const startedAt = Date.now();
  const checks: Record<string, HealthCheckStatus> = {
    app: "ok",
    database: "ok",
    dashboardPassword: envStatus("DASHBOARD_PASSWORD")
  };
  let databaseError: string | null = null;

  try {
    await queryPostgres("select 1 as ok");
  } catch (error) {
    checks.database = "failed";
    databaseError = errorMessage(error);
  }

  const healthy = Object.values(checks).every((status) => status === "ok");
  const body = {
    status: healthy ? "healthy" : "unhealthy",
    checks,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    ...(databaseError ? { databaseError } : {})
  };

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
