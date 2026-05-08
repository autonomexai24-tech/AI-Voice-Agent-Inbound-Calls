# BOOKING.md — Booking Behavior

> **Source files:** `tools.py`, `agent.py` (booking policy + finalize_call), `calendar_tools.py` (legacy, not active)
> **Subordinate to:** `/docs/PLAN.md`
> **Last verified against code:** 2026-05-08

---

## 1. Cal.com Integration

The booking system uses Cal.com API v2.

- **Endpoint:** `POST https://api.cal.com/v2/bookings`
- **Auth:** Bearer token via `CALCOM_API_KEY` environment variable.
- **API version header:** `cal-api-version: 2024-08-13`
- **Timeout:** 10 seconds (`httpx.AsyncClient`).
- **Event type:** Numeric `CALCOM_EVENT_TYPE_ID` environment variable (also accepts legacy `CAL_EVENT_TYPE_ID` as fallback).

---

## 2. When Booking Is Allowed

Booking is allowed during a live inbound call, triggered by the LLM when the caller explicitly requests an appointment.

The booking tool's description instructs the LLM:

> "Create a Cal.com appointment only after the caller has verbally confirmed the exact name, phone number, and appointment date/time. Never call this tool while proposing options or before explicit confirmation."

Additionally, the system prompt includes a booking policy:

> "If the caller wants to book an appointment, collect their name, phone number, and exact appointment date/time. Verbally repeat those details and ask for explicit confirmation. Call book_appointment only after the caller confirms."

---

## 3. Required Caller Confirmation

The LLM must:
1. Collect the caller's name.
2. Collect (or confirm) the phone number.
3. Collect the preferred appointment date and time.
4. Repeat all details back to the caller.
5. Wait for explicit verbal confirmation.
6. Only then call `book_appointment()`.

This is enforced via prompt instructions and tool description, not via code validation. The LLM could technically call the tool without full confirmation, but the strong prompt instructions make this unlikely.

---

## 4. Preferred Date/Time Flow

The intended flow:

1. **Caller expresses interest** — "I'd like to book an appointment."
2. **Agent asks for preference** — "What date and time would work for you?"
3. **Caller states preference** — "Tomorrow at 3 PM."
4. **Agent confirms details** — "I have [name] at [phone] for [date/time]. Shall I go ahead and book?"
5. **Caller confirms** — "Yes."
6. **Agent books** — `book_appointment()` tool is called.

### Current limitation

There is **no availability check** before booking. The agent collects a preferred time and sends it directly to Cal.com. If the slot is unavailable, Cal.com rejects the booking, and the agent speaks a soft error.

The `calendar_tools.py` file contains a `get_available_slots()` function that can check Cal.com availability, but it is **not wired** into the active booking tool in `tools.py` and is not imported by `agent.py`.

---

## 5. Availability Check Flow

### Current state: NOT IMPLEMENTED in the active path

The active booking tool (`tools.py:book_appointment`) does not check availability before attempting to book. It sends the caller's requested time directly to Cal.com.

### What exists but is inactive

`calendar_tools.py` contains:
- `get_available_slots(date_str)` — fetches open slots from Cal.com v1 API or Google Calendar.
- `async_create_booking()` — duplicate booking path (Cal.com v2 or Google Calendar).
- `cancel_booking()` — Cal.com v1 cancellation.

This file is **not imported** by `agent.py` or `tools.py`. It uses different environment variable names in some paths (`CAL_API_KEY` vs. `CALCOM_API_KEY`) and references Google Calendar which is not part of the current architecture.

### Recommended future approach

If availability checking is added:
1. Add a separate LLM tool `check_availability(date)` that calls Cal.com slots API.
2. The agent asks for a date, checks slots, presents available times, then books.
3. This adds one additional API call (~500ms-2s) but prevents booking failures.

---

## 6. Booking Creation Flow

When `book_appointment(name, phone, date_time)` is called:

### Step 1: Validate context

```python
call_id = _current_call_id.get() or _active_call_id
```

If `call_id` is `None`, the tool returns a soft error: "missing booking context."

### Step 2: Build payload

