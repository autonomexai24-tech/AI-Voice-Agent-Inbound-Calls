# Senior Codebase Audit & Deployment Preparation

## Execution Status - 2026-05-07

The actionable local review items have been executed in this pass.

- Fixed legacy Supabase/schema drift by replacing `ui_server.py` with an explicit disabled legacy dashboard shim. Requests to legacy API paths now return `410` instead of calling removed `db.py` helpers or old Supabase variables.
- Fixed legacy Cal.com env drift in `calendar_tools.py` by using `CALCOM_API_KEY` and `CALCOM_EVENT_TYPE_ID`, with integer validation for the event type ID.
- Fixed Windows-incompatible slot formatting in `calendar_tools.py` by replacing `%-I` formatting with a portable formatter.
- Fixed LiveKit helper dispatch mismatch by changing `make_call.py` to dispatch `inbound-voice-agent`, matching `agent.py`.
- Added call lifecycle completion in `agent.py`: shutdown now drains transcript tasks, updates `call_logs.duration`, final `status`, and final `outcome`, then runs the post-call SMS check.
- Sanitized `config.json` so it no longer contains legacy hosted Supabase credentials or old env names.
- Ran `python -m py_compile agent.py db.py notifications.py tools.py calendar_tools.py make_call.py ui_server.py`: passed.
- Ran `npm run build` from `frontend`: passed.
- Attempted `docker build -t inbound-ai-voice-review .` from the repository root: blocked because Docker Desktop Linux engine is not reachable on this machine (`dockerDesktopLinuxEngine` pipe missing).
- Ran `git status --porcelain` and `git diff --stat`: completed. The working tree contains intentional uncommitted infrastructure, backend, frontend, and review changes.

Deployment remains blocked only on environment/provider validation and a Docker build from a machine with Docker available:

- Docker build must be rerun once Docker Desktop or the deployment builder is available.
- Fast2SMS must still be validated once with the production account/template route.
- Cal.com booking should still be smoke-tested with production credentials.

Deployment is currently **PAUSED** until the review items below are fixed or explicitly accepted.

## Critical Mistakes

- **Legacy `ui_server.py` is incompatible with current `db.py`**
  - `ui_server.py` still calls removed or nonexistent functions such as `db.fetch_call_logs`, `db.fetch_bookings`, and `db.fetch_stats`.
  - It also creates Supabase clients with legacy `SUPABASE_URL` and `SUPABASE_KEY` variables instead of the required self-hosted `SUPABASE_SELF_HOSTED_URL` plus `SUPABASE_SERVICE_ROLE_KEY` routing.
  - If `ui_server.py` is launched, several dashboard API routes will fail at runtime.

- **Duplicate/legacy Cal.com implementation uses wrong environment variable names**
  - `calendar_tools.py` reads `CAL_API_KEY` and `CAL_EVENT_TYPE_ID`, but the required deployment contract uses `CALCOM_API_KEY` and `CALCOM_EVENT_TYPE_ID`.
  - The active LiveKit tool path in `tools.py` correctly reads `CALCOM_API_KEY` and accepts `CALCOM_EVENT_TYPE_ID`, but `calendar_tools.py` remains a disconnected legacy path that can silently fail if imported or used later.

- **Outbound helper dispatches a mismatched LiveKit agent name**
  - `agent.py` registers the worker as `inbound-voice-agent`.
  - `make_call.py` dispatches `outbound-caller`, so that helper will not attach to the current worker unless a separate worker with that name exists.

- **Frontend and voice worker contend for the same exposed port**
  - `supervisord.conf` runs the Next.js standalone server on `PORT=8000`.
  - The Dockerfile exposes only `8000`.
  - The LiveKit worker itself normally does not bind that HTTP port, so this is acceptable for the current worker/dashboard pairing, but do not add another HTTP server on `8000` without changing the port plan.

- **Schema drift exists between legacy files and current dashboard**
  - Current dashboard code expects `call_logs.id`, `phone_number`, `start_time`, `duration`, `status`, `outcome`; `transcripts.call_id`, `speaker`, `text`, `timestamp`; `bookings.call_id`, `appointment_time`, `status`, `sms_sent`; and `agent_config` fields.
  - `ui_server.py` references older columns such as `created_at`, `duration_seconds`, `summary`, `caller_name`, and inline transcript storage. Those references do not match `schema.sql`.

- **Potential platform-specific datetime formatting bug**
  - `calendar_tools.py` uses `strftime("%-I:%M %p")`, which is not portable on Windows. It may fail in local Windows testing.
  - This is in legacy booking-slot code, not the active `tools.py` booking path.

- **Fast2SMS contract requires live-provider validation**
  - `notifications.py` sends an HTTP POST to `https://www.fast2sms.com/dev/bulkV2` with `authorization` header and JSON payload containing `route`, `message`, `language`, `flash`, and `numbers`.
  - This matches common Fast2SMS quick route usage, but the exact accepted payload can depend on account route/template configuration. Verify once with the production Fast2SMS account before enabling post-call SMS.

## Missing Executions

- **No code fixes were applied yet by instruction**
  - This audit intentionally did not modify `.py`, `.ts`, or `.tsx` files.
  - The above code-breaking issues remain in source and must be fixed before deployment is unpaused.

- **Legacy Python UI was not removed or reconciled**
  - The generated project now has a Next.js dashboard, but `ui_server.py`, `config.json`, and older docs/scripts still exist.
  - If the deployment is meant to be Next.js plus LiveKit worker only, legacy UI paths should be disabled or deleted in a later cleanup pass.

