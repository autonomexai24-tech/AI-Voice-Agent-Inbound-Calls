# Execution Review — debugging.md

Cross-reference of `archive-docs/agent.md` (core AI instructions), `archive-docs/plan.md` (original 10-part roadmap), and `docs/PLAN.md` (extended Parts 11–15) against the actual codebase state as of commit `22d42d2`.

---

## 1. Completed Execution

### Original 10-Part Roadmap (archive-docs/plan.md)

| Part | Title | Status | Evidence |
|------|-------|--------|----------|
| **1** | Containerization | **DONE** | `Dockerfile` multi-stage build (frontend-builder → python-builder → runtime). `supervisord.conf` runs both `python agent.py start` and `node server.js` from `.next/standalone`. Port 3000 exposed. `start.sh` runs `init_db.py` before Supervisor. |
| **2** | Database Layer | **DONE** | `db.py` uses `psycopg2` with `DATABASE_URL`. `schema.sql` defines `call_logs`, `transcripts`, `bookings`, `agent_config`, `notification_events`. `init_db.py` applies schema at startup. No Supabase SDK anywhere in codebase. |
| **3** | Inbound Orchestration | **DONE** | `agent.py` `entrypoint()` connects to LiveKit room, extracts SIP metadata for caller phone, creates call record via `create_call_log()`, starts `VoicePipelineAgent`, registers `finalize_call` shutdown callback. |
| **4** | AI Voice Brain | **DONE** | `agent.py` uses OpenAI GPT-4o for LLM, Sarvam `saaras:v3` for STT, Sarvam `bulbul:v3` for TTS. VAD via Silero with configurable threshold. `InboundAssistant` builds system prompt with business, language, response, and booking policies. Transcript logging via `_attach_transcript_logging`. |
| **5** | Tooling (Booking) | **DONE** | `tools.py` implements `book_appointment` as `@llm.function_tool`. Validates caller name/phone/datetime, calls Cal.com v2 API, persists to `bookings` table, persists caller details to `call_logs`. Error handling for timeout, validation, API failure. |
| **6** | SMS Notification | **DONE** | `notifications.py` sends via Fast2SMS after confirmed booking only. `agent.py` `record_notification_event()` writes to `notification_events` table. Duplicate prevention via `ON CONFLICT (call_id)` on bookings. |
| **7** | Dashboard | **DONE** | `frontend/app/dashboard/page.tsx` shows 6 analytics cards (total calls, booked, conversion, failed, avg duration, repeat callers). Trend chart, language usage bars, peak call hours, recent bookings. Date range filter (today/7d/30d/all). |
| **8** | CRM & Calendar | **DONE** | `frontend/app/crm/page.tsx` with search (phone/name), filters (booking, language, repeat, date range), pagination. `frontend/app/crm/[callId]/page.tsx` with chat-bubble transcript timeline. `frontend/app/calendar/page.tsx` with booking table, status filter, date filter. |
| **9** | UI Configuration | **DONE** | `frontend/app/agent-config/config-form.tsx` with fields for greeting, system prompt, VAD threshold, language selector (en-IN/hi-IN/kn-IN), mixed-language toggle, booking instructions, business name/phone/timezone. `frontend/app/agent-config/actions.ts` persists to PostgreSQL. New calls pick up latest config via `fetch_active_agent_config()`. |
| **10** | Security & Launch | **DONE** | `DASHBOARD_PASSWORD` env var. `frontend/middleware.ts` protects all routes except `/login` and `/api/health`. `frontend/lib/dashboard-auth.ts` uses SHA-256 + HMAC with constant-time comparison. `frontend/app/login/` with login form. `POST /api/logout` clears session. No secrets in frontend code or committed files. |

### Extended Parts 11–15 (docs/PLAN.md)

