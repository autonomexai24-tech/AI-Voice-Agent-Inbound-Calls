# 10-Part Master Roadmap: Professional Inbound AI Voice Platform

## Part 1: Containerization

**Goal:** Package the inbound voice worker and dashboard into a single Easypanel-ready container.

**Scope:**
- Use `python:3.11-slim` as the final runtime base.
- Use a multi-stage Docker build with separate dependency stages for Python and Next.js.
- Configure the Next.js app with `output: "standalone"` in `next.config.js` so the dashboard can survive within the KVM2 VPS memory limits.
- Use Supervisor as the container process manager.
- Run the Python LiveKit worker and the dashboard process side-by-side.
- Expose port `8000` as the public dashboard/UI port for Easypanel.

**Execution steps:**
- Keep Python voice runtime isolated under `/app`.
- Build the Next.js dashboard during the Node build stage using standalone output.
- Copy only the built frontend assets and Python dependencies into the final image.
- Run the dashboard with `node server.js` from `.next/standalone` instead of `npm start` to reduce RAM usage and avoid VPS OOM crashes.
- Start both services through Supervisor with restart policies.
- Configure Easypanel to route public HTTP traffic to container port `8000`.

**Acceptance criteria:**
- The container starts with Supervisor as PID 1.
- The dashboard is reachable on port `8000`.
- The LiveKit worker starts automatically and restarts on failure.
- No Python or Next.js dev server is required in production.

## Part 2: Database Layer

**Goal:** Connect the platform to self-hosted Supabase through internal VPS routing.

**Scope:**
- Use Supabase self-hosted Kong as the single database API gateway.
- Route application traffic through `SUPABASE_SELF_HOSTED_URL`.
- Use `SUPABASE_SERVICE_ROLE_KEY` only on trusted backend/server code.
- Maintain SQL schemas for call logs, transcripts, bookings, SMS status, and agent configuration.

**Execution steps:**
- CRITICAL MANUAL STEP: Manually execute `schema.sql` in the self-hosted Supabase Studio SQL Editor before launching the dashboard or voice worker. The self-hosted environment blocks automated REST-based DDL execution, so tables and seed rows must be created through SQL Editor access.
- Configure `SUPABASE_SELF_HOSTED_URL` with the internal Kong URI, such as `http://supabase-kong:8000` inside the VPS network.
- Store `SUPABASE_SERVICE_ROLE_KEY` in Easypanel environment variables.
- Store `SUPABASE_ANON_KEY` for browser-safe read/write operations only where appropriate.
- Create tables for inbound calls, caller profiles, booking records, transcripts, agent settings, and notification events.
- Add indexes on phone number, call start time, booking status, and created timestamp.

**Acceptance criteria:**
- Backend writes call events to Supabase through the internal Kong route.
- Dashboard reads analytics and CRM data from Supabase.
- Service role credentials are never exposed in client-side bundles.

## Part 3: Inbound Orchestration

**Goal:** Receive inbound SIP calls through LiveKit Cloud and route them into the Python agent worker.

**Scope:**
- Configure LiveKit Cloud SIP trunking.
- Register the Python worker as the call orchestration entry point.
- Create a deterministic lifecycle for call start, conversation, booking, call end, and post-call actions.

**Execution steps:**
- Connect the SIP provider to LiveKit Cloud.
- Configure inbound dispatch rules for the business phone number.
- Start the Python LiveKit worker from the container.
- Load agent settings from Supabase at call start.
- Persist call metadata when a call enters the system.
- Persist final transcript, summary, duration, outcome, and booking state after the call ends.

**Acceptance criteria:**
- Inbound calls reliably create LiveKit sessions.
- Each call gets a unique call record in Supabase.
- Failed call sessions are logged with actionable error information.

## Part 4: AI Voice Brain

**Goal:** Build a responsive multilingual AI voice agent using OpenAI for reasoning and Sarvam AI for speech.

**Scope:**
- Use OpenAI as the LLM layer.
- Use Sarvam AI for STT/TTS where supported.
- Use configurable VAD sensitivity for interruption handling and turn detection.
- Load `initial_greeting`, `system_prompt`, and `vad_threshold` dynamically from dashboard configuration.

**Execution steps:**
- Define the agent persona and business rules in the system prompt.
- Convert caller speech to text through Sarvam STT.
- Send structured conversation state to OpenAI.
- Generate voice replies through Sarvam TTS.
- Tune VAD threshold for noisy inbound call environments.
- Store transcript turns with speaker, timestamp, confidence, and final text.

**Acceptance criteria:**
- Agent greets callers consistently.
- Agent follows dashboard-configured instructions.
- VAD settings can be adjusted without code deployment.
- Conversation transcripts are persisted after every call.