- **Environment naming is only partially consolidated**
  - Active backend/database code uses `SUPABASE_SELF_HOSTED_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
  - Active Cal.com voice tool uses `CALCOM_API_KEY` and `CALCOM_EVENT_TYPE_ID`.
  - Legacy files still reference `SUPABASE_URL`, `SUPABASE_KEY`, `CAL_API_KEY`, and `CAL_EVENT_TYPE_ID`.

- **Call lifecycle completion is incomplete**
  - `agent.py` creates `call_logs` rows with `status=connected` and `outcome=in_progress`.
  - There is no confirmed update of final call duration/status/outcome when the call ends, so dashboard metrics can show zero average duration and in-progress outcomes.

- **Transcript task errors are logged but task handles are not tracked**
  - Transcript persistence uses `asyncio.create_task` inside an event handler.
  - The task body catches database errors, which reduces unhandled promise/task risk, but tasks are not awaited or drained during shutdown.

- **Self-hosted Supabase frontend segregation is server-only, not browser anon usage**
  - Next.js data access is correctly placed behind `server-only` modules and server actions using the service role key.
  - `SUPABASE_ANON_KEY` is still required in `.env.example` for future browser-safe usage or Supabase client tooling, but the current dashboard does not use it in browser code.

- **Docker readiness is mostly satisfied**
  - `frontend/next.config.mjs` has `output: "standalone"` enabled.
  - The Docker runtime stage installs `ffmpeg`.
  - Supervisor starts Next.js with `node server.js` from `/app/frontend/.next/standalone`, which matches standalone deployment expectations.

- **Cal.com active booking argument parsing is acceptable**
  - `tools.py` exposes `book_appointment(name, phone, date_time)` with typed/annotated arguments.
  - It validates `CALCOM_EVENT_TYPE_ID` as an integer and normalizes ISO 8601 datetime input.
  - It returns safe caller-facing failure messages for missing env, invalid datetime, timeout, Cal.com rejection, and database failure.

## .env Consolidation

Use a single root `.env` file for the Docker/Easypanel deployment. Do not commit real secret values.

### Backend: LiveKit Worker

- **`LIVEKIT_URL`**
  - LiveKit server URL, usually `wss://<project>.livekit.cloud` for LiveKit Cloud or `ws(s)://<host>` for self-hosted LiveKit.

- **`LIVEKIT_API_KEY`**
  - LiveKit API key used by the Python worker and dispatch/helper scripts.

- **`LIVEKIT_API_SECRET`**
  - LiveKit API secret used by the Python worker and dispatch/helper scripts.

- **`OPENAI_API_KEY`**
  - OpenAI API key used by the LiveKit OpenAI LLM plugin.

- **`SARVAM_API_KEY`**
  - Sarvam AI key used by the LiveKit Sarvam STT/TTS plugin.

### Backend: Bookings and Notifications

- **`CALCOM_API_KEY`**
  - Cal.com API key for creating bookings through `https://api.cal.com/v2/bookings`.

- **`CALCOM_EVENT_TYPE_ID`**
  - Numeric Cal.com event type ID. This must parse as an integer.

- **`FAST2SMS_API_KEY`**
  - Fast2SMS API key for post-booking SMS notifications.

### Shared Backend/Server-Side Dashboard: Self-Hosted Supabase

- **`SUPABASE_SELF_HOSTED_URL`**
  - Internal self-hosted Supabase Kong URL used from inside the VPS/container network.
  - Easypanel/Docker example: `http://supabase-kong:8000` or the exact internal service URL assigned by your Supabase stack.
  - Do not use a public hosted Supabase URL for production if this deployment is intended to use the self-hosted Supabase stack.

- **`SUPABASE_SERVICE_ROLE_KEY`**
  - Self-hosted Supabase service role key.
  - Used only by Python backend and Next.js server-only code. Never expose this in browser code.

- **`SUPABASE_ANON_KEY`**
  - Self-hosted Supabase anon key.
  - Safe for browser-side Supabase usage if needed later, but current dashboard server modules do not need to expose it client-side.

### Frontend: Dashboard Security

- **`DASHBOARD_PASSWORD`**
  - Single shared dashboard password.
  - Required by Next.js middleware and login server action.

## Next Steps

Deployment remains **PAUSED** until the Critical Mistakes are fixed or explicitly accepted.

### Git Push Process

1. Review `review.md` and confirm which findings must be fixed before deployment.
2. After fixes are made in a later pass, run local verification:
   - `python -m py_compile agent.py db.py notifications.py tools.py calendar_tools.py make_call.py`
   - `npm run build` from the `frontend` directory
   - Docker build test from the repository root
3. Check the working tree:
   - `git status`
   - `git diff`
4. Commit only intentional files:
   - `git add .env.example review.md`
   - After later code fixes, add only the fixed source files.
   - `git commit -m "Prepare inbound voice platform deployment review"`
5. Push to the deployment branch:
   - `git push origin main`

### Easypanel Docker Deployment Steps

1. Create or open the Easypanel app for this repository.
2. Choose Dockerfile-based deployment from the repository root.
3. Set the build context to the project root containing `Dockerfile`.
4. Add all required environment variables from the `.env Consolidation` section.
5. Ensure `SUPABASE_SELF_HOSTED_URL` points to the internal Supabase Kong URL reachable from the app container, for example `http://supabase-kong:8000` if that is the service name on the Easypanel network.
6. Expose port `8000` for the Next.js dashboard.
7. Confirm the container command remains Supervisor-driven and starts:
   - Python LiveKit worker: `python agent.py start`
   - Next.js standalone dashboard: `node server.js` from `.next/standalone`
8. Deploy only after the paused review items are resolved.
9. After deployment, verify logs for:
   - LiveKit worker registration as `inbound-voice-agent`
   - Next.js dashboard listening on `0.0.0.0:8000`
   - Successful Supabase service-role connection
   - Successful Cal.com booking test
   - Successful Fast2SMS test message
