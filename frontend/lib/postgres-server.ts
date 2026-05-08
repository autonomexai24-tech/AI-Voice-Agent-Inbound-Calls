import "server-only";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;

function validateDatabaseUrl(databaseUrl: string) {
  const authority = databaseUrl.split("://", 2)[1]?.split("/", 1)[0] ?? "";
  const userinfo = authority.includes("@") ? authority.split("@").slice(0, -1).join("@") : "";
  if (userinfo.includes("@")) {
    throw new Error(
      "DATABASE_URL contains an unescaped @ in the username/password section. Percent-encode @ as %40 in the database password."
    );
  }

  let parsed: URL;

  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a full PostgreSQL connection URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error("DATABASE_URL must be a full PostgreSQL connection URL.");
  }
}

export function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !databaseUrl.trim()) {
    return null;
  }

  const trimmedDatabaseUrl = databaseUrl.trim();
  validateDatabaseUrl(trimmedDatabaseUrl);
  return trimmedDatabaseUrl;
}

export function getPostgresPool() {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }

  return pool;
}

export async function queryPostgres<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  const postgresPool = getPostgresPool();

  if (!postgresPool) {
    throw new Error("DATABASE_URL environment variable is not configured.");
  }

  return postgresPool.query<T>(text, values);
}
