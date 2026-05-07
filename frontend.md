# Frontend Plan: Next.js Dashboard

## Overview

The frontend is a clean, minimal Next.js dashboard for monitoring inbound AI calls, reviewing CRM records, tracking appointments, and editing the voice agent configuration.

The UI should feel similar to Vapi or Retell dashboards: spacious, operational, fast, neutral, and focused on call outcomes.

## Suggested App Structure

```text
frontend/
  app/
    layout.tsx
    page.tsx
    dashboard/
      page.tsx
    crm/
      page.tsx
      [callerId]/
        page.tsx
    calendar/
      page.tsx
    agent-config/
      page.tsx
    login/
      page.tsx
    api/
      analytics/
        route.ts
      callers/
        route.ts
      appointments/
        route.ts
      agent-config/
        route.ts
  components/
    analytics/
    crm/
    calendar/
    agent-config/
    layout/
    ui/
  lib/
    supabase/
    auth/
    formatting/
  middleware.ts
```

## Dashboard

**Purpose:** Show high-level call and booking performance.

**Primary widgets:**
- Total Calls
- Booking Rate
- Average Call Duration
- Confirmed Bookings
- Failed or Missed Calls

**Charts:**
- Call volume by day or hour
- Booking success rate over time
- Average duration trend
- Call outcomes breakdown

**Filters:**
- Date range
- Call status
- Booking status
- Phone number search

**Data sources:**
- Call records table
- Booking records table
- Transcript summary metadata

**UX requirements:**
- Cards should be readable at a glance.
- Empty states should explain what data will appear after calls begin.
- Loading states should be subtle and non-disruptive.

## CRM

**Purpose:** Provide a searchable log of all inbound callers and their conversation history.

**Caller table columns:**
- Phone number
- Caller name, if collected
- Last call timestamp
- Call count
- Last call status
- Booking status
- Short AI-generated summary

**Caller detail view:**
- Full caller profile
- Timeline of calls
- Transcript viewer
- Call summary
- Booking details
- SMS notification status

**Transcript requirements:**
- Show speaker labels for caller and agent.
- Preserve turn order and timestamps.
- Make long transcripts readable with a clean scroll area.

**Search and filtering:**
- Search by phone number
- Search by caller name
- Filter by booking status
- Filter by latest call outcome

## Calendar / Appointment Tracker

**Purpose:** Track all appointments created by the AI voice agent.

**Appointment table columns:**
- Appointment date and time
- Caller name
- Caller phone number
- Booking status
- Cal.com booking ID
- Source call ID
- SMS sent status

**Views:**
- Upcoming appointments
- Past appointments
- Failed booking attempts
- Cancelled or rescheduled appointments, if supported later

**UX requirements:**
- Operators should be able to quickly identify upcoming bookings.
- Each appointment should link back to the originating call and transcript.

## Agent Config

**Purpose:** Let operators update AI behavior without code changes.

**Editable fields:**
- `initial_greeting`
- `system_prompt`
- `vad_threshold`

**Field behavior:**
- `initial_greeting` should be a concise first message spoken to callers.
- `system_prompt` should define role, business rules, tone, booking rules, and escalation behavior.
- `vad_threshold` should be numeric and validated before saving.

**Recommended validation:**
- Greeting cannot be empty.
- System prompt cannot be empty.
- VAD threshold must stay within the supported runtime range.
- Show a confirmation state after saving.

**Persistence:**
- Save configuration to self-hosted Supabase.
- Load the latest active configuration for every new inbound call.
- Keep timestamps for configuration changes.

## Authentication

**Rule:** Protect the dashboard with a single password from `DASHBOARD_PASSWORD`.

**Suggested flow:**
- Show a login page when no valid dashboard session exists.
- Compare the submitted password against the server-side environment variable.
- Store a secure HTTP-only session cookie after successful login.
- Gate all dashboard, CRM, calendar, and agent configuration routes.

## Styling Direction

**Aesthetic:**
- Clean
- Minimal
- Neutral
- Professional
- Vapi/Retell-inspired

**Recommended UI traits:**
- Soft gray backgrounds
- White cards
- Thin borders
- Clear typography hierarchy
- Compact but readable tables
- Subtle hover states
- No unnecessary visual noise
