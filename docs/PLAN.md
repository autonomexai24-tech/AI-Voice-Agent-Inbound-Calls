# PLAN.md — Master Architecture & Roadmap

> **Authority:** This document is the single source of truth for the entire repository.
> Any other markdown file that conflicts with this document is outdated and must be treated as archived.
> Last updated: 2026-05-08 (Stage 3 update)

---

## 1. Purpose

This repository builds a **professional inbound AI voice platform** for businesses. The first deployment target is a dental clinic, but the architecture is prompt-driven so it can be adapted to other business types (med spas, law offices, service providers) by changing the system prompt and agent configuration — not by rewriting code.

The platform:
- Answers inbound phone calls through a LiveKit Agents voice worker.
- Conducts natural, low-latency voice conversations using OpenAI for reasoning and Sarvam AI for Indian-language STT/TTS.
- Books appointments through Cal.com during the call.
- Sends SMS confirmations through Fast2SMS after confirmed bookings only.
- Exposes a clean, minimal operator dashboard built with Next.js.
- Persists call logs, transcripts, bookings, and agent configuration in PostgreSQL.
- Deploys as a single Docker container on Easypanel / KVM2 VPS using Supervisor.

---

## 2. Product Principles

These rules apply globally across all implementation work.

1. **Low latency matters most.** Voice naturalness depends on sub-second response times. Every architectural choice must preserve this.
2. **Short and natural phone responses.** The agent speaks in concise, conversational sentences — never lectures or lists.
3. **No multi-step routing or agentic RAG.** Do not implement multi-step LLM routing, Agentic RAG, or Vectorless/Tree RAG. These add multi-second latency that kills voice naturalness.
4. **Business context lives in prompts.** Inject business rules, persona, and context into `system_prompt`. If RAG is ever absolutely required for massive datasets, use only single-step traditional vector RAG via `pgvector`.
5. **Raw PostgreSQL only.** Use `DATABASE_URL` with `psycopg2` (Python) and `pg` (Node.js). Do not use Supabase SDKs or ORMs for application persistence.
6. **Secrets stay server-side.** Database credentials, API keys, and service role tokens must never appear in client bundles, committed files, or frontend code.
7. **SMS only after confirmed booking.** Fast2SMS is triggered exclusively after a booking record reaches confirmed status. Never for missed calls, abandoned calls, or non-booking conversations.
8. **No unnecessary rewrites.** Do not rewrite working production code unless the task explicitly requires it. Prefer small, verifiable, targeted changes.
9. **Prompt-first architecture.** The system adapts to different businesses by changing prompts and configuration, not by forking code paths or adding business-specific modules.
10. **Dashboard truthfulness.** Every metric, label, and status shown in the dashboard must reflect actual database state. No placeholder data, no stale labels, no misleading text.

---

## 3. System Overview

### 3.1 Inbound Call Handling

```
Caller dials DID number
    → Vobiz SIP Trunk
    → LiveKit Cloud SIP Gateway
    → LiveKit dispatch rule spawns agent
    → Python worker (agent.py) joins the room
    → Voice pipeline: Sarvam STT → OpenAI GPT-4o → Sarvam TTS
    → Call ends → finalize_call() shutdown callback
        → drain transcript tasks
        → update call_logs duration/status/outcome
        → send post-call booking SMS if applicable
```

### 3.2 Voice Agent

- **Runtime:** Python 3.11, LiveKit Agents SDK
- **STT:** Sarvam AI `saaras:v3` (auto-detect or configured language)
- **LLM:** OpenAI `gpt-4o` with `max_completion_tokens=160`
- **TTS:** Sarvam AI `bulbul:v3` (language and speaker from config)
- **VAD:** Silero with configurable `activation_threshold` from dashboard
- **Tools:** `book_appointment` — Cal.com booking with verbal confirmation required

### 3.3 Dashboard

- **Framework:** Next.js with `output: "standalone"`
- **Pages:** Login, Dashboard (analytics), CRM (call log), Calendar (bookings), Agent Config
- **Auth:** Single `DASHBOARD_PASSWORD` via HMAC session cookie
- **Data access:** Server-only PostgreSQL queries via `pg` pool; `DATABASE_URL` never exposed to browser

