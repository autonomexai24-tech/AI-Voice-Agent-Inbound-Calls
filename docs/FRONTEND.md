# FRONTEND.md — Dashboard Architecture & Multi-Business Structure

> **Source files:** `frontend/` directory
> **Subordinate to:** `/docs/PLAN.md`
> **Last verified against code:** 2026-05-08

---

## 1. Frontend Philosophy

The dashboard is an **operator tool**, not a consumer product. It exists so a clinic receptionist, office manager, or business owner can monitor calls, review bookings, configure the voice agent, and verify that the platform is working — without touching code or servers.

### Design direction

- **White backgrounds** with light gray (`neutral-100`) sections.
- **Soft borders** (`border-neutral-200`) and restrained shadows (`shadow-sm`).
- **Simple typography:** Aptos → Inter → system-ui fallback chain.
- **Spacious layout:** Generous padding, max-width containers, breathing room between cards.
- **Minimal distractions:** No animations, no marketing copy, no bright colors except for error/success states.
- **Vapi-inspired:** Clean sidebar navigation, metric cards, operator-first information hierarchy.
- **Responsive:** Sidebar collapses to top nav on mobile; metric cards stack on narrow screens.

### What the dashboard is NOT

- Not a real-time call monitoring tool (no live transcript streaming).
- Not a customer-facing portal.
- Not an analytics platform (no charts, heatmaps, or AI insights — yet).
- Not a CRM replacement (no deal tracking, pipeline stages, or email integration).

---

## 2. Technology Stack

| Layer | Current | Notes |
|-------|---------|-------|
| **Framework** | Next.js 16 with `output: "standalone"` | Standalone output for low-RAM production |
| **React** | React 19 | Server components by default |
| **Styling** | Tailwind CSS 3.4 | No component library (no shadcn/ui yet) |
| **Font** | Aptos → Inter → system-ui | No external font CDN |
| **Auth** | HMAC session cookie via `DASHBOARD_PASSWORD` | No user accounts, no JWT |
| **Data access** | `pg` Pool (server-only) via `DATABASE_URL` | Raw SQL, no ORM |
| **Process** | `node server.js` from `.next/standalone` | Supervisor-managed, port 3000 |

### Why standalone output

Standard `npm start` loads the full `node_modules` directory into memory. The standalone build copies only required files into a self-contained directory. `node server.js` from `.next/standalone` uses ~60-80% less RAM — critical on a KVM2 VPS with limited memory.

---

## 3. Current Pages

### 3.1 Login (`/login`)

- **Purpose:** Gate all dashboard access behind a single password.
- **Current implementation:** Form with password input. On submit, server action validates against `DASHBOARD_PASSWORD`, creates HMAC session token, sets `inbound_dashboard_session` cookie.
- **Public route:** Middleware skips auth check for `/login`.
- **Redirect:** After login, redirects to the page the user originally requested (via `?next=` query param).

### 3.2 Dashboard (`/dashboard`)

- **Purpose:** At-a-glance operational metrics.
- **Current implementation:** Six metric cards — Total Calls, Booked Appointments, Booking Rate, Avg Duration, Failed Calls, Repeat Callers. Server component fetches PostgreSQL aggregates on every page load (`force-dynamic`). Includes date range filter, language usage bars, and peak call hours.
- **Known issues:** No full charting system; intentionally uses lightweight inline bars only.

### 3.3 CRM (`/crm`)

- **Purpose:** Call log with caller details and transcript summaries.
- **Current implementation:** Paginated table with phone number, caller name, start time, duration, status, booking status, language, repeat count, and operator summary. Supports phone/name search plus date range filters. Rows link to full transcript detail.
- **Data source:** Joins `call_logs` + `transcripts` + `bookings`.
- **Missing:** Enterprise CRM workflows are intentionally not implemented.

### 3.4 Calendar (`/calendar`)

- **Purpose:** Appointment tracker for upcoming and historical bookings.
- **Current implementation:** Paginated table with caller name, phone number, appointment time, booking status, SMS sent status, transcript link, caller search, status filter, and appointment date filters.
- **Missing:** Booking cancellation is not implemented.

### 3.5 Agent Config (`/agent-config`)

- **Purpose:** Configure voice agent behavior without code changes.
- **Current implementation:** Form with initial greeting (textarea), system prompt (textarea), primary language dropdown, mixed-language toggle, and VAD threshold (number input). Save action updates `agent_config` table. New calls pick up latest config.
- **Missing:** TTS voice selector, booking settings, config history.

### 3.6 Business Settings (`/business-settings`)

