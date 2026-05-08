# CALL_FLOW.md — End-to-End Runtime Call Lifecycle

> **Source files:** `agent.py`, `tools.py`, `notifications.py`, `db.py`
> **Subordinate to:** `/docs/PLAN.md`
> **Last verified against code:** 2026-05-08

---

## 1. Complete Call Flow

```
┌────────────────────────────────────────────────────────────────────┐
│ PHASE 1: CALL SETUP                                               │
│                                                                    │
│  1. Caller dials DID number                                       │
│  2. Vobiz SIP trunk → LiveKit Cloud SIP Gateway                  │
│  3. LiveKit dispatch rule matches agent_name="inbound-voice-agent"│
│  4. LiveKit spawns worker process → entrypoint(ctx) called        │
│  5. ctx.connect() — join the LiveKit room                         │
│  6. Sleep 0.25s — allow SIP metadata to arrive         [LATENCY] │
│  7. Parse phone number from room/job metadata or participant      │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ PHASE 2: INITIALIZATION                                           │
│                                                                    │
│  8. fetch_active_agent_config()                        [DB READ]  │
│     └─ SELECT from agent_config ORDER BY updated_at DESC LIMIT 1  │
│     └─ Fallback to hardcoded defaults on failure                  │
│  9. create_call_log(caller_phone)                      [DB WRITE] │
│     └─ INSERT INTO call_logs (phone_number, start_time,           │
│        status='connected', outcome='in_progress', language config)│
│        RETURNING id                                               │
│ 10. Build VoicePipelineAgent with config + call_id                │
│ 11. set_booking_call_context(call_id)                             │
│     └─ Sets ContextVar + global for booking tool                  │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ PHASE 3: VOICE PIPELINE START                                     │
│                                                                    │
│ 12. Create AgentSession with STT, LLM, TTS, VAD                  │
│ 13. Attach transcript logging event handler                       │
│ 14. session.start(agent, room)                                    │
│ 15. InboundAssistant.on_enter() fires                             │
│     └─ LLM generates greeting speech                  [LATENCY]  │
│     └─ TTS speaks greeting to caller                  [LATENCY]  │
│ 16. Register shutdown callback: finalize_call()                   │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ PHASE 4: LIVE CONVERSATION                                        │
│                                                                    │
│ Per turn:                                                          │
│ 17. Caller speaks → Sarvam STT transcribes             [LATENCY] │
│ 18. Transcript text → OpenAI GPT-4o generates reply    [LATENCY] │
│ 19. Reply text → Sarvam TTS synthesizes speech         [LATENCY] │
│ 20. Agent speaks response to caller                               │
│ 21. conversation_item_added event fires                           │
│     └─ log_transcript_turn()                           [DB WRITE] │
│         INSERT INTO transcripts (call_id, speaker, text, ts)      │
│                                                                    │
│ If booking requested:                                              │
│ 22. LLM collects name, phone, date/time                          │
│ 23. LLM asks for verbal confirmation                              │
│ 24. Caller confirms → LLM calls book_appointment()               │
│     └─ See PHASE 4a below                                         │
│                                                                    │
├─ PHASE 4a: BOOKING (during conversation) ─────────────────────────┤
│                                                                    │
│ 25. Validate call_id exists                                       │
│ 26. Build Cal.com payload                                         │
│ 27. POST https://api.cal.com/v2/bookings              [API CALL] │
│     └─ 10s timeout                                     [LATENCY] │
│ 28. If success:                                                   │
│     └─ INSERT INTO bookings (call_id, appointment_time,           │
│        status='confirmed', sms_sent=false)             [DB WRITE] │
│     └─ ON CONFLICT upsert                                         │
│     └─ Best-effort UPDATE call_logs.caller_name                   │
│     └─ Return confirmation text to LLM                            │
│ 29. If failure:                                                   │
│     └─ Return soft error text to LLM                              │
│ 30. LLM speaks result to caller                                   │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ PHASE 5: CALL END                                                 │
│                                                                    │
│ 31. Caller hangs up (or LiveKit room closes)                      │
│ 32. Shutdown callback fires: finalize_call()                      │
│                                                                    │
│ Step A: drain_transcript_tasks(timeout=2.0)                       │
│     └─ Wait up to 2s for pending transcript INSERTs               │
│     └─ Cancel any that don't finish                               │
│                                                                    │
│ Step B: complete_call_log()                            [DB WRITE] │
│     └─ Calculate duration = now - started_at                      │
│     └─ Check for confirmed booking                     [DB READ]  │
│     └─ Determine outcome: "booked" or "completed"                 │
│     └─ UPDATE call_logs SET duration, status, outcome             │
│                                                                    │
│ Step C: send_post_call_booking_sms()                              │
│     └─ Query bookings for confirmed + sms_sent=false   [DB READ]  │
│     └─ If found: send_booking_sms()                    [API CALL] │
│         POST https://www.fast2sms.com/dev/bulkV2                  │
│         10s timeout                                                │
│     └─ If sent: UPDATE bookings SET sms_sent=true      [DB WRITE] │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Writes — Where They Happen

| Step | SQL | When |
|------|-----|------|
| 9 | `INSERT INTO call_logs` | Call setup, before pipeline starts |
| 21 | `INSERT INTO transcripts` | Each conversation turn (async task) |
| 28 | `INSERT INTO bookings` (upsert) | During booking tool execution |
| 28 | `UPDATE call_logs SET caller_name` | Best-effort after confirmed booking |
| Step B | `UPDATE call_logs SET duration, status, outcome, summary` | After call ends |
| Step C | `UPDATE bookings SET sms_sent = true` | After successful SMS |

---

## 3. External API Calls — Where They Happen

| Step | API | Timeout | Blocking? |
|------|-----|---------|-----------|
| 27 | Cal.com POST /v2/bookings | 10s | Yes — caller waits during this |
| Step C | Fast2SMS POST /dev/bulkV2 | 10s | No — post-call, caller has hung up |

---

## 4. Where Failures Are Handled

| Failure | Location | Behavior |
|---------|----------|----------|
| Room connection failure | `entrypoint()` line 383 | Exception logged, function returns early, no call log created |
| Config fetch failure | `fetch_active_agent_config()` | Defaults used, call proceeds normally |
| Call log INSERT failure | `create_call_log()` | `call_id=None`, transcripts disabled, call proceeds |
| Agent pipeline start failure | `entrypoint()` line 413 | Call log updated with `status=failed`, `outcome=agent_start_failed`, function returns |
| Transcript INSERT failure | `log_transcript_turn()` | Error logged, call continues |
| Booking API failure | `book_appointment()` | Soft error returned to LLM → spoken to caller |
| Booking DB INSERT failure | `_insert_booking_record()` | Exception propagates → caught by booking tool → soft error to caller |
| Call completion UPDATE failure | `complete_call_log()` | Error logged, SMS step still runs |
| Booking query failure (for SMS) | `send_post_call_booking_sms()` | Error logged, SMS skipped |
| SMS send failure | `send_booking_sms()` | Returns `False`, error logged, `sms_sent` remains `false` |
| SMS mark-sent failure | `send_post_call_booking_sms()` | Error logged, `sms_sent` remains `false` |

---

## 5. Where Latency Can Be Introduced

| Source | Duration | Impact | Mitigatable? |
|--------|----------|--------|:---:|
| Metadata wait | 0.25s fixed | Delays pipeline start | Already minimal |
| Config DB read | ~5-20ms | Before greeting | Negligible |
| LLM greeting generation | ~200-500ms | First spoken words | Could pre-generate |
| STT per turn | ~100-300ms | Per caller utterance | Sarvam-optimized |
| LLM per turn | ~300-800ms | Per agent reply | Short prompts help |
| TTS per turn | ~100-300ms | Per agent reply | Preemptive gen helps |
| Cal.com API | Up to 10s | Dead air during booking | **Filler speech needed** |
| Transcript DB write | ~5-20ms | Async, non-blocking | Already threaded |
| Endpointing delay | 200-1000ms | Turn gap perception | Configurable |

The **critical latency gap** is during Cal.com booking: up to 10 seconds waiting for Cal.com. The prompt now instructs the agent to say "One moment while I book that for you." immediately before calling the booking tool, reducing perceived dead air without adding a second LLM call.

---

## 6. What Happens on Call Abort or Partial Call

### Caller hangs up immediately (no conversation)

1. Shutdown callback fires.
2. `drain_transcript_tasks()` — likely no tasks to drain.
3. `complete_call_log()` — duration = 0 or very small, outcome = `"completed"`.
4. `send_post_call_booking_sms()` — no booking exists, SMS skipped.
5. Result: call_log row with `status="completed"`, `outcome="completed"`, `duration=0`.

### Caller hangs up mid-conversation (no booking)

1. Shutdown callback fires.
2. Pending transcript tasks drained (up to 2s).
3. Call log updated with actual duration, `outcome="completed"`.
4. No booking → SMS skipped.

### Caller hangs up after booking

1. Shutdown callback fires.
2. Transcript tasks drained.
3. Call log updated, `outcome="booked"`.
4. Confirmed booking found → SMS sent → `sms_sent=true`.

### Agent process crashes

1. Supervisor detects exit.
2. No shutdown callback runs (process died).
3. Call log remains with `status="connected"`, `outcome="in_progress"`, `duration=NULL`.
4. Supervisor restarts the worker process (up to 10 retries).

### LiveKit room closes unexpectedly

1. Shutdown callback fires (LiveKit SDK triggers it).
2. Normal finalization runs.

---

## 7. What Happens If Booking Fails

| Failure type | Caller experience | Database state |
|-------------|-------------------|----------------|
| Cal.com rejects (non-200) | Agent says "the calendar service rejected the request" | No booking row created |
| Cal.com timeout (10s) | Agent says a short booking filler first, then explains that the calendar service timed out | No booking row created |
| Cal.com succeeds but DB INSERT fails | Agent sees exception → says "calendar or database error" | Cal.com booking exists but not tracked locally |
| Missing call context | Agent says "missing booking context" | Nothing changes |
| Invalid booking details | Agent says "booking details are incomplete" | Nothing changes |

After any booking failure, the call continues normally. The LLM may attempt to collect details again or offer a callback.

---

## 8. What Happens If SMS Fails

| Failure type | Behavior |
|-------------|----------|
| `FAST2SMS_API_KEY` not set | Error logged, SMS skipped, `sms_sent` stays `false` |
| Fast2SMS timeout (10s) | Error logged, SMS skipped, `sms_sent` stays `false` |
| Fast2SMS HTTP error (≥400) | Error logged, SMS skipped, `sms_sent` stays `false` |
| Fast2SMS returns `{return: false}` | SMS skipped, `sms_sent` stays `false` |
| SMS sent but mark-sent DB fails | SMS delivered, `sms_sent` stays `false` (risk: duplicate on future retry, but no retry mechanism exists) |

SMS failures are invisible to the caller (they already hung up). Failures are visible only in server logs.

---

## 9. Audio Recording

### Current state: NOT IMPLEMENTED

There is no audio recording or storage code in the repository. No LiveKit Egress configuration, no S3 upload, no `recording_url` column in the schema.

Audio recording is a stated business goal (see PLAN.md) but does not exist in the current codebase.
