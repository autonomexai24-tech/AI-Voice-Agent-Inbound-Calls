# REVIEW.md — Repository Snapshot

> **As of:** 2025-07-03
> **Scope:** Factual assessment of the current repository state.
> **Authority:** Subordinate to `/docs/PLAN.md`.

---

## 1. What the Repository Contains

### Active Source Files

| File | Purpose |
|------|---------|
| `agent.py` | LiveKit voice agent entrypoint; call lifecycle; config loading; multilingual runtime; transcript logging; post-call SMS trigger; notification event recording; env validation |
| `db.py` | PostgreSQL connection helpers via `psycopg2` with context manager |
| `tools.py` | Cal.com booking tool; LLM-callable `book_appointment` with verbal confirmation; persists caller name to `call_logs` |
| `notifications.py` | Fast2SMS post-booking SMS sender with `SmsSendResult` structured response |
| `init_db.py` | Schema initialization with 30-retry startup loop and DATABASE_URL validation |
| `start.sh` | Container startup: runs `init_db.py` then launches Supervisor; aborts on DB init failure |
| `supervisord.conf` | Runs `python agent.py start` + `node server.js` from `.next/standalone` |
| `Dockerfile` | Multi-stage: Node 20 builder → Python 3.11 builder → python:3.11-slim runtime with ffmpeg + Supervisor; HEALTHCHECK against `/api/health` |
| `schema.sql` | Table definitions (call_logs, transcripts, bookings, notification_events, agent_config) + idempotent migrations + default seed + indexes |
| `requirements.txt` | Python dependencies |

### Frontend (frontend/)

| File/Path | Purpose |
|-----------|---------|
| `next.config.mjs` | `output: "standalone"` + CSP, HSTS, X-Frame-Options, Permissions-Policy security headers |
| `middleware.ts` | HMAC session auth gate; public routes: `/login`, `/api/health`, `/api/webhook*` |
| `app/layout.tsx` | Root layout with AppShell sidebar |
| `app/login/` | Login page + form + server action |
| `app/dashboard/` | Analytics: metric cards, language usage, peak hours, trends, recent bookings, date range filter |
| `app/crm/` | Call log table with search, date/booking/language/repeat filters, pagination, caller names, summaries |
| `app/crm/[callId]/` | Individual call detail page with full transcript |
| `app/calendar/` | Bookings table with search, date/status filters, pagination |
| `app/agent-config/` | Config form with greeting, system prompt, language selector, mixed-language toggle, VAD threshold, booking instructions |
| `app/business-settings/` | Business identity page (reuses AgentConfigForm) |
| `app/api/health/route.ts` | Structured health endpoint: checks env vars, DB connectivity, schema presence; returns 200/503 |
| `app/api/logout/route.ts` | Logout endpoint: clears session cookie |
| `app/navigation.tsx` | Sidebar: Dashboard, CRM, Calendar, Agent Config, Business |
| `lib/postgres-server.ts` | pg Pool + query helper (server-only; `import "server-only"`) |
| `lib/agent-config-data.ts` | Fetch active config including all business + language fields |
| `lib/dashboard-metrics.ts` | Compute analytics with date range, language usage, peak hours, trends, recent bookings |
| `lib/operations-data.ts` | CRM calls + calendar bookings + call detail queries with filters and pagination |
| `lib/dashboard-auth.ts` | HMAC session cookie logic; configurable session duration via `DASHBOARD_SESSION_MAX_AGE` |

### Database Schema (schema.sql)

```
call_logs:           id (uuid PK), phone_number, caller_name, start_time, duration, status, outcome, summary, language_code, mixed_language_enabled, recording_url, created_at
transcripts:         call_id (uuid FK), speaker, text, timestamp
bookings:            call_id (uuid PK/FK), appointment_time, status, sms_sent
notification_events: id (uuid PK), call_id (uuid FK), channel, provider, event_type, status, provider_response, error_message, created_at
agent_config:        id (uuid PK), business_name, business_phone, business_timezone, booking_instructions, initial_greeting, system_prompt, vad_threshold, language_code, mixed_language_enabled, updated_at
```

---

## 2. What Is Working

