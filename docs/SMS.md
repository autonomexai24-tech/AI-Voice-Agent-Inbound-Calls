# SMS.md — SMS Notification Behavior

> **Source files:** `notifications.py`, `agent.py` (send_post_call_booking_sms)
> **Subordinate to:** `/docs/PLAN.md`
> **Last verified against code:** 2026-05-08

---

## 1. Provider

**Fast2SMS only.** No other SMS provider is active in the codebase.

- **Endpoint:** `POST https://www.fast2sms.com/dev/bulkV2`
- **Auth:** `authorization` header with `FAST2SMS_API_KEY` environment variable.
- **Payload format:**
  ```json
  {
      "route": "q",
      "message": "Your appointment with {business_name} is confirmed for {details}. For help or changes, call {callback_number}. Thank you.",
      "language": "english",
      "flash": "0",
      "numbers": "9876543210"
  }
  ```
- **Route:** `"q"` — Fast2SMS quick/queue route. The exact behavior depends on the Fast2SMS account configuration and plan.
- **Timeout:** 10 seconds (`httpx.AsyncClient`).
- **Region:** Fast2SMS is India-only. Non-Indian phone numbers will fail.

---

## 2. SMS Only After Confirmed Booking

SMS is triggered exclusively in the post-call shutdown callback. The sequence:

1. Call ends → `finalize_call()` fires.
2. `send_post_call_booking_sms(call_id, caller_phone)` runs.
3. Atomically claim one unsent confirmed booking for this call:
   ```sql
   UPDATE bookings
   SET sms_sent = true
   WHERE call_id = %s
     AND status = 'confirmed'
     AND sms_sent = false
   RETURNING call_id, appointment_time, status, sms_sent
   ```
4. If no row is returned → SMS skipped.
5. If a row is returned → proceed to send.
6. If send fails → record failure and release `sms_sent` back to `false` for manual or future retry.

**SMS is never sent for:**
- Missed calls
- Incomplete calls
- Abandoned calls
- General inquiries
- Failed bookings
- Non-booking conversations

---

## 3. SMS Timing

SMS is sent **immediately after the call ends**, as part of the `finalize_call()` shutdown callback sequence:

```
drain_transcript_tasks() → complete_call_log() → send_post_call_booking_sms()
```

The SMS step runs after the call log is updated. The caller has already hung up by this point. SMS delivery latency is invisible to the caller.

---

## 4. Duplicate Prevention

Two layers of duplicate prevention:

### Layer 1: Booking status check

```sql
WHERE call_id = %s AND status = 'confirmed'
```

Only confirmed bookings trigger SMS. If the booking was never created or is in a different status, SMS is skipped.

### Layer 2: atomic sms_sent claim

```python
UPDATE bookings
SET sms_sent = true
WHERE call_id = %s
  AND status = 'confirmed'
  AND sms_sent = false
RETURNING call_id, appointment_time, status, sms_sent
```

Only one caller can claim an unsent confirmed booking. If a repeated shutdown callback runs, the second claim returns no row and SMS is skipped.

### After successful send

The booking is already marked `sms_sent=true` by the atomic claim. A successful Fast2SMS response leaves that flag set.

### After failed send

The failed attempt is recorded in `notification_events`, then the booking claim is released:

```sql
UPDATE bookings
SET sms_sent = false
WHERE call_id = %s AND status = 'confirmed'
```

There is no automatic retry loop. Releasing the claim keeps the booking eligible for a deliberate future retry.

---

## 5. Provider Response Logging

```python
logger.info("[FAST2SMS] Request finished ... provider_response=%s", provider_response)
```

The provider response from Fast2SMS is logged to stdout after every send attempt, whether successful or not. This includes:
- The JSON response body (if parseable).
- The raw text (if not parseable as JSON).
- The HTTP status code and request duration.