### 3.4 Booking

- **Provider:** Cal.com API v2
- **Flow:** Agent asks preference → confirms verbally → books directly (no pre-check) → persists to PostgreSQL
- **Dedup:** `ON CONFLICT (call_id) DO UPDATE` ensures one booking per call

### 3.5 SMS

- **Provider:** Fast2SMS (India-only)
- **Trigger:** Post-call shutdown callback, only for confirmed bookings
- **Dedup:** Two-layer — `sms_sent` boolean flag + confirmed status check

### 3.6 Persistence

- **Engine:** Easypanel-managed PostgreSQL
- **Connection:** `DATABASE_URL` with internal Docker service name
- **Tables:** `call_logs`, `transcripts`, `bookings`, `agent_config`
- **Init:** `init_db.py` with 30-retry startup loop; `start.sh` runs it before Supervisor

### 3.7 Deployment

- **Target:** Docker on Easypanel / KVM2 VPS
- **Image:** Multi-stage build — Node builder → Python builder → `python:3.11-slim` runtime with `ffmpeg` + Supervisor
- **Process manager:** Supervisor runs `python agent.py start` + `node server.js` from `.next/standalone`
- **Port:** `3000` (Next.js dashboard, Easypanel routes public HTTPS here)

---

## 4. Roadmap — 15 Parts

### Part 1: Containerization

- **Goal:** Package the voice worker and dashboard into a single Easypanel-ready container.
- **Affects:** Dockerfile, supervisord.conf, start.sh, next.config.mjs
- **Key idea:** Multi-stage Docker build. Python 3.11-slim runtime with ffmpeg and Supervisor. Next.js standalone output with `node server.js`. No dev servers in production.
- **Acceptance criteria:**
  - Container starts with Supervisor as PID 1.
  - Dashboard reachable on port 3000.
  - LiveKit worker starts and restarts on failure.
  - No Python or Next.js dev server in production.
- **Must not:** Add additional HTTP servers on the same port. Use `npm start` instead of `node server.js`.

### Part 2: Database Layer

- **Goal:** Connect the platform to a single Easypanel-managed PostgreSQL database.
- **Affects:** db.py, init_db.py, schema.sql, postgres-server.ts, .env
- **Key idea:** Raw PostgreSQL via `DATABASE_URL`. Percent-encode special characters. Internal Docker service name routing. Tables for call_logs, transcripts, bookings, agent_config.
- **Acceptance criteria:**
  - Backend writes call events to PostgreSQL.
  - Dashboard reads analytics and CRM data from PostgreSQL.
  - Credentials never exposed in client bundles.
- **Must not:** Use Supabase SDKs. Expose `DATABASE_URL` in frontend code. Use an ORM.

### Part 3: Inbound Orchestration

- **Goal:** Receive inbound SIP calls through LiveKit Cloud and route them into the Python agent worker.
- **Affects:** agent.py, LiveKit Cloud SIP trunking config
- **Key idea:** Vobiz SIP trunk → LiveKit dispatch rule → Python worker joins room → deterministic lifecycle (start → conversation → booking → end → post-call).
- **Acceptance criteria:**
  - Inbound calls reliably create LiveKit sessions.
  - Each call gets a unique UUID call record in PostgreSQL.
  - Failed sessions are logged with actionable error info.
- **Must not:** Break the existing inbound call flow. Add outbound-only logic to the inbound path.

### Part 4: AI Voice Brain

- **Goal:** Build a responsive multilingual AI voice agent.
- **Affects:** agent.py, agent_config table
- **Key idea:** OpenAI for reasoning, Sarvam for speech. Load greeting, system_prompt, vad_threshold, and language_code dynamically from dashboard config. Tune VAD for noisy inbound environments.
- **Acceptance criteria:**
  - Agent greets callers consistently using configured greeting.
  - Agent follows dashboard-configured system prompt.
  - VAD settings adjustable without code deployment.
  - Transcripts persisted after every call.
- **Must not:** Hardcode language or speaker. Ignore `language_code` from config.

