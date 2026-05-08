# REVIEW.md — Repository Snapshot

> **As of:** 2026-05-08
> **Scope:** Factual assessment of the current repository state.
> **Authority:** Subordinate to `/docs/PLAN.md`.

---

## 1. What the Repository Contains

### Active Source Files

| File | Purpose |
|------|---------|
| `agent.py` | LiveKit voice agent entrypoint; call lifecycle; config loading; transcript logging; post-call SMS trigger |
| `db.py` | PostgreSQL connection helpers via `psycopg2` with context manager |
| `tools.py` | Cal.com booking tool; LLM-callable `book_appointment` with verbal confirmation |
| `notifications.py` | Fast2SMS post-booking SMS sender with duplicate prevention |
| `archive-docs/legacy-runtime/calendar_tools.py` | Cal.com slot fetching + Google Calendar fallback (legacy, not used in active flow) |
| `init_db.py` | Schema initialization with 30-retry startup loop |
| `start.sh` | Container startup: runs init_db.py then launches Supervisor |
| `supervisord.conf` | Runs `python agent.py start` + `node server.js` from `.next/standalone` |
| `Dockerfile` | Multi-stage: Node builder → Python builder → python:3.11-slim runtime with ffmpeg + Supervisor |
| `schema.sql` | Table definitions + default agent_config seed |
| `archive-docs/legacy-runtime/config.json` | Legacy placeholder (all values empty, not used by active code) |
| `archive-docs/legacy-runtime/ui_server.py` | Dead legacy FastAPI dashboard (returns 410 / disabled page) |
| `archive-docs/legacy-runtime/make_call.py` | Outbound call dispatcher utility (not used in active flow) |
| `archive-docs/legacy-runtime/notify.py` | Telegram/WhatsApp webhook utilities (not wired to call flow) |
| `requirements.txt` | Python dependencies |

### Frontend (frontend/)

| File/Path | Purpose |
|-----------|---------|
| `next.config.mjs` | `output: "standalone"` enabled |
| `middleware.ts` | Password-auth gate for all routes except /login |
| `app/layout.tsx` | Root layout with AppShell sidebar |
| `app/login/` | Login page + form + server action |
| `app/dashboard/` | Analytics cards page |
| `app/crm/` | Call log table with transcript summaries |
| `app/calendar/` | Confirmed bookings table |
| `app/agent-config/` | Config form + save action |
| `lib/postgres-server.ts` | pg Pool + query helper (server-only) |
| `lib/agent-config-data.ts` | Fetch active config from agent_config |
| `lib/dashboard-metrics.ts` | Compute analytics from call_logs + bookings |
| `lib/operations-data.ts` | CRM calls + confirmed bookings queries |
| `lib/dashboard-auth.ts` | HMAC session cookie logic |
| `lib/supabase-server.ts` | Dead code — only abort signal helper remains |

### Database Schema (schema.sql)

```
call_logs:     id (uuid), phone_number, start_time, duration, status, outcome, created_at
transcripts:   call_id (uuid FK), speaker, text, timestamp
bookings:      call_id (uuid PK/FK), appointment_time, status, sms_sent
agent_config:  id (uuid), initial_greeting, system_prompt, vad_threshold, language_code, updated_at
```

---

## 2. What Is Working

- Python compilation of all `.py` files passes.
- Next.js `npm run build` succeeds with standalone output.
- PostgreSQL connection via `DATABASE_URL` (both Python and Next.js).
- Dashboard login with `DASHBOARD_PASSWORD`.
- Middleware redirects unauthenticated users to `/login`.
- Call log creation on inbound call start.
- Transcript persistence turn-by-turn via `asyncio.create_task`.
- Cal.com booking creation via LLM tool call with verbal confirmation.
- Booking duplicate prevention via `ON CONFLICT (call_id)`.
- SMS duplicate prevention via `sms_sent` flag check.
- `init_db.py` retry loop (30 attempts × 2s = 60s max wait).
- `start.sh` no longer aborts on DB init failure.
- Call lifecycle completion: shutdown callback drains transcripts, updates call_logs, triggers SMS.
- Supervisor starts both services with restart policies.
- Docker multi-stage build structure is correct.

---

## 3. What Is Partially Working

