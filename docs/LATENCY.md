# LATENCY.md — Voice Latency Rules and Bottlenecks

> **Subordinate to:** `/docs/PLAN.md`
> **Last verified against code:** 2026-05-08

---

## 1. Core Principle

**Short and fast responses matter most.** The platform answers real phone calls. Every added millisecond of silence feels unnatural to the caller. Perceived latency is the single most important quality metric for voice.

---

## 2. Why Multi-Step Routing Is Avoided

Multi-step LLM routing means: classifier → router → specialist agent → response. Each step adds 200-800ms of LLM inference time. For a 3-step chain, the caller waits 1-3 seconds of dead air before hearing anything.

**This project uses one LLM call per turn.** The system prompt carries all business context. The LLM generates a direct response. No planner, no classifier, no routing layer.

---

## 3. Why RAG Is Avoided

Retrieval-Augmented Generation adds:
- Vector embedding call (~50-200ms)
- Database similarity search (~20-100ms)
- Context injection into prompt (larger prompt → slower LLM)
- For agentic RAG: multiple retrieval rounds

For a small business (dental clinic), all necessary context fits in the system prompt. RAG is unnecessary overhead.

**Rule:** If RAG is ever required for massive datasets, use only single-step traditional vector RAG. Never agentic or multi-step retrieval.

---

## 4. Current Latency Sources

### 4.1 STT — Sarvam saaras:v3

- **Expected latency:** 100-300ms per utterance.
- **Config:** configured language hint, or `language="unknown"` in mixed-language mode; `sample_rate=16000`, `flush_signal=True`.
- **Optimization:** `flush_signal=True` enables speech start/end events, allowing faster turn detection.
- **Risk:** Auto-detect mode may add slight overhead compared to specifying a language. For calls where language is known, setting an explicit language hint could reduce STT time marginally.

### 4.2 LLM — OpenAI GPT-4o

- **Expected latency:** 300-800ms for short responses, longer for complex reasoning.
- **Config:** `model="gpt-4o"`, `temperature=0.2`, `max_completion_tokens=160`.
- **Token limit:** 160 tokens ≈ 2-3 short sentences. This keeps responses concise but may truncate complex booking confirmations mid-sentence.
- **Optimization:** Low temperature (0.2) produces deterministic, faster responses. Preemptive generation is enabled (LLM starts before STT fully endpoints).
- **Risk:** Streaming is handled by the LiveKit SDK. If the LLM generates a long response before the 160-token cutoff, the TTS starts speaking before the full response is ready (good for perceived latency).

### 4.3 TTS — Sarvam bulbul:v3

- **Expected latency:** 100-300ms for first audio chunk.
- **Config:** `speech_sample_rate=24000`, configured speaker, configured `target_language_code`.
- **Optimization:** Sarvam supports streaming TTS. The LiveKit SDK starts playing audio as soon as the first chunk arrives, not after the full response is synthesized.

### 4.4 Booking API — Cal.com

- **Expected latency:** 500ms-3s typical, up to 10s timeout.
- **Config:** `httpx.AsyncClient(timeout=10.0)`.
- **Impact:** This is the **worst latency source** in the system. During the booking API call, the caller hears silence.
- **Current state:** The prompt instructs the agent to say "One moment while I book that for you." immediately before calling `book_appointment`.
- **Remaining risk:** This relies on the existing single LLM/tool-call path. No pre-tool hook or second orchestration step is used.

### 4.5 Database Writes

- **Expected latency:** 5-20ms per query (internal Docker network).
- **Pattern:** All DB writes during a call use `asyncio.to_thread()` to avoid blocking the audio event loop.
- **Impact:** Negligible. Transcript writes are fire-and-forget async tasks.

### 4.6 Endpointing Delays

- **Config:** `min_endpointing_delay=0.2`, `max_endpointing_delay=1.0`.
- **Impact:** After the caller stops speaking, the system waits 200ms-1000ms before deciding the turn is complete. This is the gap between "caller finishes talking" and "agent starts responding."
- **Trade-off:** Too short → agent interrupts caller mid-sentence. Too long → awkward pause.
- **Current values:** Tuned for quicker response start while preserving a 200ms minimum pause tolerance for Indian-accent and mixed-language telephony.

