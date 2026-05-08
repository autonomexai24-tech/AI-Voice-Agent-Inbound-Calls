# LOGIC.md — Global Operating Logic

> **Purpose:** Strict system behavior rules for the inbound AI voice platform.
> **Authority:** Subordinate to `/docs/PLAN.md`; overrides archived legacy docs.
> **Default preset:** Dental clinic, formal receptionist, short and fast responses, English + Hindi + Kannada + mixed-language support.

---

## 1. Voice Behavior Rules

1. The agent is a formal receptionist, not a casual chatbot.
2. Replies must be short, natural, and phone-friendly.
3. Ask one question at a time.
4. Do not give long explanations unless the caller explicitly asks.
5. Do not guess unclear names, dates, times, symptoms, or booking preferences.
6. If unsure, ask again politely.
7. Use softer fallback responses when something fails.
8. Keep the caller moving toward a useful outcome: booking, information, or clear next step.
9. Avoid robotic phrases like "as an AI" or "I am unable to".
10. Do not claim that a booking, SMS, or callback is complete unless the system has actually completed it.

---

## 2. Multilingual Rules

1. Supported operating languages are English, Hindi, Kannada, and mixed-language speech.
2. The default language is `en-IN` unless the operator configures another supported language.
3. The runtime must use `agent_config.language_code` once Part 11 is implemented.
4. Until language wiring is complete, the system must treat language behavior as partially working.
5. The caller's language should be respected when possible.
6. Mixed-language calls should remain natural; do not force translation unless needed for clarity.
7. If the caller switches language, the agent may continue in the caller's apparent preferred language.
8. For unclear multilingual input, ask the caller to repeat in a simple, polite way.
9. Do not hardcode TTS to one language after Part 11.
10. Language settings must never require a code deployment once dashboard configuration is wired.

---

## 3. Latency Rules

1. Low latency is more important than elaborate reasoning.
2. Use one direct LLM response path per turn.
3. Do not add multi-step LLM routing.
4. Do not add agentic RAG, Vectorless RAG, Tree RAG, or chained retrieval.
5. Keep business context in `system_prompt`.
6. If retrieval is unavoidable later, use only single-step traditional vector RAG and only after explicit approval.
7. The agent should use short filler speech before slow external actions, especially booking checks.
8. Avoid long prompts that slow down every turn.
9. Avoid long spoken answers that create poor caller experience.
10. Tune VAD and endpointing conservatively; do not optimize one test call at the cost of noisy real calls.

---

## 4. Booking Rules

1. The booking flow is: ask preference → confirm verbally → book directly (no pre-check). Cal.com may reject unavailable slots.
2. The agent must collect enough information before booking: caller identity, phone number, desired appointment time, and appointment intent where needed.
3. The agent must verbally confirm booking details before creating the booking.
4. The agent must not book speculatively.
5. Cal.com is the booking system.
6. A booking must be linked to the call record.
7. Booking failure must be explained softly and briefly.
8. If a booking fails (e.g., Cal.com rejects the slot), ask for another preference or offer a callback-style fallback if configured.
9. Do not use Google Calendar or MCP as the primary booking path.
10. Do not silently change the caller's requested time.

---

## 5. SMS Rules

1. Fast2SMS is the only active SMS provider.
2. SMS is sent only after confirmed booking completion.
3. Never send SMS for missed calls, incomplete calls, abandoned calls, or general inquiries.
4. Never send duplicate SMS for the same booking.
5. SMS sending should happen after booking finalization, not as a replacement for spoken confirmation.
6. SMS failures must not break the completed call record.
7. SMS provider errors should be logged and later stored in `notification_events` once implemented.
8. Do not expose Fast2SMS credentials in frontend code or docs.
9. Do not add WhatsApp sending in the current production flow.
10. WhatsApp remains roadmap-only until explicitly promoted in PLAN.md.

---

## 6. Operator UI Rules

