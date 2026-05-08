# Current Codebase Review

## 1. Executive Summary

This repository is an **inbound AI voice platform** built for a single-tenant business deployment on Easypanel/KVM2 VPS. It uses a Python 3.11 LiveKit Agents voice worker with OpenAI LLM reasoning and Sarvam AI for Indian-language STT/TTS, paired with a Next.js 16 dashboard for operators. The system was recently migrated from self-hosted Supabase to plain PostgreSQL via `DATABASE_URL`. The migration is structurally complete but contains residual UI text, unused schema fields, and several operational gaps that need attention before production use.

**Current stage:** ~80% feature-complete. Core call flow, booking, SMS, and dashboard are wired. Several polish, correctness, and operational readiness items remain.

---

## 2. What Exists Today

### Implemented
- **Inbound voice agent** (`agent.py`): LiveKit pipeline with OpenAI GPT-4o, Sarvam STT/TTS, Silero VAD
- **Call lifecycle**: create call log → transcript logging → complete call log → post-call SMS
- **PostgreSQL persistence**: `call_logs`, `transcripts`, `bookings`, `agent_config` tables via `psycopg2`
- **Cal.com booking tool** (`tools.py`): LLM-callable function with verbal confirmation policy
- **Fast2SMS notifications** (`notifications.py`): post-booking SMS with duplicate prevention
- **Next.js dashboard** (`frontend/`): Analytics, CRM calls, Calendar bookings, Agent Config, Login
- **Password protection** (`middleware.ts`, `dashboard-auth.ts`): HMAC-based single-password auth
- **Docker + Supervisor** multi-stage build with `node server.js` standalone output
- **Database init script** (`init_db.py`): retry logic for container startup
- **Graceful startup** (`start.sh`): init runs before Supervisor, non-fatal on DB failure

### Not Implemented / Broken
- Language switching from dashboard (schema has `language_code`, code ignores it)
- Stale "Supabase" labels in dashboard UI text
- `ui_server.py` references legacy port 8000
- No health check endpoint for Easypanel / load balancer
- No explicit `call_logs.status` update to "completed" during normal flow (only on failure)
- Dashboard does not display actual charts (only metric cards)
- No search/filter on CRM table
- No transcript detail view per call
- `notify.py` Telegram/WhatsApp code is present but not integrated into call flow

---

## 3. File/Folder Map

```
InboundAIVoice-main/
├── agent.py                 # LiveKit agent entrypoint; call lifecycle; config loading
├── db.py                    # PostgreSQL connection helpers (psycopg2)
├── tools.py                 # Cal.com booking tool; LLM function decorator
├── notifications.py         # Fast2SMS post-booking SMS sender
├── calendar_tools.py        # Cal.com slot fetching + Google Calendar fallback
├── init_db.py               # Schema initialization with retry logic
├── start.sh                 # Container startup: init_db.py → supervisord
├── supervisord.conf         # Runs python agent.py + node server.js
├── Dockerfile               # Multi-stage: Node builder → Python builder → runtime
├── schema.sql               # Table definitions + default agent config seed
├── config.json              # Legacy placeholder (all values empty)
├── ui_server.py             # Dead legacy FastAPI dashboard (returns 410/disabled page)
├── make_call.py             # Outbound call dispatcher utility (not used in inbound flow)
├── notify.py                # Telegram/WhatsApp webhook utilities (not wired to call flow)
│
├── frontend/
│   ├── next.config.mjs      # output: "standalone"
│   ├── middleware.ts        # Password-auth gate for all routes except /login
│   ├── app/
│   │   ├── layout.tsx       # Root layout with AppShell
│   │   ├── app-shell.tsx    # Sidebar navigation shell
│   │   ├── navigation.tsx   # Dashboard nav links
│   │   ├── page.tsx         # Root redirect (not used directly)
│   │   ├── login/           # Login page + form + server action
│   │   ├── dashboard/       # Analytics cards page
│   │   ├── crm/             # Call log table with transcript summaries
│   │   ├── calendar/        # Confirmed bookings table
│   │   └── agent-config/    # Config form + save action
│   └── lib/
│       ├── postgres-server.ts     # pg Pool + query helper (server-only)
│       ├── agent-config-data.ts   # Fetch active config from agent_config table
│       ├── dashboard-metrics.ts   # Compute analytics from call_logs + bookings
│       ├── operations-data.ts     # CRM calls + confirmed bookings queries
│       ├── dashboard-auth.ts      # HMAC session cookie logic
│       └── supabase-server.ts     # DEAD CODE: only abort signal helper remains
│
└── .agents/, docs, tests, etc.
```