### Part 5: Tooling

- **Goal:** Enable live appointment booking during natural conversation.
- **Affects:** tools.py, calendar_tools.py, bookings table
- **Key idea:** Cal.com API v2 integration. Agent collects name, phone, desired time. Verbal confirmation required before booking. Persist booking to PostgreSQL with call_id linkage.
- **Acceptance criteria:**
  - Agent books appointments during live calls.
  - Every booking linked to call record and phone number.
  - Failures explained gracefully to caller.
- **Must not:** Book without verbal confirmation. Use MCP or Google Calendar (use Cal.com).

### Part 6: SMS Notification

- **Goal:** Send Fast2SMS confirmation after successful booking only.
- **Affects:** notifications.py, agent.py (finalize_call)
- **Key idea:** Trigger in shutdown callback. Check confirmed status + sms_sent flag. Include appointment date, time, business name, callback number. Persist SMS status.
- **Acceptance criteria:**
  - SMS never sent for non-booking calls.
  - SMS sent once per confirmed booking.
  - Failed attempts visible in logs.
- **Must not:** Send SMS during the call. Send duplicate SMS. Send SMS for non-confirmed bookings.

### Part 7: Next.js Dashboard

- **Goal:** Build a clean analytics dashboard for business operators.
- **Affects:** frontend/app/dashboard/
- **Key idea:** Analytics cards for Total Calls, Booking Rate, Average Duration, Missed/Failed Calls. Charts for call volume and booking success over time. Date range filters.
- **Acceptance criteria:**
  - Dashboard loads quickly on Easypanel.
  - Metrics match PostgreSQL data exactly.
  - UI is spacious, professional, Vapi-like.
- **Must not:** Show placeholder or stale data. Reference Supabase in UI labels. Display metrics without date filtering.

### Part 8: Next.js CRM & Calendar

- **Goal:** Provide caller log and appointment tracking for operators.
- **Affects:** frontend/app/crm/, frontend/app/calendar/
- **Key idea:** Caller log table with phone, name, last call, status, summary. Transcript detail view. Appointment tracker with time, caller, booking status, SMS status. Search by phone and name.
- **Acceptance criteria:**
  - Operators find callers quickly.
  - Operators review transcripts and summaries.
  - Operators see all upcoming and historical bookings.
- **Must not:** Expose raw database IDs to operators. Lose search functionality.

### Part 9: UI Configuration

- **Goal:** Allow operators to control agent behavior without code changes.
- **Affects:** frontend/app/agent-config/, agent_config table
- **Key idea:** Config page for initial_greeting, system_prompt, vad_threshold, and language_code. Validate ranges. Save with timestamps. New calls load latest config.
- **Acceptance criteria:**
  - Operators edit agent behavior without deployment.
  - Invalid VAD settings blocked.
  - Language selector works for en-IN, hi-IN, kn-IN.
  - New calls use latest saved config.
- **Must not:** Allow empty greetings or prompts. Expose config save to unauthenticated users.

### Part 10: Security & Launch

- **Goal:** Secure the dashboard and deploy to Easypanel.
- **Affects:** middleware.ts, dashboard-auth.ts, Easypanel config
- **Key idea:** Password protection via `DASHBOARD_PASSWORD`. All secrets in Easypanel env vars. Public domain with TLS. Launch tests for calls, booking, SMS, dashboard, CRM.
- **Acceptance criteria:**
  - Dashboard inaccessible without password.
  - Production secrets not in source control.
  - Platform can receive calls, book, send SMS, display analytics.
- **Must not:** Hardcode passwords. Commit `.env` with real values. Skip launch verification.

### Part 11: Multilingual Runtime Wiring

- **Goal:** Wire `language_code` through the entire runtime so the agent speaks the correct language.
- **Affects:** agent.py (AgentConfig, STT, TTS), agent_config table, frontend config form, frontend save action
- **Key idea:** Add `language_code` to the AgentConfig dataclass. Map language codes to Sarvam STT/TTS settings (en-IN, hi-IN, kn-IN). Add language selector dropdown to dashboard config page. Load and apply language on every new call.
- **Depends on:** Nothing — this is the first execution step.
- **Acceptance criteria:**
  - Operator selects language in dashboard; next call uses it.
  - STT language hint matches config (or "unknown" for auto-detect).
  - TTS target_language_code and speaker match selected language.
  - Mixed-language calls handled gracefully via Sarvam auto-detect.