## Part 5: Tooling

**Goal:** Enable live appointment booking during natural conversation.

**Scope:**
- Integrate Cal.com as the booking system.
- Allow the AI agent to check availability, propose slots, and create bookings.
- Persist booking details in Supabase.

**Execution steps:**
- Configure Cal.com API credentials as environment variables.
- Define booking tool inputs for caller name, phone number, desired time, appointment type, and notes.
- Validate caller confirmation before final booking creation.
- Write booking ID, time, status, and metadata to Supabase.
- Return booking confirmation details to the voice agent for spoken confirmation.

**Acceptance criteria:**
- Agent can book appointments during a live call.
- Every booking is linked to a call record and caller phone number.
- Booking failures are explained gracefully to the caller.

## Part 6: SMS Notification

**Goal:** Send Fast2SMS confirmation messages only after successful booking completion.

**Scope:**
- Use Fast2SMS strictly for post-booking notifications.
- Send booking details after the call ends or after booking finalization.
- Track notification status in Supabase.

**Execution steps:**
- Store `FAST2SMS_API_KEY` in Easypanel environment variables.
- Trigger SMS only when a booking record has confirmed status.
- Include appointment date, time, business name, and callback number in the message.
- Persist SMS request status, provider response, and failure reason.
- Prevent duplicate SMS sends for the same booking.

**Acceptance criteria:**
- SMS is never sent for non-booking calls.
- SMS is sent once per confirmed booking.
- Failed SMS attempts are visible in the dashboard or logs.

## Part 7: Next.js Dashboard

**Goal:** Build a clean analytics dashboard for business operators.

**Scope:**
- Use Next.js for the web UI.
- Configure `next.config.js` with `output: "standalone"` for production Docker deployment.
- Follow a clean/minimal Vapi/Retell-style visual system.
- Show operational call and booking metrics.

**Execution steps:**
- Create analytics cards for Total Calls, Booking Rate, Average Duration, and Missed/Failed Calls.
- Add charts for call volume and booking success over time.
- Add filters for date range, call status, and booking outcome.
- Fetch analytics from Supabase through secure server-side routes where needed.

**Acceptance criteria:**
- Dashboard loads quickly on Easypanel.
- Metrics match Supabase call and booking data.
- UI is simple, spacious, and professional.

## Part 8: Next.js CRM & Calendar

**Goal:** Provide a working caller log and appointment tracking interface.

**Scope:**
- Build CRM tables for inbound callers.
- Build appointment tracker views for booked calls.
- Surface summaries and transcripts for review.

**Execution steps:**
- Create a caller log table with phone number, caller name, last call time, status, and summary.
- Add a detail drawer/page for transcript and call outcome.
- Create an appointment tracker with time, caller, booking status, and source call.
- Add search by phone number and caller name.

**Acceptance criteria:**
- Operators can find callers quickly.
- Operators can review call summaries and transcripts.
- Operators can see all upcoming and historical bookings.

## Part 9: UI Configuration

**Goal:** Allow non-technical operators to control agent behavior safely.

**Scope:**
- Build configuration pages for `initial_greeting`, `system_prompt`, and `vad_threshold`.
- Store configuration in Supabase.
- Apply configuration dynamically to new calls.

**Execution steps:**
- Create an Agent Config page in the dashboard.
- Add form fields for greeting, system prompt, and VAD sensitivity.
- Validate VAD threshold ranges before saving.
- Save configuration changes with timestamps.
- Load latest active configuration when a new inbound call starts.

**Acceptance criteria:**
- Operators can edit agent behavior without deployment.
- Invalid VAD settings are blocked.
- New calls use the latest saved configuration.

## Part 10: Security & Launch

**Goal:** Secure the dashboard and deploy the platform to Easypanel on the KVM2 VPS.

**Scope:**
- Protect the dashboard with a single password stored in `DASHBOARD_PASSWORD`.
- Keep service role keys server-side only.
- Deploy with Easypanel-managed environment variables.
- Verify inbound calls, dashboard access, database writes, and SMS notifications.

**Execution steps:**
- Add password protection middleware or server-side auth gate for dashboard routes.
- Store `DASHBOARD_PASSWORD`, Supabase keys, LiveKit keys, OpenAI keys, Sarvam keys, Cal.com keys, and Fast2SMS key in Easypanel.
- Build and deploy the Docker image through Easypanel.
- Configure public domain and TLS.
- Run launch tests for inbound call handling, booking, SMS, dashboard analytics, and CRM visibility.

**Acceptance criteria:**
- Dashboard is inaccessible without the configured password.
- Production secrets are not committed to source control.
- Platform can receive calls, book appointments, send SMS, and display analytics.