| Area | Status | Detail |
|------|--------|--------|
| **Agent config persistence** | ⚠️ | Saves/loads `initial_greeting`, `system_prompt`, `vad_threshold` correctly, but **ignores `language_code`** entirely |
| **Dashboard UI labels** | ⚠️ | Stale "Supabase service role..." text in `agent-config/page.tsx:18` and `dashboard/page.tsx:50` |
| **Call status lifecycle** | ⚠️ | `call_logs.status` is inserted as `"connected"` at start; schema default is `"started"` — inconsistent |
| **VAD threshold** | ⚠️ | Loaded from DB, clamped to 0.0–1.0, but not validated against Silero's practical optimal range |
| **Sarvam TTS language** | ⚠️ | Hardcoded to `hi-IN` / speaker `kavya` in agent.py regardless of config |
| **Sarvam STT language** | ⚠️ | Set to `"unknown"` — may auto-detect, but not configurable from dashboard |
| **Dashboard metrics** | ⚠️ | Metric cards exist but no time series charts; no date range filters; loads all historical data |

---

## 4. What Is Broken or Risky

| Issue | Severity | Location |
|-------|----------|----------|
| **Language handling completely unwired** | High | `agent_config.language_code` exists in schema but `AgentConfig` dataclass lacks the field; TTS hardcodes `hi-IN`; STT hardcodes `"unknown"`; no UI selector; save action ignores it |
| **No health endpoint** | Medium | Easypanel cannot verify container health; 502s hard to diagnose |
| **Stale Supabase UI text** | Low | `dashboard/page.tsx:50`, `agent-config/page.tsx:18` |
| **No `notification_events` table** | Medium | schema.sql comments reference it but table not created; SMS failures only in stdout |
| **Transcript summary is raw concatenation** | Low | `buildTranscriptSummary()` in `operations-data.ts:58` concatenates turns, not semantic summary |
| **No CRM search/filter** | Medium | CRM table has no search by phone or name |
| **No transcript detail view** | Medium | No per-call transcript page |
| **No caller_name column in call_logs** | Medium | Booking collects name but it's not persisted to call_logs |
| **No call summary column** | Low | `agent.md` says "persist summary" but schema has no place for it |
| **Archived `notify.py` orphaned** | Low | Telegram/WhatsApp code exists in `archive-docs/legacy-runtime/notify.py` but is never called from agent.py |
| **Archived `ui_server.py` dead code** | Low | `archive-docs/legacy-runtime/ui_server.py` returns 410 and is not part of the runtime |
| **Archived `calendar_tools.py` legacy** | Low | Archived availability helper is not in the active root runtime path |
| **Archived `config.json` legacy** | Low | Empty placeholder archived for reference, not used by active code |
| **Python DB: no connection pooling** | Low | Each query opens a new TCP connection; acceptable at current scale |
| **Cal.com API version pinned** | Low | `cal-api-version: 2024-08-13` may be deprecated by Cal.com |

---

## 5. What Is Missing

- Charts/graphs for call volume over time.
- CRM search by phone number or name.
- Individual call detail page with full transcript.
- Booking cancellation flow from dashboard.
- Agent configuration `language_code` UI field.
- Environment variable validation at startup.
- Structured health/readiness endpoint.
- Call recording audio file persistence.
- Retry logic for DB writes during a call (transient failures could lose data).
- Date range filters on dashboard metrics.
- Booking filler message ("One moment...") during Cal.com API call.
- `caller_name` and `summary` columns in call_logs.
- `notification_events` table for SMS audit trail.
- Graceful SIGTERM handling for clean SIP hangup.
- Language usage, peak call hours, and repeat callers metrics.

---

## 6. Legacy Documents Archived

The following 18 markdown files were moved to `/archive-docs/` on 2026-05-08. Each was inspected and determined to be legacy, duplicate, superseded, or conflicting with the current architecture:

