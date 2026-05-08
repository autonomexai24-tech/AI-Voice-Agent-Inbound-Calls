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
      "message": "Your appointment is confirmed for {details}. Thank you.",
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
3. Query: does a confirmed booking exist for this call?
   ```sql
   SELECT call_id, appointment_time, status, sms_sent
   FROM bookings
   WHERE call_id = %s AND status = 'confirmed'
   LIMIT 1
   ```
4. If no confirmed booking → SMS skipped.
5. If `sms_sent` is already `true` → SMS skipped (duplicate prevention).
6. If confirmed + not yet sent → proceed to send.

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

### Layer 2: sms_sent flag check

```python
if not booking or booking.get("sms_sent"):
    # SMS skipped
    return
```

If `sms_sent` is `true`, SMS is skipped even if the booking is confirmed.

### After successful send

```sql
UPDATE bookings SET sms_sent = true WHERE call_id = %s
```

This marks the booking as SMS-delivered.

### Edge case: mark-sent failure

If the SMS is sent successfully but the `UPDATE bookings SET sms_sent = true` fails (DB error), the `sms_sent` flag remains `false`. There is no retry mechanism in the current code, so a duplicate SMS would only occur if the same call's shutdown callback were somehow re-executed (which doesn't happen in normal operation).

---

## 5. Provider Response Logging

```python
logger.info("[FAST2SMS] Response payload: %s", response_payload)
```

The full response payload from Fast2SMS is logged to stdout after every send attempt, whether successful or not. This includes:
- The JSON response body (if parseable).
- The raw text (if not parseable as JSON).

Error conditions are logged at ERROR level:
- Timeout: `[FAST2SMS] Request timed out for phone={phone}`
- HTTP error: `[FAST2SMS] HTTP {status_code} for phone={phone}`
- Request failure: `[FAST2SMS] Request failed for phone={phone}: {error}`
- Missing API key: `[FAST2SMS] FAST2SMS_API_KEY is not configured`

---

## 6. Failure Logging

All failures are logged to stdout/stderr via Python's `logging` module. There is **no database table** for SMS event tracking.

| Failure | Logged? | Visible in dashboard? |
|---------|:-------:|:---------------------:|
| API key missing | Yes (ERROR) | No |
| Request timeout | Yes (ERROR) | No |
| HTTP error (≥400) | Yes (ERROR) | No |
| Fast2SMS returns `{return: false}` | Yes (implicit) | No |
| General exception | Yes (ERROR) | No |
| Success | Yes (INFO) | Only via `sms_sent` column |

---

## 7. What Happens When SMS Send Fails

1. `send_booking_sms()` returns `False`.
2. `send_post_call_booking_sms()` logs: `[SMS] Fast2SMS send failed for call_id={call_id}`.
3. `sms_sent` remains `false` in the bookings table.
4. No retry is attempted.
5. The failure is not visible in the dashboard (no notification_events table, no SMS status column beyond `sms_sent`).
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
| `sms_sent` | `false` → eligible for SMS; `true` → already sent |

### SMS message content

```python
message = f"Your appointment is confirmed for {details}. Thank you."
```

Where `details` is formatted from `appointment_time`:
- If parseable as ISO 8601: formatted as `"Wednesday, 15 January 2026 at 03:00 PM"`
- If not parseable: falls back to `"your confirmed appointment"`

The message is hardcoded. There is no customization from the dashboard, no business name, and no callback number in the message.

---

## 9. Implementation Status

### Fully implemented
- Fast2SMS integration with Bearer auth
- Post-call-only trigger (shutdown callback)
- Confirmed-booking-only filter
- Duplicate prevention via `sms_sent` flag
- Provider response logging
- Timeout handling (10s)
- HTTP error handling
- Graceful failure (never crashes the call lifecycle)

### Not implemented
- `notification_events` database table for SMS audit trail
- SMS content customization (business name, callback number, language)
- Dashboard visibility of SMS failures
- Retry mechanism for failed sends
- SMS status beyond boolean `sms_sent`
- Localized SMS messages (currently English only)
- WhatsApp notifications (roadmap only, `notify.py` exists but is orphaned)

### What the code does NOT do (confirmed by inspection)
- Does not send SMS for non-booking calls.
- Does not send SMS during a call.
- Does not send SMS for missed or abandoned calls.
- Does not use Telegram or WhatsApp for booking notifications (`notify.py` is not imported by any active code).