| Part | Title | Status | Evidence |
|------|-------|--------|----------|
| **11** | Multilingual Runtime | **DONE** | `agent.py` wires `language_code` and `mixed_language_enabled` through `AgentConfig` → `RuntimeLanguageConfig` → Sarvam STT/TTS. Supports en-IN, hi-IN, kn-IN with per-language speakers. Mixed-language uses `language="unknown"` for auto-detect. Frontend config UI has language selector + toggle. `schema.sql` has both columns on `call_logs` and `agent_config`. Commit `b655884`. |
| **12** | Latency Optimization | **DONE** | VAD clamped 0.3–0.7 via `_clamp_vad_threshold()` with `ALLOW_FULL_VAD_RANGE` override. `max_completion_tokens=150` (bumped from 120 for Indic headroom). Dead-air prevention in response policy. Booking filler in both prompt and tool description. `preemptive_generation=True`. Endpointing min=0.15s, max=0.8s. Commit `eced88e`. |
| **13** | CRM Intelligence | **DONE** | `caller_name` and `summary` columns in `call_logs`. `_build_call_summary()` writes post-call. `_persist_booking_caller_details()` saves name from booking. CRM search by phone + name. Transcript detail route. Date range filters on all pages. No Supabase labels. Pagination on CRM + calendar. All implemented in commit `b655884`. |
| **14** | Production Hardening | **DONE** | `/api/health` checks DB + env + schema (200/503). `validate_startup_environment()` fails fast. `finalize_call` via `ctx.add_shutdown_callback`. `notification_events` table for SMS audit. `log_event()` structured JSON logging. `_redact_secret_values()` + `redactKnownSecrets()`. `POST /api/logout`. `DASHBOARD_SESSION_MAX_AGE` configurable. Commit `23476bc`. |
| **15** | Launch Validation | **DONE** | `docs/RUNBOOK.md` (400+ lines): deployment SOP, 22-item launch checklist, call validation scripts (EN/HI/KN/mixed), booking/SMS validation, dashboard/CRM validation, latency validation, restart/shutdown SOP, rollback SOP, broken deploy recovery, backup SOP, post-launch monitoring, known issues (6 items), go/no-go criteria. Commit `22d42d2`. |

### Core AI Instructions Compliance (archive-docs/agent.md)

| Rule | Status | Notes |
|------|--------|-------|
| Next.js dashboard, no other framework | **Compliant** | Next.js 15 with App Router |
| Python 3.11 for voice agent | **Compliant** | `python:3.11-slim` in Dockerfile |
| LiveKit Agents for calls | **Compliant** | `livekit-agents` in requirements.txt |
| OpenAI for LLM | **Compliant** | GPT-4o in `agent.py` |
| Sarvam AI for STT/TTS | **Compliant** | saaras:v3 (STT), bulbul:v3 (TTS) |
| Docker + Easypanel + Supervisor | **Compliant** | Single container, dual process |
| Plain PostgreSQL only, no Supabase SDK | **Compliant** | `psycopg2` + `pg` (Node), zero Supabase imports |
| DATABASE_URL server-side only | **Compliant** | Used in `db.py` and `postgres-server.ts` only |
| Fast2SMS post-booking only | **Compliant** | Triggered in `finalize_call` only after confirmed booking |
| DASHBOARD_PASSWORD single auth | **Compliant** | SHA-256 + HMAC session, middleware-protected |
| No secrets in client code or docs | **Compliant** | Env vars only, redacted in logs |
| No multi-step routing or Agentic RAG | **Compliant** | Business context injected into system_prompt |
| Vapi/Retell-style clean dashboard | **Compliant** | White/neutral theme, generous spacing, subtle borders |
| Small verifiable changes | **Compliant** | Focused commits per part |

---

## 2. Not Completed / Gaps

### Functional gaps (minor — no blocking issues)

