# SECURITY.md — Security Architecture & Data Privacy

> **Subordinate to:** `/docs/PLAN.md`
> **Last verified against code:** 2026-05-08

---

## 1. Security Philosophy

The platform handles phone calls, personal names, phone numbers, and appointment details. Security must protect caller privacy without adding enterprise complexity that the current deployment doesn't need.

### Principles

1. **Secrets never leave the server.** API keys, database credentials, and session tokens exist only in server-side code and environment variables.
2. **Minimize data collection.** Store only what is needed for the business operation.
3. **Defense in depth, not defense in theory.** Implement practical protections now; plan enterprise controls for later.
4. **No security through obscurity.** Assume the codebase is public. Security depends on env vars and runtime configuration, not hidden code paths.

---

## 2. Secrets Handling

### Where secrets live

| Secret | Storage | Accessed by |
|--------|---------|-------------|
| `DATABASE_URL` | Easypanel env var | agent.py, dashboard (server-only) |
| `OPENAI_API_KEY` | Easypanel env var | agent.py |
| `SARVAM_AI_API_KEY` | Easypanel env var | agent.py |
| `LIVEKIT_URL` | Easypanel env var | agent.py |
| `LIVEKIT_API_KEY` | Easypanel env var | agent.py |
| `LIVEKIT_API_SECRET` | Easypanel env var | agent.py |
| `CALCOM_API_KEY` | Easypanel env var | tools.py |
| `CALCOM_EVENT_TYPE_ID` | Easypanel env var | tools.py |
| `FAST2SMS_API_KEY` | Easypanel env var | notifications.py |
| `DASHBOARD_PASSWORD` | Easypanel env var | dashboard middleware |

### Where secrets must NEVER appear

- Frontend JavaScript bundles (client-side code).
- Committed `.env` files with real values.
- Server logs (redact keys in log output).
- Error messages returned to the browser.
- Markdown documentation.
- Git commit history.
- Docker image layers (use build args, not hardcoded values).

### Current compliance

- **Python backend:** All secrets read from `os.environ` at runtime. Never hardcoded.
- **Next.js dashboard:** `postgres-server.ts` uses `import "server-only"` guard. `DATABASE_URL` is read only in server components/actions. Middleware reads `DASHBOARD_PASSWORD` server-side only.
- **`.env` file:** Local developer state only. `.gitignore` excludes `.env`; production values must be set in Easypanel environment variables.

---

## 3. DATABASE_URL Safety

`DATABASE_URL` is the most sensitive credential — it grants full read/write access to all call data, transcripts, bookings, and agent configuration.

### Protections

| Protection | Status |
|-----------|--------|
| Server-only access (Python) | ✅ `os.environ` in backend only |
| Server-only access (Next.js) | ✅ `import "server-only"` guard |
| Internal Docker routing | ✅ `voice-agent-db:5432` (not public) |
| No frontend exposure | ✅ Not prefixed with `NEXT_PUBLIC_` |
| Validated at startup | ✅ `init_db.py` validates format; `agent.py` validates required runtime env and DB connectivity |
| Logged in errors | ⚠️ Startup and health DB errors redact known secret values; other driver errors should still be reviewed before expanding logs |

### Risk: Connection string in error logs

If `psycopg2.connect()` fails, the error message may include the connection string (including password). This should be caught and redacted before logging.

**Status:** Startup validation and `/api/health` redact known secret values before logging/returning DB errors. Keep the same rule for any new DB error surface.

---

## 4. Server-Side Only Policy

### Python backend

All Python code runs in the LiveKit worker process. There is no client-facing Python endpoint. All database access, API calls, and secret usage happen server-side.

### Next.js dashboard

The dashboard uses Next.js server components and server actions for all data access:

| File | Guard | Purpose |
|------|-------|---------|
| `postgres-server.ts` | `import "server-only"` | PostgreSQL connection pool |
| `agent-config-data.ts` | `import "server-only"` | Agent config queries |
| `dashboard-metrics.ts` | `import "server-only"` | Dashboard metric queries |
| `operations-data.ts` | `import "server-only"` | CRM and calendar queries |
| `agent-config/actions.ts` | `"use server"` | Config save action |
| `login/actions.ts` | `"use server"` | Login authentication |