1. The dashboard is for operators, not developers.
2. UI style must remain light, minimal, clean, and professional.
3. Use a Vapi/Retell-like operational dashboard feel.
4. Prioritize quick scanning over dense configuration.
5. Primary metrics are total calls, booking rate, missed calls, average duration, language usage, peak call hours, and repeat callers.
6. CRM must help operators find callers quickly.
7. Calendar must help operators see upcoming and historical appointments quickly.
8. Agent Config must be safe for non-technical users.
9. Do not expose raw secrets, database URLs, service role keys, or internal stack traces.
10. Empty states must truthfully explain what will appear after real calls exist.

---

## 7. Dashboard Truthfulness Rules

1. Dashboard labels must match the actual backend architecture.
2. Do not mention Supabase in active UI unless active code uses Supabase for that specific function.
3. Do not show fake analytics.
4. Do not show placeholder data as real data.
5. Every metric must be traceable to PostgreSQL data.
6. If a metric is not implemented, show an honest empty/missing state or omit it.
7. Call status must reflect persisted call status.
8. Booking status must reflect persisted booking status.
9. SMS status must reflect persisted SMS state.
10. If data may be incomplete, the UI should communicate that safely rather than overclaiming.

---

## 8. Safe Failure Rules

1. When STT is unclear, ask the caller to repeat.
2. When LLM output is uncertain, ask a clarifying question.
3. When booking fails, apologize briefly and ask for another time or explain that the clinic will follow up if configured.
4. When SMS fails, do not tell the caller it was sent.
5. When database writes fail, log clearly and preserve the live call if possible.
6. When external APIs timeout, use soft caller-facing language.
7. Do not expose technical errors to callers.
8. Do not fabricate availability, booking IDs, SMS status, or clinic policies.
9. Prefer a safe fallback over a confident wrong answer.
10. Runtime failures must be diagnosable from logs.

---

## 9. Prompt-First Architecture Rules

1. Business identity, tone, services, FAQs, booking preferences, and clinic-specific policies belong in `system_prompt`.
2. The dashboard should allow safe editing of prompt-driven behavior.
3. The code should remain business-neutral where practical.
4. Do not create dental-only hardcoded branches unless absolutely necessary.
5. Other business types should be supported later by changing prompts and presets.
6. Keep the default preset dental clinic until PLAN.md changes it.
7. Do not add a multi-business tenant model in the current stage.
8. Future multi-business support must be a planned roadmap item, not incidental drift.
9. Prompt changes must not expose secrets or internal architecture.
10. Prompt content must keep responses short and booking-focused.

---

## 10. No-RAG / No-Multi-Step-Routing Rule

1. Do not implement multi-step routing.
2. Do not implement agentic RAG.
3. Do not implement Vectorless RAG.
4. Do not implement Tree RAG.
5. Do not add a planner model before the response model.
6. Do not add classifier → router → specialist-agent flows for normal calls.
7. Do not call multiple LLMs per caller turn unless explicitly approved for a narrow reason.
8. Do not use retrieval for small business context that fits in the prompt.
9. If large retrieval is required later, use a single retrieval step and inject only the needed context.
10. Any exception must be documented in PLAN.md before implementation.

---

## 11. Data and Persistence Rules

1. PostgreSQL is the system of record.
2. Use `DATABASE_URL` only in backend/server-side code.
3. Do not use Supabase SDKs for active application persistence.
4. Transcripts should be persisted with speaker, text, call_id, and timestamp.
5. Call logs should preserve phone number, start time, duration, status, and outcome.
6. Bookings should preserve appointment time, status, call_id, and SMS sent state.
7. Agent configuration should preserve greeting, system prompt, VAD threshold, language code, and updated timestamp.
8. Audio recording storage is preferred but not fully implemented yet.
9. Schema changes must be reflected in docs and dashboard queries.
10. Do not store production secrets in the database unless explicitly required and encrypted.

---

## 12. Change Discipline

1. Preserve the working production system.
2. Do not change runtime code during documentation cleanup stages.
3. Avoid broad rewrites.
4. Make targeted changes tied to the current roadmap part.
5. Keep docs synchronized with implementation.
6. Archive stale docs instead of leaving conflicting active docs.
7. Test before claiming completion.
8. Do not introduce new providers without updating PLAN.md.
9. Do not change deployment target away from Docker + Easypanel without explicit approval.
10. If a file is legacy but harmless, document it before deleting it.
