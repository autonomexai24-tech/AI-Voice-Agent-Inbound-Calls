# RUNBOOK.md — Launch Validation and Operations

This runbook is for the operator or engineer launching and maintaining the inbound AI receptionist in production.

The goal is simple: deploy one container on Easypanel, verify the voice agent and dashboard, and recover safely if anything fails.

---

## 1. Launch Rule

Do not launch production traffic until every required launch checklist item is marked pass.

If a required item fails:

1. Stop the launch.
2. Keep the previous deployment serving traffic.
3. Fix the failed item.
4. Re-run the failed item and every dependent item.

---

## 2. Production Environment Checklist

Set these values in Easypanel environment variables before deployment:

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL persistence |
| `OPENAI_API_KEY` | Yes | LLM responses |
| `LIVEKIT_URL` | Yes | LiveKit connection |
| `LIVEKIT_API_KEY` | Yes | LiveKit auth |
| `LIVEKIT_API_SECRET` | Yes | LiveKit auth |
| `SARVAM_AI_API_KEY` | Yes | Sarvam STT/TTS |
| `CALCOM_API_KEY` | Yes | Booking API |
| `CALCOM_EVENT_TYPE_ID` | Yes | Booking event type |
| `FAST2SMS_API_KEY` | Yes | Booking confirmation SMS |
| `DASHBOARD_PASSWORD` | Yes | Dashboard access |
| `DASHBOARD_SESSION_MAX_AGE` | No | Session duration in seconds (default: 43200 = 12 hours) |

Rules:

- Use the internal PostgreSQL service hostname in `DATABASE_URL`.
- Percent-encode special characters in database passwords.
- Do not expose PostgreSQL publicly.
- Do not add `NEXT_PUBLIC_` to secrets.
- Store a separate offline copy of production env values in the operator password manager.

---

## 3. Deployment SOP

1. Confirm PostgreSQL is running in Easypanel.
2. Confirm all required environment variables are present.
3. Deploy the latest image or trigger Easypanel rebuild from the production branch.
4. Wait for the container to start.
5. Open container logs.
6. Confirm database initialization completed.
7. Confirm Supervisor started both processes.
8. Confirm the voice worker reports startup validation success.
9. Confirm the dashboard is listening on port `3000`.
10. Check `/api/health`.

Expected health result:

```json
{
  "status": "healthy",
  "checks": {
    "app": "ok",
    "database": "ok",
    "schema": "ok",
    "databaseUrl": "ok",
    "openaiApiKey": "ok",
    "livekitUrl": "ok",
    "livekitApiKey": "ok",
    "livekitApiSecret": "ok",
    "sarvamApiKey": "ok",
    "calcomApiKey": "ok",
    "calcomEventTypeId": "ok",
    "fast2smsApiKey": "ok",
    "dashboardPassword": "ok"
  }
}
```

---

## 4. Launch Validation Checklist

Use this table during launch. Record pass/fail and notes.

| Area | Required check | Pass/Fail | Notes |
|------|----------------|-----------|-------|
| Container | Docker image builds successfully |  |  |
| Container | Container starts without restart loop |  |  |
| Supervisor | Voice worker starts |  |  |
| Supervisor | Dashboard starts |  |  |
| Health | `/api/health` returns `200` |  |  |
| Health | `/api/health` shows every required env group as `ok` |  |  |
| Health | `/api/health` shows required PostgreSQL schema as `ok` |  |  |
| Auth | Dashboard login works with production password |  |  |
| Config | Agent config saves and persists after refresh |  |  |
| English | English-only inbound call works |  |  |
| Hindi | Hindi-only inbound call works |  |  |
| Kannada | Kannada-only inbound call works |  |  |
| Mixed | Mixed-language inbound call works naturally |  |  |
| Runtime config | New call uses latest language config |  |  |
| Booking | Caller can book an appointment |  |  |
| Booking | Booking is persisted in PostgreSQL |  |  |
| SMS | Booking SMS sends with production credentials |  |  |
| Audit | SMS event appears in notification audit storage |  |  |
| Transcript | Full transcript is saved |  |  |
| CRM | Latest call appears in CRM |  |  |
| CRM | Transcript detail page is readable |  |  |
| CRM | Booking, language, repeat-caller, phone/name, and date filters work |  |  |
| Dashboard | Metrics match database records |  |  |
| Dashboard | Latest confirmed bookings section matches PostgreSQL |  |  |
| Analytics | Language usage counts are plausible |  |  |
| Restart | Container restart recovers cleanly |  |  |
| Shutdown | Active call finalization survives graceful restart |  |  |
| Latency | Greeting and replies feel responsive |  |  |
| Latency | Booking filler prevents awkward silence |  |  |