The `"server-only"` import causes a build error if the module is accidentally imported in a client component. The `"use server"` directive ensures actions run on the server.

### What is NOT exposed to the client

- Database queries and results (only rendered HTML sent to browser).
- API keys.
- `DATABASE_URL`.
- `DASHBOARD_PASSWORD`.
- Raw SQL.
- Error stack traces (caught and replaced with user-friendly messages).

---

## 5. Environment Variable Policy

### Naming conventions

| Prefix | Meaning | Example |
|--------|---------|---------|
| No prefix | Server-only secret | `DATABASE_URL`, `OPENAI_API_KEY` |
| `NEXT_PUBLIC_` | Client-safe, bundled into frontend | **Currently none — keep it this way** |
| `CALCOM_` | Cal.com service credentials | `CALCOM_API_KEY` |
| `FAST2SMS_` | Fast2SMS service credentials | `FAST2SMS_API_KEY` |
| `LIVEKIT_` | LiveKit Cloud credentials | `LIVEKIT_URL` |
| `SARVAM_AI_` | Sarvam AI credentials | `SARVAM_AI_API_KEY` |
| `DASHBOARD_` | Dashboard configuration | `DASHBOARD_PASSWORD` |

### Rules

1. **Never use `NEXT_PUBLIC_` prefix for secrets.** Any variable with this prefix is bundled into the client JavaScript and visible to anyone who opens DevTools.
2. **Never add new env vars without documenting them** in DEPLOYMENT.md Section 13.
3. **Never commit real values** to `.env` or any checked-in file.
4. **Validate required vars at startup** before the worker accepts calls.

---

## 6. No Frontend Credential Exposure

### Current state

No credentials are exposed to the browser. Verified by:
- No `NEXT_PUBLIC_` env vars in `next.config.mjs`.
- No `NEXT_PUBLIC_` env vars in any frontend code.
- All data fetching happens in server components or server actions.
- The `pg` library is imported only in `server-only` modules.

### Risk: Accidental client import

If a developer imports `postgres-server.ts` in a client component, the build will fail with:

```
Error: You're importing a component that needs server-only.
```

This is a compile-time protection, not a runtime one.

### Risk: Environment variable leakage via error boundaries

If a server component throws an error that includes secret values, and the error boundary renders it, the secret could appear in HTML. All server-side data modules use try/catch and return user-friendly error messages.

---

## 7. API Key Storage

### Current approach (Phase 1)

All API keys stored as Easypanel environment variables. One set of keys per deployment. Platform owner manages all keys.

### Future approach (Phase 2 — multi-business with Mode B)

If businesses provide their own API keys:

1. Keys stored encrypted in PostgreSQL (`business_api_keys` table).
2. Encrypted at rest with a platform-level encryption key.
3. Decrypted only at call start, injected into the agent runtime.
4. Never logged, never shown in full in the dashboard.
5. Dashboard shows only key status: "Configured" / "Missing" / "Invalid".

**This is not implemented yet.** Current Phase 1 uses env vars only.

---

## 8. Business Isolation

### Current state (single-tenant)

One business per deployment. No isolation needed — all data belongs to one business.

### Future state (multi-tenant)

When multi-business support is added:

| Data type | Isolation method |
|-----------|-----------------|
| Call logs | `business_id` column + query filter |
| Transcripts | Via `call_logs` FK (inherits business isolation) |
| Bookings | Via `call_logs` FK (inherits business isolation) |
| Agent config | `business_id` column |
| Dashboard access | Auth session tied to `business_id` |
| API keys (Mode B) | Encrypted per-business row |

### Isolation rules (for future implementation)

1. A business must never see another business's calls, transcripts, or bookings.
2. Dashboard queries must always include `WHERE business_id = $authenticated_business`.
3. Agent config must be loaded by business_id, not globally.
4. API keys (if per-business) must be cryptographically isolated.

---

## 9. Transcript Privacy