- **Purpose:** Business identity, callback number, timezone, booking rules, and voice runtime behavior.
- **Current implementation:** Reuses `AgentConfigForm` to expose all business-level and voice-runtime config fields. Includes business name, callback phone, timezone, booking instructions, greeting, system prompt, language, mixed-language mode, and VAD threshold.
- **Missing:** Per-business API key management, operator preferences. These are Phase 2+ concerns.

### 3.7 Admin Panel (ROADMAP ONLY)

- **Purpose:** SaaS-level administration — manage multiple businesses, billing, onboarding.
- **Timeline:** Future SaaS phase. Not part of current single-tenant architecture.
- **Must not:** Influence current architecture decisions.

---

## 4. Navigation Structure

Current sidebar navigation (`navigation.tsx`):

```
Dashboard    → /dashboard
CRM          → /crm
Calendar     → /calendar
Agent Config → /agent-config
Business     → /business-settings
```

The sidebar is a persistent left panel on desktop (240px) and a horizontal scrollable nav on mobile. Active page is highlighted with dark background. Login page bypasses the shell entirely.

---

## 5. Multi-Business Architecture

### Core principle: PROMPT-FIRST MULTI-BUSINESS

The platform adapts to different businesses by changing **prompts and configuration**, not by forking code, adding business-specific modules, or deploying separate containers.

### What isolation means

Each business operates with its own:

| Isolated per business | Storage location |
|----------------------|-----------------|
| System prompt | `agent_config.system_prompt` |
| Initial greeting | `agent_config.initial_greeting` |
| Language settings | `agent_config.language_code` |
| VAD threshold | `agent_config.vad_threshold` |
| Call logs | `call_logs` (filtered by business_id) |
| Transcripts | `transcripts` (via call_logs FK) |
| Bookings | `bookings` (via call_logs FK) |
| Analytics | Derived from business-filtered queries |
| Recordings | Linked via call_logs (when implemented) |
| Dashboard access | Business-specific login (Phase 2) |

### Example: Two businesses on one platform

**Dental clinic:**
- System prompt: "You are a receptionist for Smile Dental Clinic..."
- Greeting: "Hello, thanks for calling Smile Dental. How can I help?"
- Language: `hi-IN`
- Booking: Cal.com event type for dental appointments
- Analytics: Only dental clinic calls

**Real estate company:**
- System prompt: "You are an assistant for Prestige Properties..."
- Greeting: "Welcome to Prestige Properties. How may I assist you?"
- Language: `en-IN`
- Booking: Cal.com event type for property viewings
- Analytics: Only real estate calls

### How this works architecturally

**Phase 1 (current):** Single `agent_config` row. One business per deployment. Multi-business not needed yet.

**Phase 2 (multi-business):**
1. Add `business_id` column to `agent_config`, `call_logs`.
2. Add `businesses` table with name, DID number, Cal.com credentials, settings.
3. Route inbound calls by DID → business_id → business-specific config.
4. Dashboard queries filter by authenticated business.
5. Each business gets isolated analytics, CRM, calendar, config.

**Phase 3 (SaaS):**
1. Admin panel for platform owner.
2. Self-service business onboarding.
3. Per-business billing.
4. Usage metering.

### What must NOT change for multi-business

- The voice runtime (`agent.py`) stays the same — it loads config from DB, not from hardcoded values.
- The booking tool stays the same — Cal.com event type ID comes from config, not from code.
- The SMS flow stays the same — triggered per booking, not per business type.
- The schema evolution is additive — add columns, don't restructure tables.

---

## 6. Authentication Direction

### Phase 1: Single password (CURRENT)

- `DASHBOARD_PASSWORD` environment variable.
- HMAC-SHA256 session token stored in `inbound_dashboard_session` cookie.
- Constant-time comparison to prevent timing attacks.
- Middleware checks every non-public route.
- Sufficient for single-tenant deployment.

### Phase 2: Business-specific login (FUTURE — multi-business)

- `users` table with `id`, `business_id`, `email`, `password_hash`.
- bcrypt or argon2 password hashing.
- Session tied to business_id — dashboard queries automatically filtered.
- Each business has its own login credentials.
- Platform owner has super-admin access.

### Phase 3: SaaS admin panel (FUTURE — SaaS phase)

- Platform admin can manage businesses, users, billing.
- Role-based access: admin, operator, viewer.
- API key management per business.
- Usage dashboards.

### What must NOT be implemented now

- OAuth / SSO / SAML.
- JWT with refresh tokens.
- Multi-factor authentication.
- Password reset flows.
- Enterprise identity federation.

