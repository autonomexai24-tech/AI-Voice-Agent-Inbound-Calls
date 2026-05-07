import logging
import os
import asyncio
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Annotated, Any

import httpx
from livekit.agents import llm

import db


logger = logging.getLogger("agent-tools")

_current_call_id: ContextVar[str | None] = ContextVar("current_call_id", default=None)
_active_call_id: str | None = None


def set_booking_call_context(call_id: str | None) -> None:
    global _active_call_id
    _active_call_id = call_id
    _current_call_id.set(call_id)


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _event_type_id() -> int:
    raw_value = (
        os.environ.get("CALCOM_EVENT_TYPE_ID")
        or os.environ.get("CAL_EVENT_TYPE_ID")
        or ""
    ).strip()
    if not raw_value:
        raise RuntimeError("Missing required environment variable: CALCOM_EVENT_TYPE_ID")
    try:
        return int(raw_value)
    except ValueError as exc:
        raise RuntimeError("CALCOM_EVENT_TYPE_ID must be an integer") from exc


def _normalize_datetime(date_time: str) -> str:
    value = date_time.strip()
    if not value:
        raise ValueError("date_time is required")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


def _booking_payload(name: str, phone: str, date_time: str) -> dict[str, Any]:
    clean_phone = phone.replace("+", "").replace(" ", "").replace("-", "")
    return {
        "eventTypeId": _event_type_id(),
        "start": _normalize_datetime(date_time),
        "attendee": {
            "name": name,
            "email": f"{clean_phone or 'caller'}@voiceagent.placeholder",
            "phoneNumber": phone,
            "timeZone": "Asia/Kolkata",
            "language": "en",
        },
        "bookingFieldsResponses": {
            "notes": f"Booked during inbound AI voice call. Phone: {phone}",
        },
    }


async def _insert_booking_record(call_id: str, appointment_time: str) -> None:
    await asyncio.to_thread(
        lambda: db.get_supabase()
        .table("bookings")
        .insert(
            {
                "call_id": call_id,
                "appointment_time": appointment_time,
                "status": "confirmed",
                "sms_sent": False,
            }
        )
        .execute()
    )


@llm.function_tool(
    description=(
        "Create a Cal.com appointment only after the caller has verbally confirmed "
        "the exact name, phone number, and appointment date/time. Never call this "
        "tool while proposing options or before explicit confirmation."
    )
)
async def book_appointment(
    name: Annotated[str, "Confirmed caller name"],
    phone: Annotated[str, "Confirmed caller phone number"],
    date_time: Annotated[str, "Confirmed appointment datetime in ISO 8601 format"],
) -> str:
    call_id = _current_call_id.get() or _active_call_id
    if not call_id:
        logger.error("[BOOKING] Missing call context; refusing to create booking")
        return "I cannot complete the booking right now because this call is missing booking context."

    try:
        payload = _booking_payload(name=name, phone=phone, date_time=date_time)
        api_key = _required_env("CALCOM_API_KEY")
    except Exception as exc:
        logger.error("[BOOKING] Invalid booking request: %s", exc)
        return f"I could not book that appointment because the booking details are incomplete: {exc}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://api.cal.com/v2/bookings",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "cal-api-version": "2024-08-13",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if response.status_code not in (200, 201):
            logger.error("[BOOKING] Cal.com failed %s: %s", response.status_code, response.text)
            return "I could not complete the booking because the calendar service rejected the request."

        appointment_time = payload["start"]
        await _insert_booking_record(call_id=call_id, appointment_time=appointment_time)
        booking_id = response.json().get("data", {}).get("uid", "confirmed")
        logger.info("[BOOKING] Confirmed booking call_id=%s booking_id=%s", call_id, booking_id)
        return (
            f"Booking confirmed for {name} at {appointment_time}. "
            "Please tell the caller their appointment is confirmed."
        )
    except httpx.TimeoutException:
        logger.error("[BOOKING] Cal.com request timed out")
        return "I could not complete the booking because the calendar service timed out."
    except Exception as exc:
        logger.error("[BOOKING] Booking failed: %s", exc)
        return "I could not complete the booking due to a calendar or database error."
