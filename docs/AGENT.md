# AGENT.md — Voice Agent Runtime Behavior

> **Source file:** `agent.py`
> **Subordinate to:** `/docs/PLAN.md`
> **Last verified against code:** 2026-05-08

---

## 1. What the Agent Is

The voice agent is a Python 3.11 LiveKit Agents worker registered as `inbound-voice-agent`. It connects to LiveKit Cloud via WebSocket, receives inbound SIP calls dispatched by LiveKit's dispatch rules, and runs a real-time voice conversation pipeline: Sarvam STT → OpenAI LLM → Sarvam TTS.

The agent is a single long-running process started by Supervisor inside the Docker container. It handles one call per LiveKit job; LiveKit spawns parallel worker processes for concurrent calls.

---

## 2. How Config Is Loaded

At the start of each call, `fetch_active_agent_config()` queries PostgreSQL:

```sql
SELECT business_name, business_phone, business_timezone, booking_instructions,
       initial_greeting, system_prompt, vad_threshold, language_code,
       mixed_language_enabled, updated_at
FROM agent_config
ORDER BY updated_at DESC NULLS LAST
LIMIT 1
```

The result is coerced into an `AgentConfig` dataclass:

```python
@dataclass(frozen=True)
class AgentConfig:
    business_name: str
    business_phone: str
    business_timezone: str
    booking_instructions: str
    initial_greeting: str
    system_prompt: str
    vad_threshold: float
    language_code: str
    mixed_language_enabled: bool
```

**Fallback behavior:** If the DB query fails or returns no rows, hardcoded defaults are used:
- greeting: `"Hello, thanks for calling. How can I help you today?"`
- system_prompt: `"You are a helpful inbound voice assistant."`
- vad_threshold: `0.5`
- language_code: `"en-IN"`
- mixed_language_enabled: `false`

---

## 3. How Greeting Works

The `InboundAssistant.on_enter()` method is called when the agent pipeline starts and a participant is present:

```python
async def on_enter(self) -> None:
    await self.session.generate_reply(
        instructions=f"Say this greeting exactly, then wait for the caller: {self._greeting!r}"
    )
```

The LLM is instructed to speak the configured greeting verbatim. This means the greeting goes through the LLM (not spoken directly via TTS), which adds a small amount of latency but allows natural voice delivery.

---

## 4. How the System Prompt Is Applied

The system prompt from config is passed as the `instructions` parameter to the `InboundAssistant` (which extends `Agent`). Four policy blocks are appended:

```
[BUSINESS SETTINGS]
Business name: {business_name}.
Callback phone: {business_phone or 'not provided'}.
Business timezone: {business_timezone}.
Booking instructions: {booking_instructions}.

[LANGUAGE POLICY]
(Depends on config — single-language or mixed-language variant)

[RESPONSE POLICY]
Keep replies short, calm, and receptionist-like. Ask one question at a time.
Prefer one concise sentence. Use two short sentences only for appointment
confirmation or booking failure. Never leave dead air.

[BOOKING POLICY]
If the caller wants to book an appointment, collect their name, phone number,
and exact appointment date/time. Verbally repeat those details and ask for
explicit confirmation. Call book_appointment only after the caller confirms.
Immediately before calling book_appointment, say only:
"One moment while I book that for you."
Do not use retrieval or multi-step RAG; rely only on this system prompt and
the caller's current conversation for business context.
```

The combined prompt is set once at call start. It does not change mid-call.

---

## 5. How Language Is Chosen

| Component | Current Value | Source |
|-----------|--------------|--------|
| STT language | `language_code`, or `"unknown"` when mixed-language mode is enabled | `agent_config` |
| TTS target_language_code | `language_code` | `agent_config` |
| TTS speaker | mapped from `language_code` | `agent.py` |

Supported primary language codes are `en-IN`, `hi-IN`, and `kn-IN`. Mixed-language mode keeps one primary TTS language for the call, but lets Sarvam STT auto-detect caller speech with `language="unknown"`.

---

## 6. How STT Is Handled

```python
stt=sarvam.STT(
    language=language_config.stt_language,
    model="saaras:v3",
    mode="transcribe",
    sample_rate=16000,
    flush_signal=True,
)
```

- **Model:** Sarvam `saaras:v3` — optimized for Indian languages and code-mixed speech.
- **Language:** Configured primary language for English, Hindi, or Kannada. Mixed-language mode uses `"unknown"` for auto-detection.
- **Mode:** `"transcribe"` — outputs text in the spoken language. Alternative would be `"translate"` (forces English output).
- **flush_signal:** `True` — required for proper turn detection with Sarvam.
- **Sample rate:** 16000 Hz.

