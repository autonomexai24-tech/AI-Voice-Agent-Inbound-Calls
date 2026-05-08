# RUNBOOK.md — Launch Validation & Operations

> **Subordinate to:** `/docs/PLAN.md`
> **Scope:** Part 15 launch validation, Easypanel deployment, rollback, backup, and post-launch checks.

---

## 1. Production Launch Gate

Do not send production traffic to the DID until every item below is marked pass.

| Check | Pass/Fail | Evidence |
|---|---|---|
| Container image builds successfully |  |  |
| Easypanel service starts one container |  |  |
| `/api/health?scope=liveness` returns HTTP 200 |  |  |
| `/api/health` readiness returns HTTP 200 |  |  |
| Dashboard redirects unauthenticated users to `/login` |  |  |
| Dashboard login works with `DASHBOARD_PASSWORD` |  |  |
| Agent Config save works |  |  |
| New call uses latest greeting and language config |  |  |
| Inbound DID reaches LiveKit and starts `inbound-voice-agent` |  |  |
| Call creates a `call_logs` row |  |  |
| Transcript turns are saved in `transcripts` |  |  |
| Confirmed booking creates/updates one `bookings` row |  |  |
| Fast2SMS sends exactly one booking confirmation SMS |  |  |
| SMS attempt is recorded in `notification_events` |  |  |
| CRM search finds the caller by phone/name |  |  |
| Calendar page shows the confirmed booking |  |  |
| Container restart preserves DB data and resumes service |  |  |
| Rollback procedure has been tested |  |  |
| PostgreSQL backup has been taken and restore path is known |  |  |

---

## 2. Required Environment Variables

Configure these in Easypanel. Do not commit production values.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Easypanel PostgreSQL internal connection URL |
| `OPENAI_API_KEY` | GPT-4o reasoning |
| `LIVEKIT_URL` | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | LiveKit worker authentication |
| `LIVEKIT_API_SECRET` | LiveKit worker authentication |
| `SARVAM_AI_API_KEY` or `SARVAM_API_KEY` | Sarvam STT/TTS |
| `CALCOM_API_KEY` | Cal.com booking |
| `CALCOM_EVENT_TYPE_ID` or `CAL_EVENT_TYPE_ID` | Cal.com event type |
| `FAST2SMS_API_KEY` | Booking confirmation SMS |
| `DASHBOARD_PASSWORD` | Operator dashboard login |
| `DASHBOARD_SESSION_MAX_AGE` | Optional session lifetime in seconds |
| `AGENT_STATUS_PATH` | Optional health status file path; default `/tmp/inbound-agent-status.json` |

If the database password contains `@`, percent-encode it as `%40` in `DATABASE_URL`.

---

## 3. Easypanel Deployment Steps

1. Create or select the Easypanel project for the clinic.
2. Add a PostgreSQL service in the same project.
3. Copy the internal PostgreSQL connection URL into `DATABASE_URL`.
4. Add the remaining required environment variables from section 2.
5. Configure the application service to build from this repository's `Dockerfile`.
6. Expose public HTTPS traffic to container port `3000`.
7. Keep the service as a single container; Supervisor starts the Python worker and Next.js dashboard.
8. Deploy the service.
9. Watch logs until `Initialized database schema` appears and Supervisor starts both programs.
10. Open `https://<domain>/api/health?scope=liveness` and confirm it returns `status: "alive"`.
11. Open `https://<domain>/api/health` and confirm strict readiness returns `status: "healthy"`.

The Docker healthcheck calls `http://127.0.0.1:3000/api/health?scope=liveness` so Easypanel can promote a new frontend container when the web process is alive. Use `/api/health` without query parameters for strict backend readiness; it checks env vars, PostgreSQL, schema, and agent runtime state.

---

## 4. Automated Launch Validation

After deployment, run the validator from inside the container or from any environment with the same env vars.

```bash
python launch_validate.py --base-url https://<domain>
```

For JSON output:

```bash
python launch_validate.py --base-url https://<domain> --json
```

For database and environment checks only:

```bash
python launch_validate.py --skip-http
```

Expected pass checks:

| Check | What it proves |
|---|---|
| `environment` | Required launch env vars are present and structurally valid |
| `database_schema` | PostgreSQL has all required tables, columns, and default `agent_config` |
| `health_endpoint` | Public strict readiness endpoint reports healthy runtime |
| `login_page` | Dashboard login page is reachable |
| `dashboard_auth` | Dashboard is not public without authentication |

---

## 5. Manual End-to-End Validation

### 5.1 Dashboard Login

1. Open `https://<domain>/dashboard`.
2. Confirm unauthenticated access redirects to `/login`.
3. Log in with `DASHBOARD_PASSWORD`.
4. Confirm Dashboard, CRM, Calendar, Agent Config, and Business pages load.