---

## 4. Working vs Broken

### Working
- ✅ Python compilation of all `.py` files
- ✅ Next.js `npm run build` succeeds (standalone output)
- ✅ PostgreSQL connection via `DATABASE_URL` (both Python and Next.js)
- ✅ Dashboard login with `DASHBOARD_PASSWORD`
- ✅ Middleware redirects unauthenticated users to `/login`
- ✅ Call log creation on inbound call start
- ✅ Transcript persistence turn-by-turn
- ✅ Cal.com booking creation via LLM tool call
- ✅ Booking duplicate prevention (`ON CONFLICT` in `tools.py:81`)
- ✅ SMS duplicate prevention (`sms_sent` flag check in `agent.py:305`)
- ✅ `init_db.py` retry loop (30 attempts × 2s = 60s max wait)
- ✅ `start.sh` no longer aborts on DB init failure

### Partially Working
- ⚠️ **Agent config persistence**: saves/loads `initial_greeting`, `system_prompt`, `vad_threshold` correctly, but **ignores `language_code`** entirely
- ⚠️ **Dashboard UI labels**: display "Supabase service role..." stale text on `agent-config/page.tsx:18` and `dashboard/page.tsx:50`
- ⚠️ **Call status lifecycle**: `call_logs.status` is inserted as `"connected"` at start, but never updated to `"completed"` on normal call end (only on failure path updates it)
- ⚠️ **VAD threshold**: loaded from DB but only clamped to `0.0–1.0`; no validation that it matches Silero's expected range
- ⚠️ **Sarvam TTS language**: hardcoded to `hi-IN` / speaker `kavya` in `agent.py:69` regardless of config
- ⚠️ **Sarvam STT language**: set to `"unknown"` in `agent.py:57` — may auto-detect, but not configurable

### Broken / Risky
- ❌ **Language handling**: `agent_config.language_code` exists in schema, but `agent.py` `AgentConfig` dataclass lacks the field, and TTS hardcodes `hi-IN`
- ❌ **No health endpoint**: Easypanel cannot verify container health; 502s are hard to diagnose
- ❌ **`ui_server.py` legacy references**: mentions port 8000 and "Legacy RapidX AI Dashboard"
- ❌ **No `NOTIFICATION_EVENTS` table**: `schema.sql` references it in comments but table is not created
- ❌ **Transcript summary**: `buildTranscriptSummary()` in `operations-data.ts:58` concatenates raw turns, not a semantic summary
- ❌ **No date range filters**: dashboard metrics load ALL historical calls; no time window filtering
- ❌ **No caller name storage**: `call_logs` has `phone_number` but no `caller_name` column
- ❌ **`notify.py` is orphaned**: Telegram/WhatsApp/webhook code exists but is never called from `agent.py`

### Missing
- 🚫 Charts/graphs for call volume over time
- 🚫 CRM search by phone number or name
- 🚫 Individual call detail page with full transcript
- 🚫 Booking cancellation flow from dashboard
- 🚫 Agent configuration `language_code` UI field
- 🚫 Environment variable validation at startup
- 🚫 Structured health/readiness endpoint
- 🚫 Call recording audio file persistence
- 🚫 Retry logic for DB writes during a call (transient network failures could lose data)