- **Deliverables:**
  1. `AgentConfig` dataclass includes `language_code`.
  2. `fetch_active_agent_config()` selects `language_code`.
  3. STT and TTS use `language_code` from config instead of hardcoded values.
  4. Language-to-speaker mapping function (e.g., `hi-IN → kavya`, `en-IN → amelia`).
  5. Dashboard config form has language selector dropdown.
  6. Dashboard save action writes `language_code`.
- **Must not:** Hardcode `hi-IN` or any fixed language. Break existing call flow. Add auto-detection logic that switches language mid-call.

### Part 12: Latency & Conversation Optimization

- **Goal:** Minimize dead air and make conversations feel natural.
- **Affects:** agent.py (endpointing, VAD, token limits, system prompt), tools.py (booking filler message)
- **Depends on:** Part 11 — language settings affect STT/TTS latency characteristics.
- **Key idea:** Validate VAD threshold against Silero's practical range (0.3–0.7). Add filler speech ("One moment, let me check that...") before Cal.com API calls. Tune max_completion_tokens for concise but complete responses. Review endpointing delays.
- **Acceptance criteria:**
  - No dead air longer than 2 seconds during normal conversation.
  - Booking tool calls preceded by spoken filler.
  - VAD threshold clamped to tested safe range.
  - Truncated responses rare or eliminated.
- **Deliverables:**
  1. VAD threshold clamped to 0.3–0.7 (with override capability).
  2. Booking policy updated to include filler speech instruction.
  3. `max_completion_tokens` reviewed and adjusted if truncation observed.
  4. Endpointing delays tested with real calls and adjusted if needed.
- **Must not:** Add multi-step routing or RAG. Increase LLM token limit beyond what voice delivery requires.

### Part 13: CRM Intelligence & Dashboard Truthfulness

- **Goal:** Make the CRM useful for operators and ensure dashboard shows only real data.
- **Affects:** schema.sql (caller_name, summary columns), agent.py (name persistence), frontend CRM/calendar/dashboard pages
- **Depends on:** Parts 11–12 should be complete so CRM data reflects multilingual calls.
- **Key idea:** Add `caller_name` and `summary` columns to `call_logs`. Persist caller name from booking tool. Add search/filter to CRM table. Add transcript detail view per call. Add date range filters to all pages. Fix stale dashboard labels.
- **Acceptance criteria:**
  - Caller names visible in CRM when collected during booking.
  - CRM searchable by phone number and name.
  - Individual call detail page shows full transcript.
  - Date range filters on dashboard, CRM, and calendar.
  - No stale Supabase labels or placeholder data.
- **Deliverables:**
  1. `caller_name` column added to `call_logs`.
  2. `summary` column added to `call_logs` (post-call, not blocking conversation).
  3. CRM search by phone number and caller name.
  4. CRM transcript detail route (`/crm/[callId]`).
  5. Date range filter component on dashboard, CRM, calendar.
  6. Remove "Supabase service role server fetch" label from dashboard.
  7. Pagination or infinite scroll on CRM and calendar.
- **Must not:** Add AI-generated summaries that increase call latency. Build semantic search or analytics. Store PII without purpose.

### Part 14: Production Hardening & Observability

- **Goal:** Make the platform reliable and diagnosable in production.
- **Affects:** frontend API routes (health endpoint), agent.py (SIGTERM handling, env validation), init_db.py, Dockerfile
- **Depends on:** Parts 11–13 — hardening should be applied to the complete feature set.
- **Key idea:** Add `/api/health` endpoint for Easypanel health checks. Validate all required env vars at startup. Handle SIGTERM for clean SIP hangup. Add `notification_events` table for SMS audit trail. Consider Python connection pooling for scale. Add structured logging. Redact secrets from error messages.
- **Acceptance criteria:**
  - Health endpoint returns 200 when DB is reachable, 503 otherwise.
  - Container startup fails fast with clear error if required env vars missing.
  - Graceful shutdown drains active calls on SIGTERM.
  - SMS send/fail events recorded in database.
  - No secrets in log output.