| Gap | Severity | Detail |
|-----|----------|--------|
| No availability check before booking | Low | `book_appointment` creates bookings directly via Cal.com without a separate availability-check step. Cal.com returns an error if the slot is unavailable, so the agent handles it, but there is no explicit "check available slots" tool. |
| No recording URL population | Low | `call_logs.recording_url` column exists in schema but is never populated. LiveKit recording integration is not implemented. |
| No AI-generated call summary | Low | `summary` is rule-based (`_build_call_summary` returns a fixed template). The plan mentioned post-call summaries but explicitly prohibited AI summaries that increase latency. Current approach is correct per constraints. |
| `calendar_tools.py` unused | Low | File exists at repo root but is never imported. Likely a legacy file from before the Cal.com integration was consolidated into `tools.py`. |
| `config.json`, `ui_server.py`, `notify.py`, `make_call.py` are legacy | Low | These files exist but are not used by the current runtime. They predate the current architecture. |
| Test files are standalone scripts, not a test suite | Low | `test_llm.py`, `test_llm_detailed.py`, `test_session_init.py`, `test_streaming_tts.py` are manual test scripts, not an automated test suite. |

### Deployment verification gaps

| Gap | Severity | Detail |
|-----|----------|--------|
| No live production validation yet | Medium | The RUNBOOK launch checklist exists but has not been executed against the production deployment. All pass/fail columns are empty. |
| Easypanel rebuild not triggered | Medium | Code is pushed to `origin/main` but a fresh Docker rebuild in Easypanel has not been confirmed since the latest commits. |

---

## 3. Next Execution Steps

### Immediate (before production traffic)

1. **Trigger Easypanel rebuild** — Use "Rebuild" (not "Redeploy") to force a fresh Docker build from the latest `origin/main` commit (`22d42d2`). This clears Docker layer cache and ensures all Parts 11–15 changes are in the running container.

2. **Run RUNBOOK §4 launch checklist** — Execute every row in the 22-item launch validation table. Record pass/fail. Stop launch if any required item fails.

3. **Validate health endpoint** — `curl https://<domain>/api/health` must return `200` with all checks `ok`.

4. **Place test calls in all 4 language modes** — English, Hindi, Kannada, mixed-language. Verify STT, TTS, transcript persistence, and booking flow for each.

5. **Validate SMS with production Fast2SMS credentials** — Confirm a booking triggers SMS and the event appears in `notification_events`.

6. **Login/logout cycle** — Verify dashboard login, session persistence, sign-out, and re-authentication.

### Short-term (post-launch stabilization)

7. **Clean up legacy files** — Remove or archive unused root-level files: `calendar_tools.py`, `config.json`, `ui_server.py`, `ui_server.log`, `notify.py`, `make_call.py`. These are not used by the current runtime and add confusion.

8. **Follow RUNBOOK §13 post-launch monitoring** — Check health, container restarts, call records, transcript persistence, SMS audit, and booking success hourly on day one, then daily.

9. **Execute rollback dry-run** — Redeploy a previous commit, verify `/api/health`, place a test call, then redeploy latest. Confirms rollback SOP works.

### Medium-term (when needed)

10. **Add availability check tool** — Create a `check_availability` function tool that queries Cal.com slots before proposing times. Reduces failed booking attempts.

11. **Integrate LiveKit recording** — Populate `recording_url` in `call_logs` if call recording is required for compliance or quality review.

12. **Add automated test suite** — Replace standalone test scripts with a proper test runner (pytest) covering booking flow, SMS logic, and config loading.

13. **Add `ALLOW_FULL_VAD_RANGE` to RUNBOOK** — Document this optional env var for operators who need to tune VAD outside the 0.3–0.7 safe range.

---

## 4. Commit History (Parts 11–15)

| Commit | Part | Summary |
|--------|------|---------|
| `b655884` | 11 | Multilingual runtime, dashboard UI, CRM search fix (16 files, 522 insertions) |
| `eced88e` | 12 | Latency optimization: tokens 120→150, dead-air prevention |
| *(none)* | 13 | Already implemented in Part 11 commit |
| `23476bc` | 14 | Logout endpoint, configurable session, sign-out button |
| `22d42d2` | 15 | Known issues, env checklist update, RUNBOOK finalization |