---

## 5. Data Flow Review

### Inbound Call Flow

```
SIP Provider → LiveKit Cloud → LiveKit SIP Trunk → Room created
                                                    ↓
                                        Python Worker (agent.py)
                                        └─ entrypoint(ctx)
                                            ├─ ctx.connect()
                                            ├─ fetch_active_agent_config() ──→ PostgreSQL agent_config
                                            ├─ create_call_log(caller_phone) ──→ INSERT call_logs
                                            ├─ VoicePipelineAgent.start(ctx)
                                            │   └─ AgentSession with:
                                            │       ├─ STT: Sarvam saaras:v3 (language="unknown")
                                            │       ├─ LLM: OpenAI gpt-4o (max 160 tokens)
                                            │       ├─ TTS: Sarvam bulbul:v3 (hi-IN, speaker="kavya")
                                            │       ├─ VAD: Silero (activation_threshold from DB)
                                            │       └─ InboundAssistant (Agent subclass)
                                            │           └─ on_enter(): speaks greeting
                                            │           └─ tools=[book_appointment]
                                            │               └─ verbal confirmation required
                                            │               └─ Cal.com API v2 POST /bookings
                                            │               └─ INSERT bookings (ON CONFLICT UPDATE)
                                            │
                                            ├─ transcript events → log_transcript_turn() ──→ INSERT transcripts
                                            └─ ctx.add_shutdown_callback(finalize_call)
                                                └─ drain_transcript_tasks()
                                                └─ complete_call_log() ──→ UPDATE call_logs duration/status/outcome
                                                └─ send_post_call_booking_sms()
                                                    └─ _fetch_confirmed_booking() ──→ SELECT bookings
                                                    └─ send_booking_sms() ──→ Fast2SMS API
                                                    └─ UPDATE bookings SET sms_sent = true
```

### Dashboard Read Flow

```
Operator → Browser → Easypanel HTTPS Proxy → Container port 3000
                                                  ↓
                                          Next.js standalone server.js
                                          ├─ /login         → middleware allows → login action
                                          ├─ /dashboard     → middleware checks cookie → getDashboardMetrics()
                                          ├─ /crm           → getCrmCalls()
                                          ├─ /calendar      → getConfirmedBookings()
                                          └─ /agent-config  → getActiveAgentConfig() + saveAgentConfig()
                                                                  ↓
                                                           All query PostgreSQL via pg Pool
                                                           (server-only, DATABASE_URL never exposed to client)
```

---

## 6. Agent Config Review

### How Config is Loaded

`agent.py:171` — `fetch_active_agent_config()`:
```python
row = db.fetch_one(
    """
    select initial_greeting, system_prompt, vad_threshold, updated_at
    from agent_config
    order by updated_at desc nulls last
    limit 1
    """
)
```

**Note**: This query does **NOT** select `language_code`. The column exists in the schema but is ignored.

### How Config is Saved

`frontend/app/agent-config/actions.ts:32` — `saveAgentConfig()`:
- Reads `id`, `initialGreeting`, `systemPrompt`, `vadThreshold` from FormData
- Validates VAD threshold is numeric between 0.0 and 1.0
- Does **NOT** handle `language_code` at all
- Updates existing row by `id` or inserts new row
- Calls `revalidatePath("/agent-config")` to clear Next.js cache

### Config Persistence After Refresh

**Yes, config persists correctly** for the three fields that are actually implemented:
- `initial_greeting` ✓
- `system_prompt` ✓
- `vad_threshold` ✓

**But `language_code` does NOT persist functionally** because:
1. The save action never writes it
2. The fetch query never reads it
3. The agent.py dataclass doesn't include it
4. The UI form has no language selector

### AgentConfig Dataclass (agent.py:33)

```python
@dataclass(frozen=True)
class AgentConfig:
    initial_greeting: str
    system_prompt: str
    vad_threshold: float
```