---

## 7. How TTS Is Handled

```python
tts=sarvam.TTS(
    target_language_code=language_config.tts_language_code,
    model="bulbul:v3",
    speaker=language_config.tts_speaker,
    speech_sample_rate=24000,
)
```

- **Model:** Sarvam `bulbul:v3`.
- **Language:** Configured primary language from `agent_config.language_code`.
- **Speaker:** Mapped from language (`en-IN` → `amelia`, `hi-IN` → `kavya`, `kn-IN` → `kavitha`).
- **Sample rate:** 24000 Hz.

### Available speakers (from Sarvam docs)

- **Female:** ritu, priya, neha, pooja, simran, kavya, ishita, shreya, roopa, amelia, sophia, tanya, shruti, suhani, kavitha, rupali
- **Male:** shubh, aditya, rahul, rohan, amit, dev, ratan, varun, manan, sumit, kabir, aayan, anand, tarun, sunny, mani, gokul, vijay, mohit, rehan, soham

### Available language codes

| Language | Code |
|----------|------|
| English (India) | `en-IN` |
| Hindi | `hi-IN` |
| Kannada | `kn-IN` |
| Auto-detect (STT only) | `unknown` |

---

## 8. How VAD / Turn Detection Works

```python
vad=silero.VAD.load(
    min_speech_duration=0.04,
    min_silence_duration=0.35,
    prefix_padding_duration=0.25,
    max_buffered_speech=12.0,
    activation_threshold=vad_threshold,
    sample_rate=16000,
),
allow_interruptions=True,
min_interruption_duration=0.3,
min_endpointing_delay=0.15,
max_endpointing_delay=0.8,
false_interruption_timeout=1.0,
preemptive_generation=True,
```

- **VAD model:** Silero — lightweight voice activity detection.
- **Threshold:** Loaded from `agent_config.vad_threshold` (default 0.5). Clamped to the practical 0.3–0.7 telephony range by `_clamp_vad_threshold()`. Set `ALLOW_FULL_VAD_RANGE=true` only for emergency full-range override.
- **Interruptions:** Enabled — caller can interrupt the agent mid-speech.
- **Endpointing:** 150ms minimum, 800ms maximum — determines how long to wait after speech stops before triggering a turn.
- **Preemptive generation:** Enabled — LLM starts generating before the turn is fully complete, reducing perceived latency.
- **False interruption timeout:** 1.0s — if an interruption lasts shorter than this, it's treated as background noise.

### Risk