- **Deliverables:**
  1. `/api/health` route in Next.js.
  2. Env var validation at agent startup (fail-fast with clear messages).
  3. SIGTERM handler in agent.py (stop accepting jobs, drain active calls, exit).
  4. `notification_events` table for SMS audit trail.
  5. Structured JSON logging with call_id correlation.
  6. Secret redaction in error logs.
  7. Configurable session duration (currently fixed at 12 hours via `maxAge`).
  8. Logout endpoint.
- **Must not:** Add complex monitoring infrastructure. Over-engineer for current scale. Add Prometheus/Grafana/Datadog.

### Part 15: Launch Validation & Operational Runbook

- **Goal:** Verify the entire platform works end-to-end before production traffic.
- **Affects:** All components
- **Depends on:** Parts 11–14 complete.
- **Key idea:** Write a launch checklist covering: inbound call test, booking test, SMS test, dashboard login test, CRM data test, config change test, container restart test, health check test. Document the exact Easypanel deployment steps. Document rollback procedure.
- **Acceptance criteria:**
  - Every checklist item passes on the production deployment.
  - Runbook is complete enough for someone unfamiliar with the codebase to deploy.
  - Rollback procedure tested.
- **Deliverables:**
  1. `/docs/RUNBOOK.md` with step-by-step deployment and rollback.
  2. Launch checklist (testable items, pass/fail).
  3. Post-launch monitoring checklist.
  4. Easypanel, health, multilingual, booking, SMS, CRM, restart, rollback, and backup validation steps.
  4. Known issues and workarounds documentation.
- **Must not:** Launch without completing the checklist. Skip SMS provider validation with production credentials.

---

## 5. Execution Order

Parts 11–15 must be executed in strict sequence:

```
Part 11 → Part 12 → Part 13 → Part 14 → Part 15
```

### Why this order matters

| Part | Why it must come first |
|------|----------------------|
| **11 first** | Language settings change STT/TTS behavior. All later tuning (latency, VAD, conversation) must be tested against the correct language configuration. |
| **12 after 11** | Latency tuning (endpointing, filler speech, token limits) depends on the actual STT/TTS pipeline that Part 11 configures. |
| **13 after 12** | CRM data quality depends on the runtime behavior being stable. Search, filters, and transcript views are only useful if call data is consistent. |
| **14 after 13** | Production hardening (health checks, logging, env validation) should be applied to the complete feature set, not to a partial system. |
| **15 last** | Launch validation tests everything. It makes no sense to validate before all features are implemented. |

---

## 6. Execution Rules

These rules govern how future Codex/CLI/AI work proceeds:

1. **Execute parts in sequence.** Part 11 → 12 → 13 → 14 → 15. Never skip ahead.
2. **Do not jump across parts without reason.** Complete or explicitly defer each part before starting the next.
3. **No unrelated refactors.** If working on Part 11 (multilingual), do not refactor the booking tool, dashboard layout, or deployment config. Each part touches only its listed files.
4. **Preserve the working call flow.** The current inbound pipeline (call → transcript → booking → SMS) is functional. Never break it in pursuit of an improvement.
5. **Keep docs synchronized.** When implementation changes a behavior described in any `/docs/*.md` file, update the relevant doc in the same commit or immediately after.
6. **Verify before marking done.** Each part's acceptance criteria must be tested — not just coded — before the part is considered complete.
7. **Commit discipline.** One logical change per commit. Include the Part number in commit messages (e.g., `Part 11: wire language_code through AgentConfig`).
8. **No unrelated dependencies.** Do not add npm packages, pip packages, or infrastructure components unless the current part explicitly requires them.
9. **No premature SaaS work.** Multi-tenant features, per-business isolation, and admin panels are Phase 2+. Do not add business_id columns, user tables, or role logic during Parts 11–15.

