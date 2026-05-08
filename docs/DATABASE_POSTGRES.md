# DATABASE_POSTGRES.md — PostgreSQL Layer

> **Source files:** `db.py`, `init_db.py`, `schema.sql`, `frontend/lib/postgres-server.ts`
> **Subordinate to:** `/docs/PLAN.md`
> **Last verified against code:** 2026-05-08

---

## 1. Raw SQL Only Policy

All database access uses raw SQL. No ORM, no Supabase SDK, no query builder.

- **Python:** `psycopg2` with `RealDictCursor` for dict-like row access.
- **Next.js:** `pg` library with `Pool` for connection pooling.

This is intentional. The schema is small, the queries are straightforward, and raw SQL avoids abstraction overhead.

---

## 2. DATABASE_URL Usage

A single `DATABASE_URL` environment variable is the only way to connect.

- Format: `postgresql://user:password@host:port/database`
- Special characters in the password must be percent-encoded (e.g., `@` → `%40`).
- Set in Easypanel environment variables for the app container.
- Internal Docker service name routing (e.g., `voice-agent-db:5432`).

### Validation

- `init_db.py` validates that `DATABASE_URL` is a full connection URL with scheme and netloc.
- `init_db.py` checks for unescaped `@` in the userinfo section.
- `db.py` raises `DatabaseConfigError` if the variable is missing or empty.
- `postgres-server.ts` returns `null` pool if `DATABASE_URL` is not set, causing queries to throw.

---

## 3. Server-Side Only Access

### Python backend

`db.py` reads `DATABASE_URL` from `os.environ`. All Python code runs server-side (LiveKit worker process).

### Next.js dashboard

`postgres-server.ts` uses `import "server-only"` to prevent bundling into client code. Every data module (`agent-config-data.ts`, `dashboard-metrics.ts`, `operations-data.ts`) imports through this server-only gate. `DATABASE_URL` is never exposed to the browser.

---

## 4. Connection Helper Behavior

### Python — db.py

```python
@contextmanager
def get_connection():
    connection = psycopg2.connect(_required_database_url())
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
```

**No connection pooling.** Each call to any helper (`fetch_one`, `fetch_all`, `execute`, `execute_returning_one`) opens a new TCP connection, uses it, and closes it. This is acceptable at current scale but will need pooling for high concurrency.

Available helpers:

| Function | Returns | Usage |
|----------|---------|-------|
| `fetch_one(query, params)` | `dict \| None` | Single row lookup |
| `fetch_all(query, params)` | `list[dict]` | Multi-row queries |
| `execute(query, params)` | `None` | INSERT/UPDATE/DELETE |
| `execute_returning_one(query, params)` | `dict \| None` | INSERT … RETURNING |

### Next.js — postgres-server.ts

```typescript
const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});
```

**Connection pooling is implemented.** Singleton `Pool` (max 5 connections, 30s idle timeout, 5s connect timeout). Lazily initialized on first query. All dashboard queries go through `queryPostgres()`.

---

## 5. Schema — Tables and Purpose

### call_logs

```sql
CREATE TABLE call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  caller_name text,
  start_time timestamptz NOT NULL DEFAULT now(),
  duration integer,
  status text NOT NULL DEFAULT 'started',
  outcome text,
  summary text,
  language_code varchar(10) NOT NULL DEFAULT 'en-IN',
  mixed_language_enabled boolean NOT NULL DEFAULT false,
  recording_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

| Column | Written by | Read by |
|--------|-----------|---------|
| `id` | `agent.py` — INSERT on call start | All queries that reference a call |
| `phone_number` | `agent.py` — from SIP metadata or participant identity | Dashboard CRM, calendar join |
| `caller_name` | `tools.py` — best-effort update after confirmed booking | Dashboard CRM, calendar |
| `start_time` | `agent.py` — `datetime.now(utc)` at call start | Dashboard ordering, duration calc |
| `duration` | `agent.py` — calculated at call end (seconds) | Dashboard metrics |
| `status` | `agent.py` — `"connected"` on start, `"completed"` or `"failed"` on end | Dashboard metrics, CRM |
| `outcome` | `agent.py` — `"in_progress"` on start, `"booked"` / `"completed"` / `"agent_start_failed"` on end | Dashboard CRM |
| `summary` | `agent.py` — deterministic post-call summary | Dashboard CRM |
| `language_code` | `agent.py` — active config at call start | Dashboard language usage |
| `mixed_language_enabled` | `agent.py` — active config at call start | Dashboard language usage |
| `recording_url` | Future provider recording link | Dashboard transcript detail |
| `created_at` | Auto — `DEFAULT now()` | Not actively queried |

**Note:** `status` column default in schema is `'started'`, but the INSERT in code uses `'connected'`. These are inconsistent but both work because the column is `text` with no constraint.

### transcripts

```sql
CREATE TABLE transcripts (
  call_id uuid NOT NULL REFERENCES call_logs(id) ON DELETE CASCADE,
  speaker text NOT NULL,
  text text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);
