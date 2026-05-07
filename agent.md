# Core AI Instructions

## Mission

This repository is for a professional inbound AI voice platform that answers calls, conducts natural voice conversations, books appointments, sends post-booking SMS confirmations, and exposes a clean operator dashboard.

Future coding sessions must follow the constraints in this file unless the project owner explicitly changes them.

## Stack Rules

**Frontend:**
- Use Next.js for the dashboard UI.
- Do not replace the dashboard with another frontend framework.
- Use server-side routes or server components for privileged operations.
- Keep browser-exposed code free of service role credentials.

**Backend:**
- Use Python 3.11 for the voice agent and call orchestration layer.
- Use LiveKit Agents for inbound call handling.
- Use OpenAI for LLM reasoning.
- Use Sarvam AI for STT/TTS where applicable.

**Runtime:**
- Deploy with Docker on Easypanel.
- Use Supervisor when one container must run both Python and Next.js processes.
- Treat port `8000` as the public UI port unless deployment configuration changes.

## Database Rules

**Plain PostgreSQL only:**
- Always target the Easypanel-managed PostgreSQL database.
- Route database traffic through the internal Docker service name using `DATABASE_URL`.
- Prefer internal service DNS in production, such as `postgresql://postgres:<password>@voice-agent-db:5432/postgres`.
- Percent-encode special characters in the password before placing it in `DATABASE_URL`; for example, `@` must be written as `%40`.
- Do not use Supabase SDKs or Supabase service-role routing for application persistence.

**Credential handling:**
- Use `DATABASE_URL` only in trusted backend/server-side code.
- Never expose database credentials in the Next.js client bundle.
- Do not commit production database passwords to source control.

**Agent configuration:**
- The `agent_config` table manages `initial_greeting`, `system_prompt`, `vad_threshold`, and `language_code`.
- Use `language_code` to support English, Hindi, and Kannada voice behavior, with `en-IN` as the default unless the operator chooses another supported language.

## SMS Rules

**Provider:**
- Use Fast2SMS as the only SMS provider.

**Allowed SMS trigger:**
- Send SMS notifications only after a booking is confirmed.
- Do not send SMS for generic missed calls, incomplete calls, abandoned calls, or non-booking conversations unless the owner changes this rule.

**Operational requirements:**
- Store the Fast2SMS API key in `FAST2SMS_API_KEY`.
- Prevent duplicate SMS sends for the same booking.
- Persist provider responses and failures for auditability.

## UI Design Rules

**Visual direction:**
- Follow a clean/minimal Vapi/Retell-style dashboard aesthetic.
- Prefer generous spacing, neutral backgrounds, subtle borders, restrained shadows, and clear typography.
- Avoid loud gradients, cluttered widgets, and decorative UI that does not improve operator workflow.

**Dashboard priorities:**
- Make analytics scannable.
- Make caller history searchable.
- Make transcripts and summaries easy to review.
- Make agent configuration safe and simple for non-technical users.

## Security Rules

**Dashboard access:**
- Protect the dashboard using one environment variable: `DASHBOARD_PASSWORD`.
- Do not introduce multi-user authentication unless explicitly requested.
- Do not hardcode the password in source code.

**Secrets:**
- Keep API keys in environment variables.
- Do not commit production secrets to documentation, examples, frontend code, or logs.
- Treat LiveKit, OpenAI, Sarvam, Cal.com, Fast2SMS, and Supabase service role keys as sensitive.

## Voice Agent Behavior Rules

**Dynamic configuration:**
- Load `initial_greeting`, `system_prompt`, and `vad_threshold` from persistent configuration.
- Apply updated configuration to new calls without requiring code changes.

**Call lifecycle:**
- Create a call record when an inbound call starts.
- Persist transcript and summary when available.
- Persist booking outcomes.
- Trigger Fast2SMS only after confirmed booking completion.

### Latency & RAG Policy

- STRICT RULE: Do NOT implement multi-step LLM routing, Agentic RAG, or "Vectorless/Tree" RAG. It adds multi-second latency which kills voice naturalness.
- Prefer injecting business context directly into the `system_prompt`.
- If RAG is absolutely required for massive datasets, ONLY use single-step traditional Vector RAG via Supabase `pgvector`.

## Change Discipline

**Do not change unrelated logic:**
- Avoid touching existing Python voice logic unless the task explicitly requires it.
- Avoid broad rewrites.
- Prefer small, verifiable changes tied to the requested feature.

**Deployment target:**
- Optimize infrastructure decisions for Easypanel on a KVM2 VPS.