- Python compilation of all `.py` files passes.
- Next.js `npm run build` succeeds with standalone output.
- PostgreSQL connection via `DATABASE_URL` (both Python `psycopg2` and Next.js `pg`).
- Dashboard login with `DASHBOARD_PASSWORD` via HMAC session cookie.
- Configurable session duration via `DASHBOARD_SESSION_MAX_AGE` env var (default 12h).
- Logout endpoint (`POST /api/logout`) clears session cookie.
- Middleware redirects unauthenticated users to `/login`.
- Health endpoint (`GET /api/health`) checks env vars, DB connectivity, and schema tables; returns 200/503 JSON.
- Docker HEALTHCHECK pings `/api/health` every 30s.
- Call log creation on inbound call start with `language_code` and `mixed_language_enabled`.
- Transcript persistence turn-by-turn via `asyncio.create_task`.
- Cal.com booking creation via LLM tool call with verbal confirmation filler message in prompt.
- Booking duplicate prevention via `ON CONFLICT (call_id)`.
- SMS duplicate prevention via atomic `sms_sent` claim/release pattern.
- Notification event recording to `notification_events` table after SMS attempt.
- `caller_name` persisted to `call_logs` during booking via `_persist_booking_caller_details()`.
- Call summary auto-generated by `_build_call_summary()` and stored in `call_logs.summary`.
- `init_db.py` retry loop (30 attempts × 2s = 60s max wait).
- `start.sh` aborts with `exit 1` on DB init failure (refuses to start Supervisor).
- Startup environment validation in `agent.py`: checks all required env vars + DB connectivity.
- Multilingual support: `AgentConfig.language_code` and `mixed_language_enabled` fully wired from DB → runtime → STT/TTS.
- Sarvam TTS language and speaker dynamically selected via `_build_runtime_language_config()` using `SARVAM_SPEAKERS_BY_LANGUAGE` map.
- Sarvam STT language set to configured language in fixed mode, or `"unknown"` (auto-detect) when mixed-language is enabled.
- VAD threshold clamped to practical phone-call range (0.3–0.7) by default; override via `ALLOW_FULL_VAD_RANGE` env var.
- Agent config form includes language selector (en-IN, hi-IN, kn-IN), mixed-language toggle, and voice route preview card.
- Business settings page (`/business-settings`) with business name, phone, timezone, booking instructions.
- Save action writes all config fields including language and business settings.
- Dashboard metrics with date range filter (today, 7d, 30d, all), trends, language usage, peak call hours, repeat callers, recent bookings.
- CRM table with search by phone/name, date range filter, booking status filter, language filter, repeat caller filter, pagination.
- CRM call detail page (`/crm/[callId]`) with full transcript, call metadata, and booking info.
- Calendar bookings table with search, date range filter, status filter, pagination.
- Supervisor starts both services with restart policies and SIGTERM propagation.
- Docker multi-stage build structure is correct.
- Security headers emitted via `next.config.mjs`: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.

---

## 3. What Is Partially Working

| Area | Status | Detail |
|------|--------|--------|
| **Call status lifecycle** | ⚠️ | `call_logs.status` is inserted as `"connected"` at start; schema default is `"started"` — minor inconsistency, but completion correctly updates to `"completed"` or `"failed"` |
| **Transcript summary** | ⚠️ | `buildTranscriptSummary()` in `operations-data.ts` concatenates turns (truncated at 180 chars); not a semantic summary. However, `call_logs.summary` now has a generated summary from the agent |
| **Recording persistence** | ⚠️ | `recording_url` column exists in schema but no code populates it; recording URLs are not yet captured from LiveKit |

---

## 4. What Is Broken or Risky

| Issue | Severity | Location |
|-------|----------|----------|
| **Python DB: no connection pooling** | Low | `db.py` opens a new TCP connection per query; acceptable at current scale |
| **Cal.com API version pinned** | Low | `tools.py:163` uses `cal-api-version: 2024-08-13`; may need updating |
| **No retry logic for DB writes during a call** | Medium | Transient DB failures during transcript or booking writes could lose data |
| **Archived legacy files in `archive-docs/`** | Low | Orphaned code (`notify.py`, `ui_server.py`, `make_call.py`, `calendar_tools.py`, `config.json`) exists but is not part of active runtime |

---

## 5. What Is Missing (Future Work)

- Call recording URL capture from LiveKit and storage in `recording_url`.
- Booking cancellation flow from dashboard.
- Rate limiting on login attempts.
- TTS voice selector in agent config (currently auto-selected by language).
- Agent config history / change log.
- Per-user sessions and per-business isolation (Phase 2 multi-tenant).
- SaaS admin panel (Phase 2).

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
| `agent.md` | Core AI instructions; superseded by /docs/AGENT.md + PLAN.md |

---

## 7. Architectural Drift — Resolved

The following issues from the previous review have been resolved:

1. **Supabase → PostgreSQL migration residue.** ✅ Complete. `supabase-server.ts` deleted. No Supabase SDK references remain in active code. All data access uses raw PostgreSQL via `psycopg2` (Python) and `pg` (Node.js).
2. **Language_code declared but never wired.** ✅ Fully wired. `AgentConfig` dataclass includes `language_code` and `mixed_language_enabled`. Runtime selects STT language, TTS language, and TTS speaker dynamically. Dashboard has language selector and mixed-language toggle.
3. **Port inconsistency.** ✅ Resolved. Active code consistently uses port 3000. Archived docs referencing port 8000 are non-authoritative.
4. **Missing health endpoint.** ✅ Implemented. `/api/health` checks env vars, DB connectivity, and schema tables. Dockerfile HEALTHCHECK uses it.
5. **Missing env validation.** ✅ Implemented. `validate_startup_environment()` in `agent.py` checks all required env vars and DB connectivity at startup.
6. **Missing caller_name/summary columns.** ✅ Both exist in schema and are populated by runtime code.
7. **Missing notification_events table.** ✅ Created in schema; SMS results are recorded via `record_notification_event()`.

### Remaining drift (non-blocking)

1. **Outbound remnants.** `archive-docs/legacy-runtime/make_call.py` and outbound references in archived docs exist but are not part of the inbound platform.
2. **Booking approach divergence.** Archived `mpconfig.md` describes a post-call MCP/Google Calendar approach. Active code uses during-call Cal.com booking via `tools.py`. Only the Cal.com path is production code.
3. **Notification provider divergence.** `archive-docs/legacy-runtime/notify.py` contains Telegram/WhatsApp code. `notifications.py` contains the active Fast2SMS code. They are separate files with no connection.