Error conditions are logged at ERROR level:
- Timeout: `[FAST2SMS] Request timed out phone_last4={last4}`
- HTTP error: `[FAST2SMS] HTTP {status_code}`
- Request failure: `[FAST2SMS] Request failed phone_last4={last4} error={error}`
- Missing API key: `[FAST2SMS] FAST2SMS_API_KEY is not configured`

---

## 6. Failure Logging and Audit Trail

All failures are logged to stdout/stderr via Python's `logging` module. Every attempted booking-confirmation SMS is also recorded in `notification_events`.

| Failure | Logged? | Visible in dashboard? |
|---------|:-------:|:---------------------:|
| API key missing | Yes (ERROR) | Stored as failed notification event |
| Request timeout | Yes (ERROR) | Stored as failed notification event |
| HTTP error (≥400) | Yes (ERROR) | Stored as failed notification event |
| Fast2SMS returns `{return: false}` | Yes | Stored as failed notification event |
| General exception | Yes (ERROR) | Stored as failed notification event |
| Success | Yes (INFO) | Stored as sent notification event and `bookings.sms_sent=true` |

---

## 7. What Happens When SMS Send Fails

1. `send_booking_sms()` returns `False`.
2. `send_post_call_booking_sms()` logs: `[SMS] Fast2SMS send failed for call_id={call_id}`.
3. `sms_sent` is released back to `false` in the bookings table.
4. No retry is attempted.
5. The failed attempt is stored in `notification_events`.
6. The call log is already updated (SMS runs after call completion). The call is not affected.

### Manual recovery

An operator would need to:
1. Check server logs for `[FAST2SMS]` or `[SMS]` error entries.
2. Identify the affected booking via `call_id`.
3. Manually send the SMS or trigger a re-send (no tooling exists for this).

---

## 8. Fields and Tables Used for SMS Tracking

### bookings table

| Column | SMS-related usage |
|--------|------------------|
| `call_id` | Identifies which booking to check |
| `appointment_time` | Included in SMS message body |
| `status` | Must be `"confirmed"` for SMS to trigger |
| `sms_sent` | `false` -> eligible for SMS; `true` -> claimed/sent |

### notification_events table

| Column | SMS-related usage |
|--------|------------------|
| `call_id` | Links the notification attempt to the call and booking |
| `channel` | Always `sms` for Fast2SMS confirmation messages |
| `provider` | Always `fast2sms` |
| `event_type` | `booking_confirmation` |
| `status` | `sent` or `failed` |
| `provider_response` | Truncated Fast2SMS response body |
| `error_message` | Failure reason, if any |

### SMS message content

```python
message = f"Your appointment with {business_name} is confirmed for {details}."
if callback_number:
    message += f" For help or changes, call {callback_number}."
message += " Thank you."
```

Where `details` is formatted from `appointment_time`:
- If parseable as ISO 8601: formatted as `"Wednesday, 15 January 2026 at 03:00 PM"`
- If not parseable: falls back to `"your confirmed appointment"`

`business_name` and `callback_number` come from the active `agent_config` row used by the call. If callback number is blank, that sentence is omitted.

---

## 9. Implementation Status

### Fully implemented
- Fast2SMS integration with Bearer auth
- Post-call-only trigger (shutdown callback)
- Confirmed-booking-only filter
- Duplicate prevention via `sms_sent` flag
- Provider response logging
- Database audit trail through `notification_events`
- Timeout handling (10s)
- HTTP error handling
- Graceful failure (never crashes the call lifecycle)
- Business name and callback number in SMS content

### Not implemented
- Localized SMS content
- Dashboard visibility of SMS failures
- Retry mechanism for failed sends
- SMS status beyond boolean `sms_sent`
- WhatsApp notifications (roadmap only, archived `archive-docs/legacy-runtime/notify.py` exists but is orphaned)

### What the code does NOT do (confirmed by inspection)
- Does not send SMS for non-booking calls.
- Does not send SMS during a call.
- Does not send SMS for missed or abandoned calls.
- Does not use Telegram or WhatsApp for booking notifications (`archive-docs/legacy-runtime/notify.py` is not imported by any active code).