---

## 7. Documentation Hierarchy

```
/docs/PLAN.md              ← Master source of truth (this file)
/docs/REVIEW.md            ← Repository snapshot and known issues
/docs/LOGIC.md             ← Global operating logic and behavioral rules
/docs/AGENT.md             ← Voice agent runtime behavior
/docs/DATABASE_POSTGRES.md ← PostgreSQL layer and schema
/docs/CALL_FLOW.md         ← End-to-end call lifecycle
/docs/LATENCY.md           ← Latency rules and bottlenecks
/docs/BOOKING.md           ← Booking behavior and Cal.com integration
/docs/SMS.md               ← SMS notification behavior
/docs/FRONTEND.md          ← Dashboard architecture and multi-business structure
/docs/DEPLOYMENT.md        ← Deployment architecture and production operations
/docs/SECURITY.md          ← Security architecture and data privacy
/docs/FINAL_EXECUTION_DEBUGGING.md ← Final Parts 11-15 implementation reality check
```

### Rules

- **PLAN.md overrides all other markdown docs.** Any conflicting document in the repo or in `/archive-docs/` must be treated as outdated.
- **Archive stale docs instead of mixing.** Legacy docs are preserved in `/archive-docs/` for historical reference but carry no authority.
- **New docs go in `/docs/`.** If a new document is needed (e.g., a runbook), create it in `/docs/` and reference it from PLAN.md.
- **No duplicate docs.** There is exactly one PLAN.md, one AGENT.md, one FRONTEND.md, one DEPLOYMENT.md, one SECURITY.md. Never create copies.
- **Every doc references PLAN.md.** All subordinate docs include a header stating they are subordinate to `/docs/PLAN.md`.

---

## 8. Business Presets

The current default operating preset:

| Setting | Value |
|---------|-------|
| **Business type** | Dental clinic |
| **Agent persona** | Formal receptionist |
| **Response style** | Short and fast |
| **Languages** | English (en-IN) + Hindi (hi-IN) + Kannada (kn-IN) + mixed-language |
| **Default language** | en-IN |
| **Booking flow** | Ask preference → confirm verbally → book directly (no pre-check) |
| **Storage** | Transcript + recording links (provider recordings) |
| **CRM approach** | Simple operator CRM first |
| **UI style** | Light, minimal, Vapi-like, clean and professional |
| **Uncertainty handling** | Always ask again instead of guessing |
| **Failure handling** | Use softer fallback responses |
| **Multi-business** | Later (prompt-driven, no code forks) |
| **WhatsApp** | Roadmap only, not implemented |

### Top Dashboard Metrics

- Booked appointments (primary — this is the business goal)
- Total calls
- Booking conversion rate
- Average call duration
- Missed / failed calls
- Language usage (when tracked per call)
- Repeat callers (when caller identity is tracked)
- Peak call hours

### Main Business Goal

High booking conversion — the platform exists to convert inbound calls into confirmed appointments.

---

## 9. India Pricing Optimization

Every architecture decision is a cost decision. The platform is designed for India-first pricing, where ₹1,500/month for infrastructure is significant.

### Cost structure per 1,000 calls/month

| Component | Estimated monthly cost |
|-----------|----------------------:|
| VPS (KVM2, 4 GB RAM) | ₹1,500–2,500 |
| OpenAI GPT-4o (~800 tokens/call) | ₹150–300 |
| Sarvam STT/TTS | ₹200–500 |
| Cal.com (free tier or paid) | ₹0–1,000 |
| Fast2SMS (per-SMS pricing) | ₹50–200 |
| PostgreSQL (bundled with VPS) | ₹0 |
| Recording storage | ₹0 (provider recordings) |
| **Total** | **₹1,900–4,500** |

### What keeps costs low

1. **Single container** — one VPS, not a cluster.
2. **No duplicate recording storage** — use provider recordings, store links only.
3. **No vector database** — business context fits in system prompt.
4. **No multi-agent orchestration** — one LLM call per turn.
5. **Concise system prompts** — under 300 tokens.
6. **Short replies** — `max_completion_tokens=160`.
7. **No GPU dependency** — all inference via API.
8. **Easypanel simplicity** — no DevOps team needed.
9. **Raw SQL** — no ORM runtime overhead.
10. **Standalone Next.js** — lower RAM usage.

