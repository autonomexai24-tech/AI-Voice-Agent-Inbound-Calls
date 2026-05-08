import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { queryPostgres } from "../../../lib/postgres-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HealthCheckStatus = "ok" | "missing" | "failed";
type AgentRuntimeStatus = {
  status?: string;
  timestamp?: string;
  pid?: number;
  call_id?: string | null;
  room?: string | null;
  component?: string;
  error_type?: string;
  error?: string;
};

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
const agentStatusPath = process.env.AGENT_STATUS_PATH || "/tmp/inbound-agent-status.json";
const failedAgentStatuses = new Set([
  "startup_failed",
  "startup_db_failed",
  "livekit_connect_failed",
  "agent_start_failed"
]);

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

async function readAgentRuntimeStatus() {
  try {
    const rawStatus = await readFile(/* turbopackIgnore: true */ agentStatusPath, "utf-8");
    const status = JSON.parse(rawStatus) as AgentRuntimeStatus;
    return {
      check: failedAgentStatuses.has(status.status || "") ? "failed" : "ok",
      status
    } satisfies { check: HealthCheckStatus; status: AgentRuntimeStatus };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return {
        check: "missing",
        status: null
      } satisfies { check: HealthCheckStatus; status: null };
    }

    return {
      check: "failed",
      status: {
        status: "unreadable",
        error_type: error instanceof Error ? error.name : "UnknownError",
        error: errorMessage(error)
      }
    } satisfies { check: HealthCheckStatus; status: AgentRuntimeStatus };
  }
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const scope = request.nextUrl.searchParams.get("scope") || "readiness";
  if (scope === "liveness") {
    return NextResponse.json(
      {
        status: "alive",
        checks: {
          app: "ok"
        },
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startedAt
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  const checks: Record<string, HealthCheckStatus> = {
    app: "ok",
    database: "ok",
    schema: "ok"
  };
  for (const group of requiredEnvGroups) {
    checks[group.key] = envGroupStatus(group.names);
  }
  const agentRuntime = await readAgentRuntimeStatus();
  checks.agentRuntime = agentRuntime.check;

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

  const healthy = Object.entries(checks).every(
    ([key, status]) => status === "ok" || (key === "agentRuntime" && status === "missing")
  );
  const body = {
    status: healthy ? "healthy" : "unhealthy",
    checks,
    agentRuntime: agentRuntime.status,
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
