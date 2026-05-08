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
SELECT initial_greeting, system_prompt, vad_threshold, language_code,
       mixed_language_enabled, updated_at
FROM agent_config
ORDER BY updated_at DESC NULLS LAST
LIMIT 1
```

The result is coerced into an `AgentConfig` dataclass:

```python
@dataclass(frozen=True)
class AgentConfig:
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

The system prompt from config is passed as the `instructions` parameter to the `InboundAssistant` (which extends `Agent`). A hardcoded **booking policy** is appended:

```
[RESPONSE POLICY]
Keep replies short, calm, and receptionist-like. Ask one question at a time.
Prefer one concise sentence unless confirming appointment details or explaining a booking failure.

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
    activation_threshold=vad_threshold,
    sample_rate=16000,
),
allow_interruptions=True,
min_endpointing_delay=0.2,
max_endpointing_delay=1.0,
preemptive_generation=True,
```

- **VAD model:** Silero — lightweight voice activity detection.
- **Threshold:** Loaded from `agent_config.vad_threshold` (default 0.5). Clamped to the practical 0.3–0.7 telephony range by `_clamp_vad_threshold()`. Set `ALLOW_FULL_VAD_RANGE=true` only for emergency full-range override.
- **Interruptions:** Enabled — caller can interrupt the agent mid-speech.
- **Endpointing:** 200ms minimum, 1000ms maximum — determines how long to wait after speech stops before triggering a turn.
- **Preemptive generation:** Enabled — LLM starts generating before the turn is fully complete, reducing perceived latency.

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

### Current state: NOT IMPLEMENTED

There is no summary generation or storage. The `call_logs` table has no `summary` column. The dashboard CRM page builds a `transcriptSummary` by concatenating raw transcript turns (capped at 180 chars), but this is not a semantic summary.

### What is needed later

- Add `summary` column to `call_logs`.
- Generate summary after call ends (post-call, not blocking conversation).
- Options: use LLM to summarize transcript, or store a simple outcome description.

---

## 12. How Call End Handling Works

A shutdown callback is registered after the agent pipeline starts:

```python
ctx.add_shutdown_callback(lambda: finalize_call(call_id, call_started_at, caller_phone))
```

`finalize_call()` runs in sequence:

1. **`drain_transcript_tasks(timeout=2.0)`** — waits up to 2 seconds for pending transcript inserts. Cancels any that don't finish.
2. **`complete_call_log(call_id, started_at)`** — calculates duration, determines outcome (`"booked"` if confirmed booking exists, `"completed"` otherwise), and updates:
   ```sql
   UPDATE call_logs SET duration = %s, status = %s, outcome = %s WHERE id = %s
   ```
3. **`send_post_call_booking_sms(call_id, caller_phone)`** — checks for confirmed booking with `sms_sent=false`, sends SMS via Fast2SMS, marks `sms_sent=true`.

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
- Call summary generation
- Audio recording / storage
- Health endpoint
- SIGTERM graceful shutdown
- Environment variable validation at startup
- Caller name persistence to call_logs

### Must not be changed lightly
- `entrypoint()` function structure — it's the core lifecycle coordinator.
- Shutdown callback registration order (drain → complete → SMS).
- Booking tool's verbal confirmation requirement.
- Transcript event hook mechanism.
- The `asyncio.to_thread()` pattern for DB writes (prevents blocking the audio event loop).