### 4.7 Metadata Wait

- **Config:** `asyncio.sleep(0.25)` after room connect.
- **Impact:** 250ms fixed delay before config fetch + call log creation.
- **Reason:** SIP metadata can arrive slightly after room join. This delay ensures phone number extraction works.

### 4.8 VAD Threshold

- **Config:** From `agent_config.vad_threshold`, clamped to 0.3-0.7 by default. `ALLOW_FULL_VAD_RANGE=true` restores the broader 0.0-1.0 clamp for emergency testing.
- **Impact on latency:** Affects perceived responsiveness.
  - Low threshold (< 0.3): Agent detects speech too eagerly → interrupts caller → caller repeats → net slower.
  - High threshold (> 0.7): Agent misses barge-in attempts → caller waits for agent to finish → net slower.
  - Optimal range: ~0.3-0.7 for noisy telephony.
- **Current validation:** Dashboard and runtime use the practical 0.3-0.7 range by default.

---

## 5. Latency Budget — Per Turn

| Step | Expected | Notes |
|------|----------|-------|
| Caller speaks | Variable | Depends on utterance length |
| STT transcription | 100-300ms | Sarvam auto-detect |
| Endpointing | 200-1000ms | Waiting for turn completion |
| LLM inference | 300-800ms | GPT-4o with 160 token limit |
| TTS first chunk | 100-300ms | Sarvam streaming |
| **Total silence gap** | **~700-2600ms** | **Between caller stop and agent start** |

For most turns, the caller experiences 1-2 seconds of silence. This is acceptable for phone conversations. The preemptive generation feature reduces this by starting LLM inference before endpointing is fully complete.

---

## 6. Safe Ways to Keep the System Feeling Instant

### Already implemented

- **Preemptive generation:** LLM starts generating before the turn is fully endpointed.
- **Allow interruptions:** Caller can interrupt the agent mid-speech, preventing long monologues.
- **Low temperature:** 0.2 produces faster, more deterministic LLM responses.
- **Short token limit:** 160 tokens prevents long-winded answers.
- **Async DB writes:** Transcript inserts don't block audio.
- **Streaming TTS:** First audio chunk plays before full response is synthesized.

### Implemented latency safeguards

- **Booking filler speech:** Agent is instructed to say "One moment while I book that for you." before the Cal.com API call.
- **Language hint in STT:** Setting explicit language (when known) instead of `"unknown"` may reduce STT overhead.
- **VAD practical range clamping:** Operators are kept in the 0.3-0.7 range; emergency full-range testing requires `ALLOW_FULL_VAD_RANGE=true`.

### Must never be implemented

- Multi-step LLM routing.
- Agentic RAG or chained retrieval.
- Classifier → router → specialist-agent flows.
- Multiple LLM calls per turn.
- Synchronous DB writes on the audio event loop.

---

## 7. How to Use Short Prompts and Short Replies

### System prompt

The system prompt should be:
- Under ~500 tokens for fast LLM processing.
- Focused on persona, business rules, and booking instructions.
- Free of lengthy FAQs or documentation (put those in a knowledge base only if RAG is approved).

### LLM replies

The `max_completion_tokens=160` limit enforces short replies. The booking policy in the system prompt instructs: "Keep responses brief, natural, and focused on helping the caller."

**Risk:** 160 tokens may truncate a booking confirmation that includes name + date + time + address. If truncation is observed, the limit could be raised to 200-250 without significant latency impact.

---

## 8. How to Handle Booking Pauses

### Current state

During the Cal.com API call (step 27 in CALL_FLOW.md), the prompt now tells the agent to speak one short filler sentence before invoking the booking tool. The caller may still wait for the Cal.com result after that filler.

### Current approach

Before calling the booking API, the agent should speak filler:

```
"One moment while I book that for you."
```

This uses the existing single LLM path. It avoids fake availability claims, extra LLM calls, and pre-tool orchestration.