### What must NEVER be added without cost justification

- Vector database (Pinecone, Weaviate, etc.)
- Multi-agent orchestration (LangChain, CrewAI, etc.)
- Kubernetes or managed container orchestration
- GPU instances for local inference
- Separate media storage infrastructure (S3, Minio)
- Real-time analytics platforms (Mixpanel, Amplitude)
- Enterprise monitoring (Datadog, New Relic)

---

## 10. Recording Strategy

### Phase 1 (current target): Provider recordings only

- Store recording link in `call_logs.recording_url` (column to be added).
- Use provider recordings from Vobiz SIP trunk or LiveKit Cloud.
- Dashboard shows playback link, not embedded audio.
- **Zero additional storage cost.**

### Phase 2 (optional): Embedded playback

- Audio player in dashboard fetches from external URL.
- Download button for compliance review.

### What must NOT be built

- Custom media storage infrastructure.
- LiveKit Egress recording pipeline.
- Duplicate recordings in platform storage.
- Automatic re-transcription from recordings.

---

## 11. Multi-Business Roadmap

### Phase 1 — Single tenant (CURRENT)

One business, one agent_config, one set of env vars, one deployment.

### Phase 2 — Multi-business (FUTURE)

1. Add `businesses` table: id, name, DID number, config.
2. Add `business_id` to `agent_config`, `call_logs`.
3. Route inbound calls by DID → business_id.
4. Dashboard queries filter by authenticated business.
5. Each business gets isolated analytics, CRM, calendar, config.

### Phase 3 — SaaS (FUTURE)

1. Admin panel for platform owner.
2. Self-service business onboarding.
3. Per-business billing.
4. Usage metering.
5. API key management (per-business or platform-managed).

### Architecture constraint

Multi-business is **prompt-first**: different businesses use different prompts, greetings, languages, and booking settings — not different code paths. The runtime logic is identical for all businesses.

---

## 12. Operational Philosophy

### What the platform IS

- An inbound AI receptionist.
- Multilingual (Hindi, English, Kannada, mixed).
- Low-latency (sub-2-second response).
- Operator-friendly (clean dashboard, simple config).
- Low-cost (India-first pricing).
- Booking-focused (high conversion is the metric).
- Easy to deploy (one container, one VPS, Easypanel).
- Easy to manage (no DevOps expertise required).
- Future SaaS-ready (prompt-driven multi-business).

### What the platform is NOT

- A research framework.
- An orchestration engine.
- An enterprise call center platform.
- A real-time analytics tool.
- A CRM replacement.
- A multi-agent system.

### How the platform should feel

- **Instant** — sub-2-second voice response.
- **Natural** — conversational, not robotic.
- **Reliable** — every call gets logged, every booking gets confirmed.
- **Simple** — operator needs zero technical knowledge.
- **Fast** — dashboard loads in under 2 seconds.
- **Human** — soft failure responses, natural greetings, respectful tone.

---

## 13. Future SaaS Roadmap

This section documents the long-term direction. **None of this should be implemented during Parts 11–15.**

### Self-service onboarding

1. Business signs up via web form.
2. Platform creates business record, default config, DID assignment.
3. Business owner logs in and customizes prompt, greeting, language.
4. First inbound call works within minutes of onboarding.

### Billing

1. Per-call pricing or monthly subscription.
2. Usage metering (calls, minutes, bookings, SMS).
3. Invoice generation.
4. Payment integration (Razorpay for India).

### Platform admin

1. View all businesses.
2. Monitor call volume across businesses.
3. Manage DID numbers.
4. Override business configs.
5. Disable/enable businesses.

### API access

1. Business-specific API keys.
2. Webhook notifications for bookings and call events.
3. CRM data export.

### Long-Term Direction

SaaS platform: multi-tenant, self-service onboarding, per-business configuration. This is a future phase and must not influence current single-tenant architecture decisions.