These add complexity with no current user demand. The single-password approach is appropriate for a single-business deployment where the operator and the platform owner are the same person or team.

---

## 7. Dashboard Metrics (Target State)

### Priority metrics (top of page)

| Metric | Current | Target |
|--------|:-------:|:-----:|
| Total calls | ✅ | ✅ |
| Booking rate | ✅ | ✅ |
| Average duration | ✅ | ✅ |
| Failed/missed calls | ✅ | ✅ |
| Confirmed bookings count | ✅ | ✅ |
| Language usage | ✅ | ✅ |
| Repeat callers | ✅ | ✅ |
| Peak call hours | ✅ | ✅ |

### Charts (future, not current)

- Call volume over time (last 7/30 days).
- Booking conversion over time.
- Duration distribution.

Charts should be lightweight (no heavy charting library). Consider inline SVG bars or a minimal library like `recharts` if needed.

### Date range filtering

All metrics should support filtering by date range:
- Today
- Last 7 days
- Last 30 days
- Custom range

Dashboard metrics support Today, Last 7 days, Last 30 days, and All time.

---

## 8. CRM Architecture (Target State)

### CRM table columns

| Column | Current | Target |
|--------|:-------:|:-----:|
| Phone number | ✅ | ✅ |
| Caller name | ✅ | ✅ |
| Start time | ✅ | ✅ |
| Duration | ✅ | ✅ |
| Status | ✅ | ✅ |
| Outcome | ✅ | ✅ |
| Transcript summary | ✅ (180 chars) | Keep, link to detail |
| Booking status | ✅ | ✅ |

### Search and filter

| Capability | Current | Target |
|-----------|:-------:|:-----:|
| Phone number search | ✅ | ✅ |
| Caller name search | ✅ | ✅ |
| Date range filter | ✅ | ✅ |
| Status filter | ❌ | Part 13 |
| Pagination | ✅ | ✅ |

### Transcript detail view

When an operator clicks a CRM row, show the full transcript for that call:
- Full turn-by-turn transcript (speaker + text + timestamp).
- Call metadata (phone, duration, status, outcome).
- Booking details if applicable.
- SMS status if applicable.

Implemented as `/crm/[callId]` with a server component that fetches the call, booking, and transcript rows.

---

## 9. Settings Architecture (Target State)

The Settings page enables two customer operating modes:

### Mode A — Platform-Managed APIs

The platform owner manages all external service credentials:

| Service | Managed by |
|---------|-----------|
| OpenAI | Platform owner |
| Sarvam AI | Platform owner |
| LiveKit Cloud | Platform owner |
| Cal.com | Platform owner |
| Fast2SMS | Platform owner |

The customer (business operator) configures only:
- System prompt and greeting
- Voice and language
- Booking preferences
- VAD threshold

**Advantages:** Simple onboarding, one set of API keys, platform owner controls costs.
**Disadvantages:** Platform owner bears all API costs, no customer autonomy over providers.

### Mode B — Customer-Managed APIs

The customer provides their own API credentials:

| Service | Managed by |
|---------|-----------|
| OpenAI API key | Customer |
| Sarvam API key | Customer |
| LiveKit credentials | Customer |
| Cal.com credentials | Customer |
| Fast2SMS credentials | Customer |

**Advantages:** Customer controls costs and providers, true SaaS model.
**Disadvantages:** Complex onboarding, customers must understand API key management, security risk if keys are mishandled.

### Security implications of Mode B

- API keys must be encrypted at rest in PostgreSQL.
- Keys must never appear in server logs.
- Keys must be injected into the agent runtime per-call, not stored as env vars.
- Dashboard must show key status (configured / missing) without revealing key values.
- Key rotation must not interrupt active calls.

### Implementation timeline

- **Phase 1 (current):** All keys in env vars. Platform-managed only. No Settings page.
- **Phase 2 (multi-business):** Mode A by default. Settings page shows business configuration.
- **Phase 3 (SaaS):** Mode B available. Per-business encrypted key storage.

---

## 10. Transcript Strategy

### Phase 1 (current)

- Full turn-by-turn transcripts stored in `transcripts` table.
- CRM shows 180-character concatenated summary.
- No semantic analysis, no summaries, no sentiment scoring.

### What must NOT be built now

- Semantic memory systems.
- AI-powered transcript analytics.
- Automatic QA scoring.
- Sentiment analysis pipelines.

### Future roadmap (not current priority)

- **Call summaries:** LLM-generated 2-3 sentence summary, stored post-call. Must not add latency during the call.
- **Sentiment scoring:** Simple positive/neutral/negative classification. Post-call processing only.
- **QA scoring:** Did the agent follow the prompt? Did it book correctly? Post-call audit.
- **Search across transcripts:** Full-text search for specific caller mentions.