```python
{
    "eventTypeId": CALCOM_EVENT_TYPE_ID (integer),
    "start": ISO 8601 datetime (normalized),
    "attendee": {
        "name": caller name,
        "email": "{phone}@voiceagent.placeholder",
        "phoneNumber": caller phone,
        "timeZone": "Asia/Kolkata",
        "language": "en"
    },
    "bookingFieldsResponses": {
        "notes": "Booked during inbound AI voice call. Phone: {phone}"
    }
}
```

- **Email:** Generated placeholder from phone number. Cal.com requires an email; callers typically don't provide one.
- **Timezone:** Hardcoded to `Asia/Kolkata` (IST).
- **Datetime normalization:** `_normalize_datetime()` parses ISO 8601, handles `Z` suffix, adds UTC timezone if missing.

### Step 3: Call Cal.com API

```python
POST https://api.cal.com/v2/bookings
Authorization: Bearer {CALCOM_API_KEY}
cal-api-version: 2024-08-13
Content-Type: application/json
```

10-second timeout. Success = HTTP 200 or 201.

### Step 4: Insert booking record

```sql
INSERT INTO bookings (call_id, appointment_time, status, sms_sent)
VALUES (%s, %s, 'confirmed', false)
ON CONFLICT (call_id) DO UPDATE
SET appointment_time = EXCLUDED.appointment_time,
    status = EXCLUDED.status,
    sms_sent = EXCLUDED.sms_sent
```

The `ON CONFLICT` upsert ensures only one booking per call. If the tool is called again in the same call (e.g., rebooking after a change), the previous booking is overwritten.

### Step 5: Return confirmation

```
"Booking confirmed for {name} at {appointment_time}. Please tell the caller their appointment is confirmed."
```

The LLM reads this text back to the caller in natural speech.

---

## 7. How Booking Gets Linked to the Call

- `call_id` is set at the start of the call via `set_booking_call_context(call_id)`.
- It is stored in both a `ContextVar` and a global `_active_call_id`.
- When `book_appointment()` runs, it reads the `call_id` from either source.
- The `bookings.call_id` column is a foreign key to `call_logs.id`.
- At call end, `complete_call_log()` checks for a confirmed booking to determine `outcome="booked"`.

---

## 8. How Booking Is Stored in PostgreSQL

Table: `bookings`

| Column | Type | Value on insert |
|--------|------|----------------|
| `call_id` | uuid (PK, FK) | From call context |
| `appointment_time` | timestamptz | From Cal.com payload `start` field |
| `status` | text | Always `"confirmed"` |
| `sms_sent` | boolean | Always `false` (updated after SMS) |

---

## 9. How Booking Failures Are Spoken Back

| Failure | Message returned to LLM |
|---------|------------------------|
| Missing call context | "I cannot complete the booking right now because this call is missing booking context." |
| Invalid/missing details | "I could not book that appointment because the booking details are incomplete: {error}" |
| Cal.com rejection (non-200) | "I could not complete the booking because the calendar service rejected the request." |
| Cal.com timeout | "I could not complete the booking because the calendar service timed out." |
| DB or general error | "I could not complete the booking due to a calendar or database error." |

All messages are soft, caller-friendly, and avoid technical jargon. The LLM paraphrases them naturally when speaking to the caller.

---

## 10. Manual Callback / Alternate Fallback

### Current state: NOT IMPLEMENTED as a structured fallback

There is no explicit "manual callback" mechanism in the code. If a booking fails:
1. The agent speaks a soft error.
2. The LLM may naturally offer to try again or suggest the caller call back.
3. The call continues; the caller can try a different time.

### Recommended future approach

Add a fallback instruction to the system prompt:

```
If the booking fails, offer to have the clinic call the patient back to schedule manually.
Do not repeatedly attempt to book if the first attempt fails.
```

This keeps the fallback prompt-driven without requiring new code.

---

## 11. Implementation Status

### Fully implemented
- Cal.com v2 booking creation during live call
- Bearer token authentication
- Payload construction with attendee details
- DateTime normalization (ISO 8601)
- Booking record persistence with upsert
- Soft error messages for all failure types
- Call-to-booking linkage via call_id
- Verbal confirmation requirement (via prompt)
- Duplicate booking prevention (ON CONFLICT)

### Not implemented
- Availability check before booking
- Booking filler speech during API call
- Booking cancellation from dashboard
- Caller name persistence to call_logs
- Manual callback fallback (structured)
- Multiple bookings per call (schema enforces one)
- Booking confirmation SMS content customization
