import "server-only";
import { Pool, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  return databaseUrl && databaseUrl.trim() ? databaseUrl.trim() : null;
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
