# CONCLUSION.md — Final Master Review

> **Purpose:** Documentation audit, hallucination detection, architecture validation.
> **Subordinate to:** `/docs/PLAN.md`
> **Review date:** 2026-05-08
> **Documents reviewed:** 12 active docs in `/docs/`
> **Code files cross-referenced:** agent.py, tools.py, notifications.py, db.py, init_db.py, schema.sql, supervisord.conf, start.sh, Dockerfile, middleware.ts, dashboard-auth.ts, login/actions.ts, postgres-server.ts, agent-config-data.ts, dashboard-metrics.ts, operations-data.ts, navigation.tsx, app-shell.tsx, dashboard/page.tsx, agent-config/page.tsx, next.config.mjs, package.json, tailwind.config.ts, supabase-server.ts

---

## 1. Executive Conclusion

### Is the architecture coherent?

**Yes.** The 12-document set forms a consistent, layered architecture description. PLAN.md is the master. All subordinate docs declare their hierarchy. No circular dependencies. No contradictory architectural philosophies. The documentation correctly reflects a **single-container, single-tenant, prompt-first inbound voice platform** optimized for India-first pricing.

### Is the roadmap realistic?

**Yes, with caveats.** Parts 11–15 are well-scoped, correctly ordered, and achievable by a single developer. Each part has clear deliverables and acceptance criteria. The caveats: Part 14 is the heaviest (8 deliverables spanning health, logging, SIGTERM, session, audit trail, env validation) and should be carefully estimated.

### Is the deployment strategy strong?

**Yes.** Single Docker container + Supervisor + Easypanel is the correct choice for this scale. The standalone Next.js build, multi-stage Docker, and Easypanel TLS proxy are all verified and appropriate. The cost analysis is realistic.

### Is the pricing strategy realistic?

**Yes.** The ₹1,900–4,500/month estimate for 1,000 calls is grounded in real provider pricing. The cost-avoidance decisions (no Kubernetes, no vector DB, no recording storage, no multi-agent) are each individually justified.

### Is the product direction viable?

**Yes.** An AI voice receptionist for Indian dental clinics (and similar businesses) with live booking and SMS confirmation is a viable product. The prompt-first multi-business approach is the correct path to SaaS. The architecture is minimal enough to ship and iterate.

---

## 2. Documentation Quality Review

### Consistency: STRONG

All 12 docs use the same terminology, reference the same tables, and describe the same runtime behavior. No doc invents a component or service that another doc contradicts.

Cross-doc consistency checks:
- `agent_config` table described identically in DATABASE_POSTGRES.md, AGENT.md, FRONTEND.md.
- Cal.com API v2 described identically in BOOKING.md, CALL_FLOW.md, PLAN.md.
- Fast2SMS described identically in SMS.md, CALL_FLOW.md, PLAN.md.
- Supervisor config in DEPLOYMENT.md matches actual `supervisord.conf` exactly (verified: `startretries=10`/`stopwaitsecs=30` for agent, `startretries=5`/`stopwaitsecs=15` for dashboard).
- Docker multi-stage described in DEPLOYMENT.md matches actual `Dockerfile` structure.

### Clarity: STRONG

Each doc follows a consistent pattern: purpose → current state → missing → roadmap. Implementation status sections clearly separate "implemented" from "not implemented." No ambiguous language that could be mistaken for a feature claim.

### Architecture discipline: STRONG

The docs maintain a clear separation between:
- What exists in code today.
- What is planned for Parts 11–15.
- What is Phase 2/3 roadmap (multi-business, SaaS).

This three-tier separation is consistent across all docs and prevents scope creep.

### Roadmap structure: STRONG

Parts 1–10 document the completed foundation. Parts 11–15 are the next implementation phase. Each has: Goal, Affects, Key idea, Depends on, Acceptance criteria, Deliverables, Must not. The dependency chain (11→12→13→14→15) is correctly justified.

### Hierarchy correctness: STRONG