### 5.2 Agent Config Change

1. Open Agent Config.
2. Change the greeting to a launch-test phrase.
3. Select `en-IN`, `hi-IN`, or `kn-IN`.
4. Save.
5. Confirm the save succeeds and a new call uses the updated greeting and selected voice language.
6. Restore the production greeting before launch.

### 5.3 Inbound Call

1. Place a test call to the production DID.
2. Confirm the call reaches LiveKit and the agent answers.
3. Verify logs include `livekit_room_connected`, `call_log_created`, and `call_active`.
4. End the call.
5. Confirm CRM shows the call with correct phone number, duration, language, status, and transcript.

### 5.4 Booking

1. Place a test call.
2. Ask for an appointment.
3. Give name, phone, and exact appointment time.
4. Confirm details verbally when the agent repeats them.
5. Confirm the agent says the filler phrase before booking.
6. Confirm Calendar shows the booking.
7. Confirm the booking is linked to the call in CRM.

### 5.5 SMS

1. Use a real Indian mobile number during the booking test.
2. Confirm exactly one Fast2SMS message is received.
3. Confirm `bookings.sms_sent=true`.
4. Confirm `notification_events` has one `booking_confirmation` row for the call.
5. If SMS fails, review `notification_events.error_message` and Fast2SMS account status.

### 5.6 Restart

1. Restart the Easypanel application service.
2. Confirm the container becomes healthy.
3. Confirm `/api/health` returns HTTP 200.
4. Confirm existing CRM and Calendar data remains visible.
5. Place another short inbound call to confirm the worker resumed.

---

## 6. Post-Launch Monitoring

Check these during the first production day, then daily.

| Signal | Where | Healthy value |
|---|---|---|
| Container health | Easypanel | Healthy |
| `/api/health?scope=liveness` | Docker/Easypanel healthcheck | HTTP 200, `status: "alive"` |
| `/api/health` | Browser or curl | HTTP 200, `status: "healthy"` |
| Supervisor restarts | Easypanel logs | No restart loop |
| Agent startup | Logs | `startup_validation_passed` |
| LiveKit connection | Logs | No repeated `livekit_room_connect_failed` |
| Booking failures | Logs / CRM | Low or explained by caller/provider |
| SMS failures | `notification_events` | None or provider-explained |
| Dashboard metrics | Dashboard | Matches DB rows |
| Call latency | Test calls | No dead air longer than about 2 seconds |

Useful SQL:

```sql
select status, outcome, count(*)
from call_logs
where start_time >= now() - interval '24 hours'
group by status, outcome
order by count(*) desc;
```

```sql
select status, count(*)
from notification_events
where created_at >= now() - interval '24 hours'
group by status;
```

```sql
select appointment_time, status, sms_sent, caller_name, caller_phone
from bookings
order by appointment_time desc
limit 20;
```

---

## 7. Rollback Procedure

Rollback should be tested before production traffic.

1. Identify the last known-good image or git commit.
2. In Easypanel, redeploy that image/commit without changing PostgreSQL.
3. Keep the same environment variables and `DATABASE_URL`.
4. Wait for the container healthcheck to pass.
5. Run:

```bash
python launch_validate.py --base-url https://<domain>
```

6. Place one short inbound call.
7. Confirm CRM receives the call record.

Do not drop or recreate PostgreSQL during rollback unless a verified database restore is intentionally being performed.

---

## 8. Backup And Restore

Before launch:

1. Take a PostgreSQL backup from Easypanel.
2. Record where the backup is stored.
3. Confirm the restore workflow on a non-production database if possible.

Minimum backup schedule after launch:

| Data | Frequency |
|---|---|
| PostgreSQL database | Daily |
| Easypanel env var snapshot | After every env change |
| Docker image / git commit reference | Every deploy |

Restore validation:

1. Restore backup to a separate PostgreSQL service.
2. Point a staging copy of the app to the restored `DATABASE_URL`.
3. Run `python launch_validate.py --skip-http`.
4. Check CRM and Calendar data manually.

---

## 9. Known Issues And Workarounds

| Issue | Impact | Workaround |
|---|---|---|
| `recording_url` exists but is not populated | CRM cannot show recordings yet | Use provider-side Vobiz/LiveKit recordings until recording URL capture is implemented |
| Python DB helper opens a connection per query | Acceptable at current low scale; less efficient at high call volume | Add pooling only when production traffic requires it |
| Mixed-language mode uses one TTS language per call | Agent may not switch spoken output every sentence | Set the primary language to the business's preferred output language |
| Cal.com or Fast2SMS outage | Bookings or SMS may fail | Check provider dashboards and `notification_events`; retry caller follow-up manually |
| Docker build cannot run locally if Docker Desktop is stopped | Local image verification blocked | Start Docker Desktop or build in Easypanel/CI |