- Values near 0.0 cause excessive interruptions (agent thinks silence = speech).
- Values near 1.0 cause missed barge-ins (agent doesn't detect caller trying to interrupt).
- The practical optimal range for Silero in noisy telephony is approximately 0.3–0.7.

---

## 9. How the Booking Tool Is Invoked

The `book_appointment` function from `tools.py` is registered as an LLM function tool on `InboundAssistant`:

```python
super().__init__(instructions=..., tools=[book_appointment])
```

The LLM decides when to call the tool based on the system prompt + booking policy. The tool requires:
- `name` — confirmed caller name
- `phone` — confirmed phone number
- `date_time` — confirmed appointment datetime in ISO 8601

The tool's description explicitly instructs the LLM: "Never call this tool while proposing options or before explicit confirmation."

The tool returns a string that the LLM reads back to the caller.

See `/docs/BOOKING.md` for full booking flow details.

---

## 10. How Transcript Saving Works

Transcripts are saved turn-by-turn during the call via an event handler:

1. `_attach_transcript_logging(session, call_id)` hooks the `"conversation_item_added"` event.
2. Each event with `role` of `"user"` or `"assistant"` triggers `log_transcript_turn()`.
3. The insert is wrapped in `asyncio.to_thread()` to avoid blocking the event loop.
4. The task is tracked in `TRANSCRIPT_TASKS` set for draining at shutdown.

```sql
INSERT INTO transcripts (call_id, speaker, text, timestamp)
VALUES (%s, %s, %s, %s)
```

If the DB insert fails, the error is logged but the call continues.

If `call_id` is `None` (because the initial call_log insert failed), transcript persistence is disabled for that call with a warning log.

---

## 11. How Summary Saving Works

### Current state: IMPLEMENTED

The `call_logs` table has a `summary` column. After each call ends, `complete_call_log()` calls `_build_call_summary()` to generate a rule-based summary:

```python
def _build_call_summary(outcome: str | None, duration: int) -> str:
    if outcome == "booked":
        return f"Booked appointment during a {duration}s call."
    if outcome == "agent_start_failed":
        return "Agent failed to start; call did not complete normally."
    return f"Call completed without a confirmed booking in {duration}s."
```

This is a deterministic, zero-latency summary. It does not use LLM summarization (which would add cost and latency). The CRM detail page also builds a `transcriptSummary` by concatenating raw transcript turns for quick operator review.

---

## 12. How Call End Handling Works

A shutdown callback is registered after the agent pipeline starts:

```python
ctx.add_shutdown_callback(
    lambda: finalize_call(
        call_id, call_started_at, caller_phone,
        business_name=config.business_name,
        business_phone=config.business_phone,
    )
)
```

`finalize_call()` runs in sequence:

1. **`drain_transcript_tasks(timeout=2.0)`** — waits up to 2 seconds for pending transcript inserts. Cancels any that don't finish.
2. **`complete_call_log(call_id, started_at)`** — calculates duration, determines outcome (`"booked"` if confirmed booking exists, `"completed"` otherwise), generates a rule-based summary, and updates:
   ```sql
   UPDATE call_logs SET duration = %s, status = %s, outcome = %s, summary = %s WHERE id = %s
   ```
3. **`send_post_call_booking_sms(call_id, caller_phone, business_name, business_phone)`** — checks for confirmed booking with `sms_sent=false`, atomically claims the booking, sends SMS via Fast2SMS, records the result in `notification_events`, and releases the claim on failure.

### Failure path

If the agent pipeline fails to start (`agent.start(ctx)` throws), the call log is immediately updated with `status="failed"`, `outcome="agent_start_failed"`, and the shutdown callback is not registered.

---

## 13. How Soft Failure Responses Work

The system uses soft, caller-friendly language for all error conditions:

| Failure | Response to caller |
|---------|-------------------|
| Missing call context for booking | "I cannot complete the booking right now because this call is missing booking context." |
| Invalid booking details | "I could not book that appointment because the booking details are incomplete: {error}" |
| Cal.com rejects booking | "I could not complete the booking because the calendar service rejected the request." |
| Cal.com timeout | "I could not complete the booking because the calendar service timed out." |
| General booking error | "I could not complete the booking due to a calendar or database error." |
| Config fetch failure | Falls back to defaults silently — caller hears default greeting |
| Transcript DB failure | Logged, call continues normally |
| Call log creation failure | Call proceeds without persistence |

---

## 14. Implementation Status

### Fully implemented
- Config loading with DB fallback
- Greeting via LLM-spoken exact text
- System prompt with booking policy injection
- STT via Sarvam with configured language hint, or auto-detect in mixed-language mode
- TTS via Sarvam with configured primary language and mapped speaker
- VAD via Silero with configurable threshold
- Booking tool invocation with verbal confirmation
- Turn-by-turn transcript persistence
- Call log creation and completion
- Shutdown callback with transcript drain + call completion + SMS
- Soft failure responses for all booking errors

### Partially implemented
- **Mixed-language handling:** Uses STT auto-detect and one configured primary TTS language per call; it does not dynamically switch TTS language every sentence.
- **VAD threshold validation:** Runtime clamps to 0.3–0.7 by default, with `ALLOW_FULL_VAD_RANGE=true` as an emergency override.
- **Transcript drain timeout:** 2 seconds may not be enough for slow DB connections.

### Missing
- Audio recording / storage (by design — no LiveKit recording integration yet)

### Implemented since initial writing (Parts 11–15)
- Call summary generation (`_build_call_summary` in `complete_call_log`)
- Health endpoint (`/api/health` in Next.js)
- SIGTERM graceful shutdown (`ctx.add_shutdown_callback` → `finalize_call`)
- Environment variable validation at startup (`validate_startup_environment()`)
- Caller name persistence to call_logs (`_persist_booking_caller_details` in `tools.py`)
- Structured JSON logging (`log_event()`)
- Secret redaction in error logs (`_redact_secret_values()`)
- SMS audit trail (`notification_events` table)
- Configurable session duration (`DASHBOARD_SESSION_MAX_AGE`)
- Logout endpoint (`POST /api/logout`)

### Must not be changed lightly
- `entrypoint()` function structure — it's the core lifecycle coordinator.
- Shutdown callback registration order (drain → complete → SMS).
- Booking tool's verbal confirmation requirement.
- Transcript event hook mechanism.
- The `asyncio.to_thread()` pattern for DB writes (prevents blocking the audio event loop).