- PLAN.md is clearly the master.
- All 11 subordinate docs declare subordination in their headers.
- The documentation hierarchy in PLAN.md Section 7 lists all 12 docs.
- No orphan docs exist in `/docs/`.

---

## 3. Hallucination Detection Report

### HALLUCINATION #1: Session cookie expiration (CONFIRMED)

**Documents affected:** SECURITY.md Section 11, SECURITY.md Section 12, PLAN.md Part 14 Deliverable #7

**Claim in SECURITY.md Section 11:**
> "No expiration on session cookie ⚠️ Session persists until browser clears cookies"

**Claim in SECURITY.md Section 12:**
> "No session expiration."

**Claim in PLAN.md Part 14 Deliverable #7:**
> "Session expiration on dashboard cookie." (implying it doesn't exist yet)

**Actual code (`login/actions.ts:50-58`):**
```typescript
cookieStore.set({
    name: DASHBOARD_AUTH_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12   // 12-hour expiration
});
```

**Reality:** The session cookie **already has a 12-hour expiration** via `maxAge`. This is not "no expiration." The session does expire. The SECURITY.md claim is factually wrong. Part 14's deliverable #7 may already be partially satisfied — what remains is to decide if 12 hours is the right duration.

**Severity:** Medium. The security posture is actually better than documented.

**Correction applied:** SECURITY.md Section 11 and 12 now state the cookie expires after 12 hours. PLAN.md Part 14 deliverable #7 now reads "Configurable session duration (currently fixed at 12 hours via `maxAge`)."

---

### HALLUCINATION #2: Booking availability check in PLAN.md (CONFIRMED)

**Document affected:** PLAN.md Section 3.4

**Claim:**
> "Flow: Agent asks preference → checks availability → confirms verbally → books → persists to PostgreSQL"

**Actual behavior (verified in tools.py and documented in BOOKING.md Section 4–5):**

There is **no availability check**. The agent collects the caller's preferred time and submits it directly to Cal.com. If the slot is unavailable, Cal.com rejects the booking and the agent speaks a soft error.

**Reality:** PLAN.md Section 3.4 describes the *intended* flow, not the *actual* flow. BOOKING.md correctly documents this gap. But PLAN.md reads as if availability checking is implemented.

**Severity:** Low. BOOKING.md is authoritative for booking details and correctly flags this. But PLAN.md as the master doc should not imply a feature exists when it doesn't.

**Corrections applied:**
- PLAN.md Section 3.4 now reads: "Agent asks preference → confirms verbally → books directly (no pre-check) → persists to PostgreSQL"
- PLAN.md business preset table (Section 8) now reads: "Ask preference → confirm verbally → book directly (no pre-check)"
- LOGIC.md Section 4 Rule 1 now reads: "ask preference → confirm verbally → book directly (no pre-check)"
- LOGIC.md Section 4 Rule 8 now references booking failure rather than availability failure

**Status:** CORRECTED (3 docs, 4 instances)

---

### HALLUCINATION #3: Concurrent call capacity estimate (UNVERIFIABLE)

**Document affected:** DEPLOYMENT.md Section 15

**Claim:**
> "~50–200 concurrent calls (LiveKit worker spawns processes per call)"

**Reality:** This number is an estimate without production benchmarks. On a 4 GB RAM VPS running both the Python agent and Next.js dashboard, the actual concurrent call capacity depends on:
- Per-call memory usage of the LiveKit worker process
- Python process spawning overhead
- WebSocket connection overhead
- STT/TTS streaming buffer memory

50 concurrent calls is plausible. 200 is optimistic for a 4 GB VPS. This claim cannot be verified without load testing.

**Severity:** Low. The number is presented as an estimate, not a guarantee.

**Correction applied:** DEPLOYMENT.md Section 15 now includes the caveat: "This is an estimate, not a benchmark. Actual capacity depends on per-call memory usage, VPS resources, and network conditions."

---

### NO OTHER HALLUCINATIONS DETECTED

All other documented behaviors were verified against source code:

| Claim | Verified against | Status |
|-------|-----------------|--------|
| AgentConfig dataclass has 3 fields (no language_code) | `agent.py:32-36` | ✅ Correct |
| STT hardcoded to `"unknown"` | `agent.py:57` | ✅ Correct |
| TTS hardcoded to `"hi-IN"` / `"kavya"` | `agent.py:69-70` | ✅ Correct |
| VAD threshold clamped to 0.0–1.0 | `agent.py:49` | ✅ Correct |
| fetch_active_agent_config does not SELECT language_code | `agent.py:176` | ✅ Correct |
| Cal.com API v2 at `api.cal.com/v2/bookings` | `tools.py:118` | ✅ Correct |
| Cal.com API version header `2024-08-13` | `tools.py:121` | ✅ Correct |
| 10s timeout on Cal.com | `tools.py:116` | ✅ Correct |
| ON CONFLICT upsert for bookings | `tools.py:81` | ✅ Correct |
| HMAC-SHA256 session auth | `dashboard-auth.ts:34` | ✅ Correct |
| Constant-time comparison | `dashboard-auth.ts:15-27` | ✅ Correct |
| `import "server-only"` on all 4 data modules | grep verified | ✅ Correct |
| `"use server"` on login and config actions | file verified | ✅ Correct |
| No `NEXT_PUBLIC_` env vars | `next.config.mjs` | ✅ Correct |
| Supervisor config values (retries, stopwait) | `supervisord.conf` | ✅ Exact match |
| Standalone Next.js output | `next.config.mjs:3` | ✅ Correct |
| Stale "Supabase service role" labels | `dashboard/page.tsx:50`, `agent-config/page.tsx:18` | ✅ Confirmed |
| supabase-server.ts is dead code | grep: not imported anywhere | ✅ Correct |
| Next.js 16, React 19, Tailwind 3.4 | `package.json` | ✅ Correct |
| Aptos → Inter → system-ui font chain | `tailwind.config.ts:8` | ✅ Correct |

---

## 4. Architecture Risk Review

### Latency risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Cal.com booking dead air (up to 10s) | **High** | Part 12: filler speech. Already planned. |
| STT auto-detect overhead vs. explicit language | Low | Part 11: language hint. Marginal improvement. |
| 160-token truncation on booking confirmations | Medium | Part 12: review and adjust limit. |
| Endpointing delay (200–1200ms) | Low | Already reasonable for telephony. |

**No hidden multi-agent or RAG architecture exists.** Verified: one LLM call per turn, no retrieval, no classifier, no router.

### Scaling risks

| Risk | Severity | When it matters |
|------|----------|----------------|
| No Python DB connection pooling | Medium | >50 concurrent calls |
| Single VPS single point of failure | Medium | Production traffic |
| All-time dashboard queries (no date filters) | Medium | >10,000 call logs |
| 50-row hard limit on CRM/Calendar | Low | >50 active bookings |
| Deterministic session token (all sessions identical) | Low | Multi-operator scenarios |

### SaaS risks

| Risk | Severity | Notes |
|------|----------|-------|
| No business_id column anywhere yet | Low | Correctly deferred to Phase 2 |
| Per-business Cal.com credentials not designed | Low | Phase 2/3 concern |
| No billing integration | Low | Phase 3 concern |
| Mode B (customer API keys) adds significant security complexity | Medium | Phase 3 concern, documented |

### Deployment risks

| Risk | Severity | Notes |
|------|----------|-------|
| Health endpoint gaps | Low | `/api/health` now checks app, DB, and dashboard auth readiness. |
| SIGTERM handling gaps | Medium | Supervisor now sends TERM to process groups and allows call finalization time. |
| Env var validation gaps | Low | Worker validates required production env vars and DB connectivity at startup. |
| DB init failure blocks startup | Low | Intentional fail-fast production behavior, documented. |

### Operational risks

| Risk | Severity | Notes |
|------|----------|-------|
| SMS failures invisible in dashboard | Low | `notification_events` stores sent/failed SMS audit records. |
| Limited structured logging | Low | Startup, shutdown finalization, and notification audit events emit JSON log records. |
| DATABASE_URL may leak in some non-startup error logs | Low | Startup and health errors redact known secret values. |
| Phone numbers logged as PII | Low | Reduced in SMS logs; caller ID logs remain for debugging. |

---

## 5. Cost Risk Review

### Infrastructure cost risks

| Risk | Impact | Likelihood |
|------|--------|-----------|
| VPS upgrade needed for concurrent calls | +₹1,000–2,500/month | Medium (depends on call volume) |
| Provider recording links unavailable | Need S3: +₹1,500–3,000/month | Medium (depends on Vobiz/LiveKit retention policy) |
| OpenAI pricing increase | +₹50–200/month per 1,000 calls | Low (API pricing trends downward) |
| Cal.com free tier limits exceeded | +₹1,000/month | Medium (depends on booking volume) |

### Storage risks

Currently zero storage cost (PostgreSQL bundled with VPS, no recording storage). This is correct and sustainable.

**Hidden risk:** If Vobiz or LiveKit Cloud does NOT retain call recordings, the "recording links" strategy fails. The platform would need to implement its own recording before going live with recording features.

**Recommendation:** Verify with Vobiz and LiveKit Cloud whether provider recording retention exists and for how long. If not, defer recording features rather than building custom storage.

### API ownership complexity

Mode B (customer-managed API keys) is correctly deferred to Phase 3. If implemented prematurely, it would add:
- Encryption at rest complexity
- Per-call key injection complexity
- Key validation and rotation logic
- Dashboard key management UI
- Security audit requirements

**This is the single largest hidden complexity in the roadmap.** Mode B should be the last feature implemented, not an early addition.

### Future SaaS complexity

The SaaS roadmap (Section 13 of PLAN.md) is realistic but intentionally high-level. The biggest SaaS cost risks:
- Billing integration (Razorpay) adds code and compliance complexity.
- Per-business DID management requires Vobiz API integration.
- Self-service onboarding requires a zero-touch deployment path.

**These are correctly blocked from Parts 11–15.** No premature SaaS work exists in the current docs.

---

## 6. What The Architecture Does Correctly

### Low latency: EXCELLENT

- One LLM call per turn (no routing, no RAG, no multi-agent).
- Preemptive generation enabled.
- Streaming TTS (first audio chunk plays immediately).
- Async DB writes (non-blocking audio loop).
- Short token limits (160 output tokens).
- Low LLM temperature (0.2 — faster, more deterministic).

**The latency architecture is the strongest part of the system.** Every decision is justified and correct.

### Simplicity: EXCELLENT

- Two processes, one container, one VPS.
- Raw SQL, no ORM.
- Env vars for secrets, no vault.
- HMAC session auth, no JWT.
- 4 database tables, no complex schemas.

**The simplicity is not accidental — it's the architecture.** The docs correctly frame simplicity as a deliberate choice.

### Easypanel optimization: STRONG

- Docker multi-stage build minimizes image size.
- Standalone Next.js reduces RAM.
- Internal Docker service names for DB routing.
- Easypanel proxy handles TLS.
- No Kubernetes dependency.

### No-RAG architecture: CORRECT

- Business context fits in ~200 tokens of system prompt.
- RAG would add 200–1000ms per turn with zero benefit for a clinic.
- The docs correctly allow single-step pgvector RAG as a future escape hatch.
- The prohibition on agentic/multi-step RAG is correctly enforced across all docs.

### Lightweight deployment: CORRECT

- One `git push` → Easypanel builds and deploys.
- `init_db.py` handles schema migration.
- Supervisor restarts crashed processes.
- Rollback = redeploy previous image.

### India-first optimization: STRONG

- All cost estimates in INR.
- VPS pricing based on Indian providers.
- Sarvam AI for Indian-language STT/TTS.
- Fast2SMS for India-only SMS.
- Recording strategy optimized for India pricing sensitivity.
- IST timezone hardcoded in booking payload.

### Operator-first UX: STRONG

- Dashboard designed for non-technical operators.
- Clean, minimal, Vapi-inspired design.
- Server components (no client-side data fetching complexity).
- Dashboard truthfulness principle (no fake data).

### Prompt-first business logic: CORRECT

- Business persona, rules, and context live in `system_prompt`.
- Agent behavior changes via dashboard config, not code deployment.
- Multi-business = different prompts, not different code paths.
- The runtime is business-neutral by design.

---

## 7. What Must NOT Be Changed

These architectural decisions are strategically correct and should remain stable:

1. **Single-container deployment.** Do not split into microservices until horizontal scaling is provably needed.
2. **Supervisor as process manager.** Do not switch to systemd, pm2, or custom process management.
3. **Raw SQL with psycopg2 and pg.** Do not introduce an ORM, Prisma, or Drizzle.
4. **HMAC session auth.** Do not introduce JWT, OAuth, or SSO until multi-business phase.
5. **No RAG, no multi-agent, no routing.** Do not add retrieval or multi-step LLM flows.
6. **Standalone Next.js with `node server.js`.** Do not switch to `npm start` or Vercel deployment.
7. **PostgreSQL as sole data store.** Do not add Redis, Elasticsearch, or S3.
8. **Sarvam AI for STT/TTS.** Do not switch to Google, Azure, or Deepgram without re-evaluating Indian language support.
9. **Cal.com for booking.** Do not switch to Google Calendar or custom booking.
10. **Fast2SMS for India SMS.** Do not add Twilio or other international providers.
11. **`import "server-only"` guards on all data modules.** This is the primary protection against credential leakage.
12. **Shutdown callback order: drain → complete → SMS.** This sequence ensures data consistency.
13. **Booking tool verbal confirmation requirement.** This prevents speculative bookings.
14. **`asyncio.to_thread()` for DB writes.** This prevents blocking the audio event loop.

---

## 8. What Still Needs Improvement

### Incomplete runtime wiring

| Gap | Priority | Target |
|-----|----------|--------|
| `language_code` not wired through config → STT → TTS | **High** | Part 11 |
| TTS hardcoded to Hindi (`hi-IN` / `kavya`) | **High** | Part 11 |
| No language selector in dashboard config form | **High** | Part 11 |
| Dashboard save action ignores `language_code` | **High** | Part 11 |
| `AgentConfig` dataclass missing `language_code` field | **High** | Part 11 |

### Missing observability

| Gap | Priority | Target |
|-----|----------|--------|
| Broader structured logging coverage | Low | Later hardening |
| Dashboard view for `notification_events` | Low | Later operator polish |

### Missing auth evolution

| Gap | Priority | Target |
|-----|----------|--------|
| ~~Session expiration documentation is incorrect~~ | ~~Medium~~ | ✅ Fixed |
| No logout endpoint | Low | Part 14 |
| No rate limiting on login | Low | Part 14 |
| No per-user auth | Low | Phase 2 |

### Missing health checks

| Gap | Priority | Target |
|-----|----------|--------|
| Health endpoint coverage beyond DB/auth | Low | Later hardening |
| Active call drain under forced SIGKILL | Medium | Operational timeout risk |

### Missing language wiring

Covered under "Incomplete runtime wiring" above. This is the single biggest gap.

### Missing CRM features

| Gap | Priority | Target |
|-----|----------|--------|
| No date range filters | Medium | Part 13 |
| No CRM search (phone, name) | Medium | Part 13 |
| No transcript detail view | Medium | Part 13 |
| No `caller_name` column | Medium | Part 13 |
| No pagination | Low | Part 13 |
| Stale "Supabase" labels in UI | Medium | Immediate fix |

### Missing production features

| Gap | Priority | Target |
|-----|----------|--------|
| No booking filler speech (dead air during Cal.com API) | **High** | Part 12 |
| VAD threshold not clamped to practical range (0.3–0.7) | Medium | Part 12 |
| No `summary` column in call_logs | Low | Part 13 |
| No recording link storage | Low | Future |

---

## 9. Final Recommended Execution Order

### Confirmed: Part 11 → 12 → 13 → 14 → 15

```
Part 11: Multilingual Runtime Wiring
    ↓ (language wiring complete, STT/TTS now configurable)
Part 12: Latency & Conversation Optimization
    ↓ (VAD tuned, filler speech added, token limits reviewed)
Part 13: CRM Intelligence & Dashboard Truthfulness
    ↓ (search, filters, transcript detail, stale labels fixed)
Part 14: Production Hardening & Observability
    ↓ (health endpoint, SIGTERM, logging, env validation)
Part 15: Launch Validation & Operational Runbook
    ↓ (checklist, runbook, go-live)
```

### Why this order is correct

**11 before 12:** Language settings change STT/TTS behavior. Latency tuning done before language wiring would be invalidated when the STT/TTS pipeline changes. You cannot tune what isn't wired.

**12 before 13:** CRM data quality depends on stable runtime behavior. If VAD thresholds or token limits change in Part 12, the call data characteristics change. CRM search and filters should operate on stable data patterns.

**13 before 14:** Production hardening should be applied to the complete feature set. Adding health checks and structured logging before all features exist means you'd need to update them again after Part 13.

**14 before 15:** Launch validation tests the complete system. It makes no sense to validate an incomplete system. Part 14 adds the health endpoint that Part 15's launch checklist needs to verify.

### Pre-Part-11 quick fixes (optional)

These can be done immediately without violating execution order:

1. **Fix stale Supabase labels** in `dashboard/page.tsx:50` and `agent-config/page.tsx:18`. Two-line change.
2. **Fix session expiry documentation** in SECURITY.md. The 12-hour maxAge already exists.
3. **Fix PLAN.md Section 3.4** booking flow description (remove "checks availability").

---

## 10. Final Architectural Verdict

### Rating: **Production-Ready MVP**

**Not a hobby project** — the architecture is too deliberate, the deployment strategy too well-considered, and the cost analysis too grounded for a hobby project.

**Not an overengineered system** — every component serves a purpose. No unnecessary abstractions, no premature scaling, no enterprise complexity. The explicit anti-patterns list (no RAG, no Kubernetes, no microservices, no multi-agent) shows disciplined restraint.

**Not yet a scalable SaaS foundation** — the multi-business and SaaS roadmap is correctly documented as future work. No premature SaaS plumbing exists. The transition path (add business_id, add users table, add admin panel) is realistic but untested.

**It is a Production-Ready MVP because:**

1. The inbound call pipeline works end-to-end (call → conversation → booking → SMS).
2. The dashboard provides real operational value (metrics, CRM, calendar, config).
3. The deployment is production-grade (Docker, Supervisor, Easypanel, TLS).
4. The security model is appropriate for single-tenant deployment.
5. The cost structure is sustainable for an Indian small business.
6. The architecture supports iteration without rewrites.

**What separates it from "production-ready" (without MVP qualifier):**

- Forced process termination can still interrupt active calls if the platform exceeds graceful shutdown timeout.
- Notification audit records exist, but no dedicated dashboard surface has been added yet.
- Brute-force login rate limiting and logout remain later hardening items.

**These gaps are addressed by Parts 11–15.** After completing the roadmap, the system would graduate to "production-ready" without the MVP qualifier.

---

## Appendix: Review Summary Tables

### Documents reviewed

| Document | Lines | Size | Verdict |
|----------|------:|-----:|---------|
| PLAN.md | 581 | 29KB | ✅ Coherent, 2 minor issues found |
| REVIEW.md | 215 | 12KB | ✅ Accurate snapshot |
| LOGIC.md | 186 | 9KB | ✅ Clean behavioral rules |
| AGENT.md | 322 | 12KB | ✅ Matches code exactly |
| DATABASE_POSTGRES.md | 255 | 10KB | ✅ Matches schema exactly |
| CALL_FLOW.md | 238 | 14KB | ✅ Matches code exactly |
| LATENCY.md | 187 | 8KB | ✅ Analysis is grounded |
| BOOKING.md | 241 | 9KB | ✅ Matches code exactly |
| SMS.md | 208 | 7KB | ✅ Matches code exactly |
| FRONTEND.md | 518 | 19KB | ✅ Matches code, 1 auth issue |
| DEPLOYMENT.md | 469 | 18KB | ✅ Matches config exactly |
| SECURITY.md | 407 | 16KB | ✅ Session expiry corrected |

### Detected issues

| # | Issue | Severity | Location | Fix |
|---|-------|----------|----------|-----|
| 1 | Session cookie has 12h maxAge but docs said "no expiration" | Medium | SECURITY.md §11, §12 | ✅ Corrected |
| 2 | "Checks availability" in booking flow — no check exists | Low | PLAN.md §3.4, PLAN.md §8 preset, LOGIC.md §4 | ✅ Corrected (4 instances across 3 docs) |
| 3 | Concurrent call estimate (50–200) was unverified | Low | DEPLOYMENT.md §15 | ✅ Caveat added |
| 4 | Stale "Supabase service role" labels in two pages | Medium | dashboard/page.tsx:50, agent-config/page.tsx:18 | Part 13 deliverable (runtime code, not docs) |

### Hallucinations

| # | Hallucination | Severity | Correction |
|---|--------------|----------|------------|
| 1 | "No session expiration" — cookie has `maxAge: 43200` (12h) | Medium | ✅ SECURITY.md corrected |
| 2 | "Checks availability" in booking flow — no availability check exists | Low | ✅ PLAN.md + LOGIC.md corrected (4 instances) |
| 3 | "50–200 concurrent calls" — not benchmarked | Low | ✅ DEPLOYMENT.md caveat added |

### Unrealistic assumptions

**None found.** All cost estimates are grounded. All technology choices are available. All deployment targets exist. No doc assumes a feature that cannot be built with the current stack.

### Dangerous future risks

| Risk | Danger level | Mitigation |
|------|-------------|-----------|
| Mode B (customer API keys) adding massive security complexity | High if built prematurely | Keep as Phase 3, never Phase 2 |
| Provider recording retention unknown | Medium | Verify with Vobiz/LiveKit before implementing recording features |
| No SIGTERM handling during production deploys | High until Part 14 | Prioritize SIGTERM handler in Part 14 |
| Brute-force login with no rate limiting | Medium | Add rate limiting in Part 14 |

### Confidence scores

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| **Architecture confidence** | **9/10** | Coherent, deliberate, well-documented. All detected hallucinations corrected. |
| **Deployment confidence** | **8/10** | Correct strategy, good cost analysis. Minus points for no health endpoint and no SIGTERM handling (both planned). |
| **Scalability confidence** | **7/10** | Single-container scales to ~50–200 calls (estimated). Horizontal scaling path documented but untested. No Python connection pooling. |
| **Cost-efficiency confidence** | **9/10** | Excellent. Every decision justified in INR. Recording links strategy avoids the biggest hidden cost. No unnecessary infrastructure. |

### Final recommendation before implementation begins

1. ~~Fix the 3 doc issues~~ — ✅ Done (session expiry, availability check, concurrent call caveat).
2. **Fix the 2 stale Supabase labels** — 2-line runtime code change during Part 13 (deliverable #6).
3. **Begin Part 11: Multilingual Runtime Wiring** — this is the highest-value next step.
4. **Do not start Part 12 until Part 11 is tested with real calls in all 3 languages.**
5. **Do not implement any SaaS, multi-business, or Mode B features during Parts 11–15.**