**Missing**: `language_code: str` — declared in `agent.md` rules and schema, absent from code.

---

## 7. Language Handling Review

### Current State: **Broken / Ignored**

The `agent_config` table has a `language_code` column (default `'en-IN'`), but **nothing in the runtime uses it**.

### Evidence

| Component | Current Behavior | Expected |
|-----------|-----------------|----------|
| **STT** (`agent.py:56`) | `language="unknown"` (Sarvam auto-detect) | Should use `language_code` from config |
| **TTS** (`agent.py:68`) | `target_language_code="hi-IN"`, speaker="kavya" | Should use `language_code` from config |
| **LLM** (`agent.py:64`) | No language instruction in system prompt | Should inject language preference |
| **Dashboard** (`config-form.tsx`) | No language selector field | Should have dropdown for en-IN / hi-IN / kn-IN |
| **Schema** (`schema.sql:32`) | `language_code varchar(10) default 'en-IN'` | Correct, but unused |

### Language Support Status

- **English**: Works (TTS outputs Hindi-accented English due to `hi-IN` setting)
- **Hindi**: Partially works (STT auto-detects, TTS is set to Hindi)
- **Kannada**: Not supported (TTS hardcoded to `hi-IN`; Sarvam may support Kannada but config can't change it)
- **Mixed-language calls**: STT may handle code-switching with `language="unknown"`, but TTS will always respond in Hindi
- **Automatic language continuity**: **Broken** — no mechanism to detect caller language and lock it for the session

### Recommended Fix

1. Add `language_code` to `AgentConfig` dataclass
2. Add `language_code` to fetch/save queries
3. Map language codes to Sarvam TTS settings:
   - `en-IN` → `target_language_code="en-IN"`, speaker appropriate for English
   - `hi-IN` → `target_language_code="hi-IN"`, speaker="kavya"
   - `kn-IN` → `target_language_code="kn-IN"` (if supported by Sarvam)
4. Add language selector to dashboard config form
5. Consider STT language hint: if known, set explicitly instead of `"unknown"`

---

## 8. Latency Review

### High-Risk Latency Sources

1. **LLM token limit** (`agent.py:66`): `max_completion_tokens=160`
   - ✅ **Good**: Prevents long-winded responses
   - ⚠️ **Risk**: Very short for complex booking conversations; may truncate mid-sentence

2. **Endpointing delays** (`agent.py:79-80`):
   - `min_endpointing_delay=0.2`, `max_endpointing_delay=1.2`
   - ✅ **Good**: Tight bounds for responsive turn-taking

3. **VAD threshold from DB** (`agent.py:49`):
   - `_clamp_vad_threshold()` clamps to `0.0–1.0` but doesn't validate against Silero's optimal range
   - ⚠️ **Risk**: Values near 0.0 cause excessive interruptions; values near 1.0 cause missed barge-ins

4. **Cal.com API timeout** (`tools.py:116`): `httpx.AsyncClient(timeout=10.0)`
   - ✅ **Reasonable**: 10s is acceptable for voice; failure message is spoken to caller

5. **Fast2SMS timeout** (`notifications.py:45`): `httpx.AsyncClient(timeout=10.0)`
   - ✅ **Acceptable**: Post-call, not blocking conversation

6. **No streaming TTS optimization visible**:
   - `preemptive_generation=True` is set, which helps
   - ⚠️ **Unknown**: Whether Sarvam plugin supports true streaming; `speech_sample_rate=24000` is set

7. **Transcript DB writes** (`agent.py:355`):
   - Each turn triggers `asyncio.to_thread()` → `db.execute()` → network round-trip to PostgreSQL
   - ⚠️ **Moderate risk**: Under high call volume, this adds ~5-20ms latency per turn
   - 💡 **Mitigation**: Already using `to_thread()` to avoid blocking event loop; acceptable for current scale

8. **Booking tool latency**:
   - LLM must generate tool call → HTTP to Cal.com → DB insert → LLM generates confirmation
   - ⚠️ **Total**: 2-4 seconds of dead air possible; good practice is to have the agent say "Let me check that..." during the booking API call
   - ❌ **Missing**: No intermediate filler message during Cal.com API call

### Low-Risk / Well-Optimized

- `allow_interruptions=True` ✅
- `preemptive_generation=True` ✅
- Short system prompt (no RAG/multi-step routing) ✅
- Single LLM call per turn (no routing layer) ✅

---

## 9. Database Review

### PostgreSQL Connection

**Python** (`db.py`):
- `psycopg2-binary` with `RealDictCursor` for dict-like row access
- Context manager `get_connection()` handles commit/rollback/close
- Helper functions: `fetch_one`, `fetch_all`, `execute`, `execute_returning_one`
- ⚠️ **No connection pooling** in Python: each query opens a new TCP connection
- ⚠️ **No read replicas**: all traffic goes to primary

**Next.js** (`postgres-server.ts`):
- `pg` library with singleton `Pool` (max 5 connections)
- `getPostgresPool()` lazily initializes on first query
- `queryPostgres()` is the only export; used by all data modules
- ✅ **Connection pooling** properly implemented

### DATABASE_URL Usage

- ✅ Only accessed server-side (`db.py` reads `os.environ`, `postgres-server.ts` reads `process.env`)
- ✅ `server-only` import prevents accidental client bundling in Next.js
- ✅ No Supabase SDK imports in active code
- ⚠️ **Password validation in `init_db.py`** checks for unescaped `@` — good practice

### Old Supabase Assumptions

| Location | Status |
|----------|--------|
| `frontend/lib/supabase-server.ts` | ✅ Dead code — only abort signal helper remains |
| `frontend/app/dashboard/page.tsx:50` | ❌ Stale UI text: "Supabase service role server fetch" |
| `frontend/app/agent-config/page.tsx:18` | ❌ Stale UI text: "Supabase service role update" |
| `agent.md:101` | ⚠️ Mentions "Supabase pgvector" in RAG policy (architectural note, not active code) |
| `SUPABASE_SETUP.md` | 🗄️ Legacy documentation file (not harmful) |
| `supabase_setup.sql` | 🗄️ Legacy SQL file (not harmful) |
| `supabase_migration_v2.sql` | 🗄️ Legacy SQL file (not harmful) |

### Schema Review

```sql
call_logs:    id, phone_number, start_time, duration, status, outcome, created_at
transcripts:  call_id, speaker, text, timestamp
bookings:     call_id, appointment_time, status, sms_sent
agent_config: id, initial_greeting, system_prompt, vad_threshold, language_code, updated_at
```

**Missing tables** (referenced in docs but not created):
- `caller_profiles` (mentioned in plan.md)
- `notification_events` (mentioned in plan.md and saravm.md)

**Schema issues**:
- `call_logs` has no `caller_name` column (booking collects name but it's not persisted)
- `call_logs` has no `summary` column (agent.md says "persist summary" but schema has no place for it)
- `call_logs.status` default is `'started'` but insert uses `'connected'` — inconsistent

---

## 10. Booking and SMS Review

### Cal.com Booking Flow

1. **Trigger**: LLM calls `book_appointment()` tool (`tools.py:98`) after verbal confirmation
2. **Validation**: Checks `_current_call_id.get()` (set at call start via `set_booking_call_context()`)
3. **API call**: POST to `https://api.cal.com/v2/bookings` with bearer token
4. **DB persist**: `INSERT INTO bookings ... ON CONFLICT (call_id) DO UPDATE`
5. **Return**: Success message spoken to caller; failure message spoken on error

**Duplicate prevention**: ✅ `ON CONFLICT` upsert ensures only one booking per call

### Fast2SMS Flow

1. **Trigger**: `send_post_call_booking_sms()` called during `finalize_call()` (call shutdown)
2. **Check**: Only runs if `call_id` AND `caller_phone` exist
3. **Query**: `SELECT ... FROM bookings WHERE call_id = %s AND status = 'confirmed'`
4. **Dedup check**: `booking.get("sms_sent")` — if already true, skip
5. **Send**: POST to Fast2SMS bulkV2 endpoint
6. **Mark**: `UPDATE bookings SET sms_sent = true WHERE call_id = %s`

**Duplicate prevention**: ✅ Two-layer check:
- `sms_sent` boolean flag in DB
- Only sends for confirmed bookings

### SMS Risks

| Risk | Status |
|------|--------|
| Duplicate SMS | ✅ Prevented by `sms_sent` flag |
| SMS for non-booking calls | ✅ Prevented — only checks confirmed bookings |
| Failed SMS not visible in dashboard | ⚠️ Partial — logged to stdout, but no `notification_events` table |
| SMS content customization | ❌ Not configurable — hardcoded message template |
| International numbers | ⚠️ Fast2SMS is India-only; non-Indian numbers will fail |

---

## 11. Deployment Review

### Docker Flow

```
Stage 1: node:20-slim
  → npm ci
  → COPY frontend/
  → npm run build
  → Verify .next/standalone/server.js exists

Stage 2: python:3.11-slim
  → apt-get install build-essential
  → pip install --user -r requirements.txt

Stage 3: python:3.11-slim (runtime)
  → apt-get install ca-certificates curl ffmpeg supervisor
  → COPY node binary from Stage 1
  → COPY Python deps from Stage 2
  → COPY source code
  → COPY standalone build from Stage 1
  → COPY static assets
  → COPY public assets
  → COPY supervisord.conf
  → CMD ["/app/start.sh"]
```

### Supervisor Flow

```
[start.sh]
  ├─ python init_db.py (with retry, non-fatal failure)
  └─ exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
      ├─ [program:voice_agent] python agent.py start
      └─ [program:next_dashboard] node server.js (port 3000, 0.0.0.0)
```

### Easypanel Assumptions

| Assumption | Reality | Status |
|------------|---------|--------|
| Port 3000 exposed | `EXPOSE 3000` in Dockerfile | ✅ Correct |
| Next.js standalone | `output: "standalone"` in next.config.mjs | ✅ Correct |
| Supervisor PID 1 | `exec` in start.sh passes signals | ✅ Correct |
| DATABASE_URL env var | Read by both Python and Node | ✅ Correct |
| Internal DB host resolution | Uses Docker service name | ⚠️ Must match Easypanel internal host exactly |
| Health check | None configured | ❌ Missing |
| Domain routes to 3000 | User must update from 8000 | ⚠️ Manual Easypanel step required |

### Production Readiness Gaps

1. **No health endpoint**: Easypanel cannot distinguish between "starting" and "crashed"
2. **No graceful shutdown**: `agent.py` registers shutdown callback but doesn't handle SIGTERM for clean SIP hangup
3. **Log streaming**: Supervisor logs to `/dev/stderr` and `/dev/stdout` — works with Docker, but no structured JSON logging
4. **Memory limits**: No explicit memory limits configured; `max_completion_tokens=160` helps but TTS/STT buffers could grow
5. **Database backup**: Not mentioned; Easypanel PostgreSQL service should have backups enabled
6. **Secrets in env**: `DATABASE_URL` contains plaintext password — standard for Docker, but ensure Easypanel encrypts at rest

---

## 12. Recommended Next Fixes (Priority Order)

1. **Fix stale UI text** — Replace "Supabase service role..." labels in `agent-config/page.tsx:18` and `dashboard/page.tsx:50`
2. **Implement language switching** — Wire `language_code` through agent config fetch/save/agent.py/frontend form
3. **Add health check endpoint** — Simple `/api/health` route in Next.js returning 200 when DB is reachable
4. **Fix call status lifecycle** — Update `call_logs.status` to `"completed"` in normal flow, not just failure
5. **Add `caller_name` to schema** — Persist name collected during booking to `call_logs` or `caller_profiles`
6. **Add `summary` support** — Either add `summary` column to `call_logs` or generate it from transcripts
7. **Clean up dead code** — Remove or archive `ui_server.py`, `notify.py` (or wire them into the call flow)
8. **Add CRM search** — Implement server-side search/filter on phone number in CRM page
9. **Add booking filler message** — Have agent say "One moment..." before Cal.com API call to mask latency
10. **Add environment validation** — `init_db.py` should verify all required env vars exist, not just `DATABASE_URL`

---

## 13. Risky Assumptions

1. **Sarvam `language="unknown"` works for all Indian languages** — Auto-detection is convenient but may misclassify short utterances or heavy accents
2. **Cal.com v2 API stability** — The `cal-api-version: 2024-08-13` header pins an API version; Cal.com may deprecate it
3. **Fast2SMS route `"q"` is correct** — This is a queue route; verify it works with your Fast2SMS account type
4. **Single `bookings` row per `call_id`** — The `ON CONFLICT` assumes this; if business rules allow multiple bookings per call, schema needs changing
5. **PostgreSQL is always reachable within 60 seconds** — `init_db.py` retries 30×2s = 60s; if DB is down longer, container starts without schema
6. **Silero VAD works well with `activation_threshold` from DB** — No empirical tuning data; operators may set suboptimal values
7. **`language_code` default `'en-IN'` is appropriate** — But TTS is hardcoded to `hi-IN`, so English callers hear Hindi-accented responses
8. **No concurrent call ID collision** — `gen_random_uuid()` for call_logs should be unique, but no explicit check
9. **Telegram/WhatsApp code in `notify.py` is not needed** — If it IS needed, it must be wired into `finalize_call()` or booking success path
10. **Next.js `dynamic = "force-dynamic"` on every page** — Correct for server-side DB access, but disables static optimization entirely

---

## 14. Exact Code Areas to Fix First

### Immediate (this session)

| File | Lines | Issue | Fix |
|------|-------|-------|-----|
| `frontend/app/agent-config/page.tsx` | 18 | Stale "Supabase service role update" text | Replace with "PostgreSQL configuration" |
| `frontend/app/dashboard/page.tsx` | 50 | Stale "Supabase service role server fetch" text | Replace with "Real-time analytics" |
| `agent.py` | 33-36 | `AgentConfig` missing `language_code` | Add field, update `_coerce_agent_config()` |
| `agent.py` | 56, 69 | Hardcoded STT/TTS language | Use config `language_code` |
| `frontend/lib/agent-config-data.ts` | 17-23, 49-57 | Query doesn't fetch `language_code` | Add to SELECT and type definitions |
| `frontend/app/agent-config/actions.ts` | 32-77 | Save action ignores `language_code` | Add field to insert/update |
| `frontend/app/agent-config/config-form.tsx` | 48-84 | No language selector | Add `<select>` for language codes |

### Next session

| File | Lines | Issue | Fix |
|------|-------|-------|-----|
| `agent.py` | 232-274 | `complete_call_log()` sets `final_outcome` but doesn't set `status="completed"` | Add `status="completed"` to normal flow |
| `schema.sql` | 3-11 | `call_logs.status` default `'started'` but code inserts `'connected'` | Align default or insert value |
| `db.py` | 24-33 | No connection pooling | Consider `psycopg2.pool` or `pgbouncer` for scale |
| `ui_server.py` | 1-66 | Dead legacy code | Remove or archive |
| `tools.py` | 91-144 | No intermediate filler during booking API call | Add pre-flight spoken message |
| `frontend/app/crm/page.tsx` | 41-127 | No search/filter | Add server-side search param |

---

*Review completed: All files inspected, execution paths traced, and issues documented with exact file paths and line numbers.*