Launch only when every required row passes.

---

## 5. Inbound Call Validation Script

Run these calls against the production LiveKit/SIP number.

### English-only

1. Set primary language to English.
2. Disable mixed language.
3. Call the number.
4. Ask a normal booking question in English.
5. Confirm the assistant responds in English.
6. Complete a booking.
7. Verify transcript, booking, and SMS audit.

### Hindi-only

1. Set primary language to Hindi.
2. Disable mixed language.
3. Call the number.
4. Speak in Hindi.
5. Confirm the assistant responds in Hindi.
6. Complete or intentionally decline booking.
7. Verify transcript and call outcome.

### Kannada-only

1. Set primary language to Kannada.
2. Disable mixed language.
3. Call the number.
4. Speak in Kannada.
5. Confirm the assistant responds in Kannada.
6. Verify transcript and call outcome.

### Mixed language

1. Enable mixed language.
2. Set the expected primary language.
3. Call the number.
4. Mix English with Hindi or Kannada naturally.
5. Confirm the assistant adapts softly without switching languages every sentence.
6. Complete a short booking flow.
7. Verify transcript, booking, and SMS audit.

---

## 6. Booking and SMS Validation

Required production booking checks:

1. Ask for a valid appointment slot.
2. Confirm caller name, phone number, date, and time.
3. Confirm the assistant says a short filler before booking.
4. Confirm the booking is created.
5. Confirm the booking appears in the dashboard.
6. Confirm SMS is sent.
7. Confirm notification audit storage has one `booking_confirmation` event.

Failure checks:

1. Temporarily test an unavailable slot or invalid input.
2. Confirm the assistant gives a concise fallback.
3. Confirm no false booking is recorded.
4. Confirm logs show the provider failure without exposing secrets.

---

## 7. Dashboard and CRM Validation

Verify these operator workflows:

1. Dashboard opens after login.
2. Total calls match recent call records.
3. Booking conversion rate matches booked outcomes.
4. Average duration is plausible.
5. Missed or failed calls are visible.
6. Booked appointments are visible.
7. Repeat callers are surfaced.
8. Language usage is visible.
9. Peak call hour analytics are plausible.
10. CRM search works by phone number.
11. CRM search works by caller name.
12. CRM date filtering works.
13. CRM pagination works.
14. Transcript detail page opens.
15. Full transcript is readable.
16. Recording links open when present.
17. Sign out button logs out and redirects to login.

---

## 8. Latency Validation

Use live calls, not only logs.

Pass criteria:

- Greeting starts without a long pause.
- The assistant asks one question at a time.
- Replies are short and receptionist-like.
- Caller interruption stops or redirects the assistant naturally.
- Booking filler is short and appears before the booking operation.
- No extra translation or routing delay is noticeable.
- Mixed-language handling remains conversational, not mechanical.

Fail criteria:

- Long silence before first response.
- Long silence during booking.
- Verbose confirmations.
- Assistant keeps talking over the caller.
- Language switching feels aggressive or unnatural.

---

## 9. Restart and Shutdown SOP

Use graceful restart for normal deploys.

1. Avoid restarting during an active production call when possible.
2. Trigger redeploy or restart in Easypanel.
3. Watch logs for shutdown finalization events.
4. Confirm the container exits cleanly.
5. Confirm the replacement container becomes healthy.
6. Place a test call.
7. Verify call log and transcript persistence.

If a restart happens during a live call, verify:

- call log status is no longer stuck as `in_progress`;
- transcript turns before shutdown are present;
- booking record is either completed or absent, never partially misleading;
- SMS audit exists if SMS was attempted.

---

## 10. Rollback SOP

Rollback is deployment-first. The database schema is additive, so normal rollback does not require manual schema reversal.