```

| Column | Written by | Read by |
|--------|-----------|---------|
| `call_id` | `agent.py` — transcript event handler | Dashboard CRM (join) |
| `speaker` | `agent.py` — `"user"` or `"assistant"` | Dashboard transcript summary |
| `text` | `agent.py` — from conversation item content | Dashboard transcript summary |
| `timestamp` | `agent.py` — `datetime.now(utc)` | Dashboard ordering |

No primary key defined — multiple rows per call expected. Indexed on `(call_id, timestamp)`.

### bookings

```sql
CREATE TABLE bookings (
  call_id uuid PRIMARY KEY REFERENCES call_logs(id) ON DELETE CASCADE,
  appointment_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sms_sent boolean NOT NULL DEFAULT false
);
```

| Column | Written by | Read by |
|--------|-----------|---------|
| `call_id` | `tools.py` — INSERT with ON CONFLICT upsert | SMS check, dashboard calendar |
| `appointment_time` | `tools.py` — from Cal.com payload | Dashboard calendar |
| `status` | `tools.py` — always `"confirmed"` on insert | SMS check, dashboard metrics |
| `sms_sent` | `agent.py` — set to `true` after successful SMS | SMS duplicate check |

**One booking per call** — enforced by `call_id` being the primary key. The `ON CONFLICT` upsert updates the existing booking if the tool is called again in the same call.

### agent_config

```sql
CREATE TABLE agent_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initial_greeting text NOT NULL,
  system_prompt text NOT NULL,
  vad_threshold numeric(4,3) NOT NULL DEFAULT 0.500,
  language_code varchar(10) NOT NULL DEFAULT 'en-IN',
  mixed_language_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_config_vad_threshold_range CHECK (vad_threshold >= 0 AND vad_threshold <= 1)
);
```

| Column | Written by | Read by |
|--------|-----------|---------|
| `initial_greeting` | Dashboard save action | `agent.py` config fetch |
| `system_prompt` | Dashboard save action | `agent.py` config fetch |
| `vad_threshold` | Dashboard save action | `agent.py` config fetch |
| `language_code` | Dashboard save action | `agent.py` config fetch |
| `mixed_language_enabled` | Dashboard save action | `agent.py` config fetch |
| `updated_at` | Dashboard save action | Config fetch ordering |

A default seed row is inserted by `schema.sql` if the table is empty.

---

## 6. Schema Fields That Are Optional

| Table | Column | Purpose |
|-------|--------|---------|
| `call_logs` | `recording_url` | Provider recording link when available; no media is stored by the app |
| `call_logs` | `summary` | Deterministic post-call operator summary; no AI summarization runs during calls |

---

## 7. Notification Audit Events

`notification_events` is append-only audit storage for outbound notifications.

```sql
CREATE TABLE notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid REFERENCES call_logs(id) ON DELETE SET NULL,
  channel text NOT NULL,
  provider text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  provider_response text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Current usage:

| Field | Value |
|-------|-------|
| `channel` | `sms` |
| `provider` | `fast2sms` |
| `event_type` | `booking_confirmation` |
| `status` | `sent` or `failed` |

The table stores provider response text and error text for operator debugging. It does not store duplicate media or add queue infrastructure.

---

## 8. Failure Behavior for DB Writes

### During a call

All DB writes in `agent.py` are wrapped in try/except:

- **Call log creation failure:** `call_id` is set to `None`. Transcript persistence is disabled. The call still proceeds (the agent speaks normally, just without persistence). At shutdown, `finalize_call` skips updates when `call_id` is `None`.
- **Transcript insert failure:** Logged, call continues. The failed task is discarded from `TRANSCRIPT_TASKS`.
- **Booking insert failure:** The booking tool returns a soft error message to the LLM, which speaks it to the caller.
- **Call completion update failure:** Logged. The call log row will have `status="connected"` and `outcome="in_progress"` permanently.
- **SMS mark-sent failure:** Logged. The `sms_sent` flag remains `false`, so a duplicate SMS could be sent on a hypothetical retry (no retry mechanism exists currently).

### At startup

`init_db.py` retries the schema initialization up to 30 times with 2-second delays (60 seconds total). If the DB never becomes reachable, `start.sh` logs a warning but starts Supervisor anyway so the dashboard and agent processes remain visible in logs.

---

## 9. What Happens If the DB Is Unavailable

| Scenario | Behavior |
|----------|----------|
| DB unreachable at container startup | `init_db.py` retries 30×2s. If all fail, Supervisor starts anyway. Agent will fail to create call logs. Dashboard will show errors. |
| DB unreachable during a call | Call log INSERT fails → `call_id=None` → transcripts disabled → call proceeds without persistence → finalize_call skips all DB updates |
| DB unreachable during dashboard load | `queryPostgres()` throws → data modules return empty results with error messages → pages show error state |
| DB connection drops mid-query | `psycopg2.OperationalError` caught → connection rolled back and closed → next query opens a fresh connection |

---

## 10. Indexes

```sql
idx_call_logs_phone_number        ON call_logs(phone_number)
idx_call_logs_caller_name         ON call_logs(caller_name)
idx_call_logs_start_time          ON call_logs(start_time DESC)
idx_call_logs_status              ON call_logs(status)
idx_call_logs_language_code       ON call_logs(language_code)
idx_transcripts_call_id_timestamp ON transcripts(call_id, timestamp)
idx_bookings_appointment_time     ON bookings(appointment_time)
idx_bookings_status               ON bookings(status)
```

These cover the primary query patterns: CRM lookups by phone, chronological ordering, status filtering, transcript retrieval per call, and booking time ordering.