| Archived File | Reason |
|---------------|--------|
| `README.md` | Described "Outbound Calling Agent" with Deepgram; completely wrong for current inbound platform |
| `CODEBASE_ANALYSIS.md` | Outbound focus, referenced `OutboundAssistant`, `TransferFunctions`, Deepgram |
| `COOLIFY_DEPLOYMENT.md` | Wrong deployment target (Coolify, not Easypanel); references `ui_server.py`, Telegram |
| `LOCAL_STARTUP_GUIDE.md` | References `ui_server.py` as dashboard, outbound calls, contains debug notes mixed in |
| `PYTHON_BASICS.md` | Beginner tutorial referencing legacy `ui_server.py` and `config.json` workflow |
| `QUICKSTART.md` | "Daisy's Med Spa", hosted Supabase, Telegram, old schema, outbound calls |
| `SUPABASE_SETUP.md` | Hosted Supabase setup with old schema; project now uses plain PostgreSQL |
| `VERCEL_DEPLOYMENT.md` | Discusses Vercel vs Coolify; both irrelevant (Easypanel is target) |
| `SOP.md` | 1200-line generic AI agent SOP; not project-specific |
| `saravm.md` | Standalone Sarvam implementation tutorial; useful reference but not architecture doc |
| `mpconfig.md` | Superseded MCP/Google Calendar post-call booking approach; current system uses Cal.com |
| `transfer_call.md` | Outbound SIP transfer guide; not current focus |
| `frontend.md` | Frontend plan mentioning Supabase; superseded by actual implementation |
| `CURRENT_CODE_REVIEW.md` | Detailed code review; superseded by this REVIEW.md |
| `AGENTS.md` | 9-line build instructions; incorporated into PLAN.md |
| `plan.md` | 10-part roadmap; superseded by /docs/PLAN.md (now 15 parts) |
| `review.md` | Senior codebase audit; superseded by this REVIEW.md |
| `agent.md` | Core AI instructions; superseded by /docs/LOGIC.md + PLAN.md |

---

## 7. Code Areas Known to Need Follow-Up

These are specific code locations that need attention in Parts 11–15:

### Immediate (Part 11 — Multilingual)

| File | Lines | What |
|------|-------|------|
| `agent.py` | ~33-36 | `AgentConfig` dataclass missing `language_code` field |
| `agent.py` | ~56 | STT `language="unknown"` hardcoded |
| `agent.py` | ~68-69 | TTS `target_language_code="hi-IN"`, `speaker="kavya"` hardcoded |
| `agent.py` | ~171 | `fetch_active_agent_config()` query doesn't SELECT `language_code` |
| `frontend/lib/agent-config-data.ts` | ~17-23, ~49-57 | Query doesn't fetch `language_code` |
| `frontend/app/agent-config/actions.ts` | ~32-77 | Save action ignores `language_code` |
| `frontend/app/agent-config/config-form.tsx` | ~48-84 | No language selector UI |

### Next (Part 12 — Latency)

| File | Lines | What |
|------|-------|------|
| `tools.py` | ~91-144 | No filler speech before Cal.com API call |
| `agent.py` | ~49 | VAD threshold clamping doesn't validate practical Silero range |
| `agent.py` | ~66 | `max_completion_tokens=160` may truncate complex booking responses |

### Later (Part 13 — CRM Intelligence)

| File | Lines | What |
|------|-------|------|
| `schema.sql` | ~3-11 | Missing `caller_name`, `summary` columns in `call_logs` |
| `frontend/app/crm/page.tsx` | ~41-127 | No search/filter UI |
| `frontend/lib/operations-data.ts` | ~58 | `buildTranscriptSummary()` is raw concatenation |

### Production (Part 14 — Hardening)

| File | What |
|------|------|
| `frontend/` | No `/api/health` endpoint |
| `init_db.py` | Only validates `DATABASE_URL`; other required env vars not checked |
| `agent.py` | No SIGTERM handler for graceful SIP hangup |
| `schema.sql` | No `notification_events` table |

---

## 8. Architectural Drift Noted

1. **Supabase → PostgreSQL migration residue.** The data layer migration is structurally complete, but UI labels, dead `supabase-server.ts`, and archived docs still reference Supabase. No Supabase SDK is used in active code.
2. **Language_code declared but never wired.** The schema and archived `agent.md` both declare `language_code` support, but zero runtime code uses it. TTS is hardcoded to Hindi.
3. **Port inconsistency.** `supervisord.conf` and Dockerfile now use port 3000 for the dashboard. Older archived docs reference port 8000. The archived `ui_server.py` shim still mentions 8000.
4. **Outbound remnants.** `archive-docs/legacy-runtime/make_call.py`, `setup_trunk.py`, `transfer_call.md`, and outbound references in archived docs are present but not part of the inbound platform.
5. **Booking approach divergence.** Archived `mpconfig.md` describes a post-call MCP/Google Calendar approach. Active code uses during-call Cal.com booking via `tools.py`. Both are valid approaches but only the Cal.com path is production code.
6. **Notification provider divergence.** `archive-docs/legacy-runtime/notify.py` contains Telegram/WhatsApp code. `notifications.py` contains the active Fast2SMS code. They are separate files with no connection.