---

## 11. Recording Strategy

### Core principle: India pricing sensitivity

Audio recording storage is expensive at scale. India-first pricing demands the cheapest viable approach.

### Phase 1 (current target)

- **Store recording links only** — do not duplicate media files.
- Use provider recordings: Vobiz SIP trunk or LiveKit Cloud may retain call recordings.
- Store the recording URL in `call_logs.recording_url` (column to be added).
- Dashboard shows a "Play" button that links to the external recording.
- **Zero additional storage cost.**

### Phase 2 (optional)

- Embedded playback in dashboard (audio player fetches from external URL).
- Download button for compliance or manual review.

### What must NOT be built now

- Custom media storage infrastructure (S3, Minio, etc.).
- Duplicate recordings in platform storage.
- Automatic transcription from recordings (already handled by live STT).
- Call recording pipelines (LiveKit Egress, etc.).

### Why this matters for cost

| Approach | Monthly cost for 10,000 calls (avg 3 min) |
|----------|-------------------------------------------|
| No recording storage | ₹0 |
| Recording links only | ₹0 |
| S3 standard (500 GB) | ~₹1,500/month |
| LiveKit Egress + S3 | ~₹3,000/month |

At India pricing levels, even ₹1,500/month is significant for a small clinic. Use provider recordings first.

---

## 12. Language Strategy

### Supported languages

| Language | Code | STT behavior | TTS behavior |
|----------|------|-------------|-------------|
| English (India) | `en-IN` | Hint English | Speak English |
| Hindi | `hi-IN` | Hint Hindi | Speak Hindi |
| Kannada | `kn-IN` | Hint Kannada | Speak Kannada |
| Auto-detect | `unknown` | Detect automatically | Speak configured default |

### How language flows through the system

```
Dashboard config form → agent_config.language_code + mixed_language_enabled → agent.py loads config
    → STT: sarvam.STT(language=config.language_code or "unknown" for mixed mode)
    → TTS: sarvam.TTS(target_language_code=config.language_code)
    → Speaker: mapped from language (e.g., hi-IN → kavya, en-IN → amelia)
```

### Mixed-language behavior

Indian callers frequently code-switch between Hindi and English within the same sentence (Hinglish). The system must handle this:

1. **STT:** Sarvam `saaras:v3` with `language="unknown"` auto-detects mixed speech.
2. **LLM:** GPT-4o handles multilingual input natively.
3. **TTS:** Responds in the configured primary language.

### Per-call language locking

- One language is configured per business (via dashboard).
- The language is locked for all calls until the operator changes it.
- If a caller clearly speaks a different language, the auto-detect mode (`unknown`) handles it.
- Future: per-call language detection and dynamic switching.

---

## 13. Agent Config Target State

### Current fields

| Field | Type | Implemented |
|-------|------|:-----------:|
| Initial greeting | Textarea | ✅ |
| System prompt | Textarea | ✅ |
| Primary language | Dropdown (en-IN, hi-IN, kn-IN) | ✅ |
| Mixed-language mode | Toggle | ✅ |
| VAD threshold | Number (0.3–0.7) | ✅ |

### Target fields (Part 11+)

| Field | Type | Target |
|-------|------|:------:|
| TTS voice | Dropdown (speaker list per language) | Part 11 |
| Booking enabled | Toggle | Part 12 |
| Booking filler message | Text input | Part 12 |
| Max call duration | Number (seconds) | Part 14 |
| Config history | Read-only log | Part 14 |

---

## 14. Known Frontend Issues

| Issue | Severity | Fix target |
|-------|----------|------------|
| No per-business API key management in Settings | Low — single-tenant doesn’t need it yet | Phase 2 |

---

## 15. Implementation Status

### Fully implemented
- Login with HMAC session auth
- Dashboard with operator metrics, language usage, peak call hours, and date range filter
- CRM table with search, date filters, pagination, caller names, transcript summaries, and booking status
- CRM transcript detail route
- Calendar table with all booking statuses, caller search, date filters, pagination, caller names, transcript links, and SMS status
- Agent Config form (greeting, prompt, primary language, mixed-language mode, VAD)
- Sidebar navigation with active state
- Responsive layout (sidebar → top nav on mobile)
- Server-only PostgreSQL queries
- Standalone Next.js production build

### Not implemented
- TTS voice selector
- Settings page
- Charts / visualizations
- Multi-business isolation
- Recording playback
- Config history