### What is stored

| Field | Sensitivity | Purpose |
|-------|:-----------:|---------|
| `speaker` | Low | "user" or "assistant" |
| `text` | **High** | Caller's spoken words, may include names, dates, health info |
| `timestamp` | Low | Ordering |
| `call_id` | Low | Linkage |

### Privacy rules

1. **Transcripts are business-confidential.** Only authenticated operators should see them.
2. **No transcript data in server logs.** Log `call_id` and `speaker`, never the text content.
3. **Dashboard shows transcripts only to authenticated users** (enforced by middleware).
4. **No transcript search across businesses** (when multi-tenant is implemented).
5. **Future:** Retention policy — auto-delete transcripts older than N days. Not implemented yet.

### HIPAA / health data note

For healthcare deployments (dental clinics, med spas), transcripts may contain health information. While this platform is not HIPAA-certified:
- Data at rest in PostgreSQL should use encrypted storage (Easypanel PostgreSQL supports this).
- Data in transit uses TLS (Easypanel proxy handles HTTPS; PostgreSQL connection uses `sslmode=require` if configured).
- Access is gated by dashboard auth.
- No third-party analytics services receive transcript data.

---

## 10. Recording Privacy

### Current state: No recordings stored

The platform does not record or store audio. Provider recordings (Vobiz, LiveKit) may exist on the provider's infrastructure, subject to their retention policies.

### Future state: Recording links

When recording links are stored:
- Only the URL is stored in `call_logs.recording_url`.
- The recording file lives on the provider's infrastructure.
- Dashboard embeds playback via the external URL.
- No audio data is stored in PostgreSQL.
- Access to recording playback requires dashboard authentication.

---

## 11. Dashboard Auth Rules

### Current implementation

| Rule | Status |
|------|--------|
| All routes except `/login` require authentication | ✅ Middleware enforced |
| Session token is HMAC-SHA256 of `DASHBOARD_PASSWORD` | ✅ |
| Constant-time comparison prevents timing attacks | ✅ |
| Login password check uses constant-time hash comparison | ✅ |
| Session stored in `inbound_dashboard_session` cookie | ✅ |
| 12-hour session expiration via `maxAge` | ✅ Cookie expires after 12 hours |
| Webhook routes (`/api/webhook*`) are public | ✅ Required for external integrations |
| Security headers are emitted by Next.js | ✅ CSP, HSTS, frame, MIME, referrer, permissions policy |

### Missing (future)

| Feature | Target |
|---------|--------|
| Configurable session duration (currently fixed at 12h) | Part 14 |
| Logout endpoint (clear cookie) | Part 14 |
| Rate limiting on login attempts | Part 14 |
| Account lockout after failed attempts | Phase 2 |
| Per-user sessions (multi-business) | Phase 2 |

### Session token behavior

The session token is deterministic — it's always the HMAC of a fixed message using the password as key. This means:
- All operators sharing the same password have the same session token.
- Changing `DASHBOARD_PASSWORD` invalidates all sessions immediately.
- There is no per-session unique identifier or timestamp.
- This is acceptable for single-tenant deployment where one password is shared.

---

## 12. Session Handling

### Current mechanism

```
Login form → server action
    → verify submitted password with constant-time SHA-256 hash comparison
    → HMAC-SHA256(DASHBOARD_PASSWORD, "inbound-dashboard-session-v1")
    → Set cookie: inbound_dashboard_session = hex(signature)

Every request → middleware → verifyDashboardSessionToken()
    → Recompute HMAC → constant-time compare → allow or redirect to /login
```

### Security properties

- **No database session table** — stateless verification using HMAC.
- **No JWT** — simpler, no expiration logic, no refresh tokens.
- **Constant-time comparison** — prevents timing-based password/session guessing.
- **Server-side only** — password never sent to the client.

### Security headers

`next.config.mjs` applies these headers to dashboard responses:

| Header | Purpose |
|--------|---------|
| `Content-Security-Policy` | Restricts scripts, forms, framing, images, fonts, and connections to the app origin |
| `Strict-Transport-Security` | Requires HTTPS on supported browsers after first secure visit |
| `X-Frame-Options: DENY` | Prevents clickjacking by blocking framing |
| `X-Content-Type-Options: nosniff` | Prevents MIME type sniffing |
| `Referrer-Policy` | Limits referrer leakage to other origins |
| `Permissions-Policy` | Disables camera, microphone, and geolocation in the dashboard |

### Limitations

- No session revocation (short of changing the password).
- 12-hour expiration exists (`maxAge: 43200`), but duration is not configurable from dashboard.
- No concurrent session tracking.
- Deterministic token means all sessions are identical.

---

## 13. PostgreSQL-Only Persistence

### Why PostgreSQL only

- One data store to secure, back up, and monitor.
- No Redis, no Elasticsearch, no S3, no Supabase SDK.
- All secrets about the database are contained in one env var (`DATABASE_URL`).
- Fewer attack surfaces.

### Database access controls

| Control | Status |
|---------|--------|
| Internal Docker network only | ✅ Service name routing |
| No public PostgreSQL port | ✅ (unless explicitly exposed in Easypanel) |
| Authenticated connection | ✅ (username/password in DATABASE_URL) |
| TLS connection | ⚠️ Depends on PostgreSQL/Easypanel configuration |
| Read-only dashboard user | ❌ Not implemented — dashboard uses same credentials |

### Future: Read/write separation

For defense in depth, the dashboard should ideally use a read-only database user for all SELECT queries, and a read-write user only for config save actions. This is not implemented — both Python and Next.js use the same `DATABASE_URL`.

---

## 14. Logging Safety

### What is logged

| Data | Logged? | Safe? |
|------|:-------:|:-----:|
| Call lifecycle events (start, end) | Yes | ✅ |
| Call IDs | Yes | ✅ |
| Phone numbers | Yes (in some log lines) | ⚠️ PII |
| Transcript text | No | ✅ |
| API keys | No | ✅ |
| DATABASE_URL | No (but may leak in connection errors) | ⚠️ |
| Fast2SMS response payloads | Yes | ⚠️ May contain phone numbers |
| Cal.com response payloads | Yes (on error) | ⚠️ May contain booking details |

### Logging rules

1. **Never log API keys** — even partially.
2. **Redact DATABASE_URL and known secret values in error messages** — replace secret values with `***`.
3. **Minimize phone number logging** — log only when needed for debugging, mask middle digits.
4. **Never log transcript text** — use `call_id` for correlation instead.
5. **Log SMS responses carefully** — redact phone numbers from response payloads.

---

## 15. Admin Access Philosophy

### Current state

- One password, one level of access.
- Anyone with the password can see all data and change all config.
- Appropriate for single-business, single-operator deployments.

### Future state (multi-business)

| Role | Permissions |
|------|-------------|
| **Platform admin** | All businesses, all data, all config, user management |
| **Business admin** | Own business data, config, users |
| **Business operator** | Own business data (read), config (read) |

### What must NOT be built now

- Role-based access control (RBAC).
- OAuth / SSO integration.
- Audit logging of config changes.
- IP whitelisting.
- Two-factor authentication.

These are Phase 2/3 concerns. The current deployment serves one business with one operator.

---

## 16. Threat Summary

| Threat | Current mitigation | Gap |
|--------|-------------------|-----|
| Unauthorized dashboard access | Password + HMAC session + 12h cookie expiry | No rate limiting |
| Database credential theft | Env var, server-only | Connection error may leak URL |
| API key theft | Env var, server-only, startup validation | Rotate manually if exposed |
| Transcript data breach | Auth-gated dashboard | No encryption at rest (depends on PG config) |
| Cross-business data leakage | N/A (single tenant) | Must be addressed in multi-business phase |
| Brute-force login | None | No rate limiting, no lockout |
| Man-in-the-middle | Easypanel TLS for HTTPS | DB connection TLS depends on config |
| Log-based credential leak | Mostly safe | DATABASE_URL in error messages |
| Client-side secret exposure | server-only guards, no NEXT_PUBLIC_ | Compile-time protection only |
