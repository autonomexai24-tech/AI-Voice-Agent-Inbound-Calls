import { NextResponse } from "next/server";
import { queryPostgres } from "../../../lib/postgres-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HealthCheckStatus = "ok" | "missing" | "failed";

const requiredEnvGroups: Array<{ key: string; names: string[] }> = [
  { key: "databaseUrl", names: ["DATABASE_URL"] },
  { key: "openaiApiKey", names: ["OPENAI_API_KEY"] },
  { key: "livekitUrl", names: ["LIVEKIT_URL"] },
  { key: "livekitApiKey", names: ["LIVEKIT_API_KEY"] },
  { key: "livekitApiSecret", names: ["LIVEKIT_API_SECRET"] },
  { key: "sarvamApiKey", names: ["SARVAM_AI_API_KEY", "SARVAM_API_KEY"] },
  { key: "calcomApiKey", names: ["CALCOM_API_KEY"] },
  { key: "calcomEventTypeId", names: ["CALCOM_EVENT_TYPE_ID", "CAL_EVENT_TYPE_ID"] },
  { key: "fast2smsApiKey", names: ["FAST2SMS_API_KEY"] },
  { key: "dashboardPassword", names: ["DASHBOARD_PASSWORD"] }
];

const requiredTables = ["call_logs", "transcripts", "bookings", "agent_config", "notification_events"];

function envGroupStatus(names: string[]): HealthCheckStatus {
  return names.some((name) => process.env[name]?.trim()) ? "ok" : "missing";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return redactKnownSecrets(error.message);
  }

  return "Unknown health check failure";
}

function redactKnownSecrets(message: string) {
  const secrets = requiredEnvGroups
    .flatMap((group) => group.names.map((name) => process.env[name]))
    .filter((value): value is string => Boolean(value?.trim()));

  return secrets.reduce((redacted, secret) => redacted.replaceAll(secret, "***"), message);
}

export async function GET() {
  const startedAt = Date.now();
  const checks: Record<string, HealthCheckStatus> = {
    app: "ok",
    database: "ok",
    schema: "ok"
  };
  for (const group of requiredEnvGroups) {
    checks[group.key] = envGroupStatus(group.names);
  }

  const calcomEventTypeId = process.env.CALCOM_EVENT_TYPE_ID || process.env.CAL_EVENT_TYPE_ID || "";
  if (checks.calcomEventTypeId === "ok" && !Number.isInteger(Number(calcomEventTypeId))) {
    checks.calcomEventTypeId = "failed";
  }

  let databaseError: string | null = null;

  try {
    await queryPostgres(
      `
      select to_regclass('public.call_logs') as call_logs,
             to_regclass('public.transcripts') as transcripts,
             to_regclass('public.bookings') as bookings,
             to_regclass('public.agent_config') as agent_config,
             to_regclass('public.notification_events') as notification_events
      `
    ).then((result) => {
      const row = result.rows[0] as Record<string, string | null> | undefined;
      const missingTables = requiredTables.filter((table) => !row?.[table]);
      if (missingTables.length > 0) {
        checks.schema = "failed";
        databaseError = `Missing required table(s): ${missingTables.join(", ")}`;
      }
    });
  } catch (error) {
    checks.database = "failed";
    checks.schema = "failed";
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