1. In Easypanel, redeploy the previous known-good image or commit.
2. Keep the same PostgreSQL database.
3. Keep the same environment variables.
4. Wait for `/api/health` to return healthy.
5. Run one short inbound call test.
6. Verify dashboard login.
7. Verify CRM loads recent calls.

Do not manually delete additive columns or audit tables during rollback. Old code ignores fields it does not use.

---

## 11. Broken Deploy Recovery

If the container fails to start:

1. Check Easypanel logs.
2. Look for missing environment variable messages.
3. Check database initialization errors.
4. Check whether PostgreSQL is reachable from the app container.
5. Fix env or database connectivity.
6. Redeploy.

If `/api/health` returns `503`:

1. Read the `checks` object.
2. If any env group is `missing`, set the corresponding Easypanel environment variable.
3. If `calcomEventTypeId` is `failed`, verify the value is numeric.
4. If `database` failed, verify `DATABASE_URL` and PostgreSQL health.
5. If `schema` failed, run database initialization or redeploy so `init_db.py` can apply `schema.sql`.
6. Redeploy or restart after fixing env or database state.

If inbound calls fail:

1. Verify LiveKit env values.
2. Verify the worker startup logs.
3. Verify SIP trunk routing in LiveKit.
4. Make a test call.

If bookings fail:

1. Verify Cal.com API key.
2. Verify event type ID.
3. Verify the requested slot is valid.
4. Review booking failure logs.

If SMS fails:

1. Verify Fast2SMS API key.
2. Check notification audit storage for failed events.
3. Review provider response text.
4. Do not retry manually until confirming whether the provider sent the message.

---

## 12. Backup SOP

Minimum backup strategy:

1. Enable Easypanel PostgreSQL backups if available.
2. Keep at least daily database backups.
3. Keep at least seven days of backups.
4. Export or record production environment variables in a password manager after every change.
5. Record the deployed image tag or commit for every launch.
6. Before high-risk changes, take a manual PostgreSQL backup.

Restore test:

1. Restore a backup into a non-production database.
2. Point a staging deployment at the restored database.
3. Confirm dashboard loads calls, transcripts, bookings, and agent config.

---

## 13. Post-Launch Monitoring

For the first production day, check every hour:

- `/api/health`
- container restart count
- voice worker logs
- dashboard login
- latest call records
- transcript persistence
- booking success rate
- SMS audit events
- latency complaints from operators

For normal operation, check daily:

- failed calls
- failed SMS events
- missed booking opportunities
- unusually long call durations
- repeated health failures
- PostgreSQL backup freshness

---

## 14. Known Issues and Workarounds

| Issue | Impact | Workaround |
|-------|--------|------------|
| Sarvam TTS cold-start latency on first call after container start | First caller may hear a ~1s extra pause before the greeting | Place one warm-up call after each deploy or restart |
| Cal.com API may return 429 under burst booking traffic | Booking fails for that call; caller hears fallback message | The agent retries once naturally on next caller turn; no manual action needed |
| Fast2SMS delivery receipts are not available via API | `notification_events` records send/fail but not final delivery | Monitor operator feedback for missed SMS; check Fast2SMS dashboard manually |
| Mixed-language STT uses `language="unknown"` which relies on Sarvam auto-detect | Accuracy may be lower for short utterances in non-primary language | If accuracy is poor, disable mixed-language and set a single primary language |
| Session token is HMAC-based, not expiring on password change | If `DASHBOARD_PASSWORD` is rotated, old sessions remain valid until cookie expires | Restart the container after password rotation to invalidate all sessions |
| Transcript persistence is fire-and-forget | A database hiccup during a call may lose individual transcript turns | `log_transcript_turn` errors are logged; check voice worker stderr for `[DB] Failed to log transcript turn` |

---

## 15. Go / No-Go Criteria

Go only if:

- health endpoint is healthy;
- dashboard login works;
- all four language modes pass live-call validation;
- booking and SMS pass with production credentials;
- transcripts and CRM records are visible;
- restart recovery passes;
- rollback target is known;
- database backup strategy is active.

No-go if:

- Docker image cannot build in the deployment environment;
- startup validation fails;
- health endpoint stays unhealthy;
- production calls cannot connect;
- booking persistence fails;
- SMS provider cannot be validated;
- dashboard cannot authenticate;
- rollback target is unknown.
