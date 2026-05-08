import logging
import os
import asyncio
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
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


def _slot_search_window(date_time: str) -> tuple[str, str]:
    requested = datetime.fromisoformat(date_time.replace("Z", "+00:00"))
    if requested.tzinfo is None:
        requested = requested.replace(tzinfo=timezone.utc)
    requested_utc = requested.astimezone(timezone.utc)
    return (
        (requested_utc - timedelta(hours=12)).isoformat().replace("+00:00", "Z"),
        (requested_utc + timedelta(hours=12)).isoformat().replace("+00:00", "Z"),
    )


def _slot_matches(slot: Any, requested_start: str) -> bool:
    if isinstance(slot, str):
        candidate = slot
    elif isinstance(slot, dict):
        candidate = str(slot.get("start") or slot.get("slotStart") or "")
    else:
        candidate = ""

    if not candidate:
        return False

    requested = datetime.fromisoformat(requested_start.replace("Z", "+00:00")).astimezone(timezone.utc)
    available = datetime.fromisoformat(candidate.replace("Z", "+00:00")).astimezone(timezone.utc)
    return abs((available - requested).total_seconds()) <= 60


async def _check_calcom_availability(client: httpx.AsyncClient, api_key: str, appointment_time: str) -> bool:
    start, end = _slot_search_window(appointment_time)
    response = await client.get(
        "https://api.cal.com/v2/slots",
        headers={
            "Authorization": f"Bearer {api_key}",
            "cal-api-version": "2024-09-04",
        },
        params={
            "eventTypeId": _event_type_id(),
            "start": start,
            "end": end,
            "timeZone": "Asia/Kolkata",
            "format": "range",
        },
    )
    if response.status_code >= 400:
        logger.error("[BOOKING] Cal.com availability failed %s: %s", response.status_code, response.text)
        return False

    data = response.json().get("data", {})
    if not isinstance(data, dict):
        return False

    return any(_slot_matches(slot, appointment_time) for slots in data.values() for slot in (slots or []))


async def _insert_booking_record(call_id: str, appointment_time: str) -> None:
    await asyncio.to_thread(
        lambda: db.execute(
            """
            insert into bookings (call_id, appointment_time, status, sms_sent)
            values (%s, %s, %s, %s)
            on conflict (call_id) do update
            set appointment_time = excluded.appointment_time,
                status = excluded.status,
                sms_sent = excluded.sms_sent
            """,
            (call_id, appointment_time, "confirmed", False),
        )
    )


async def _persist_caller_name(call_id: str, name: str) -> None:
    clean_name = name.strip()
    if not clean_name:
        return

    try:
        await asyncio.to_thread(
            lambda: db.execute(
                """
                update call_logs
                set caller_name = %s
                where id = %s
                """,
                (clean_name, call_id),
            )
        )
    except Exception as exc:
        logger.error("[BOOKING] Failed to persist caller_name for call_id=%s: %s", call_id, exc)


@llm.function_tool(
    description=(
        "Create a Cal.com appointment only after the caller has verbally confirmed "
        "the exact name, phone number, and appointment date/time. Never call this "
        "tool while proposing options or before explicit confirmation. Immediately "
        'before calling this tool, tell the caller: "One moment while I book that for you."'
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
            available = await _check_calcom_availability(client, api_key, payload["start"])
            if not available:
                logger.info("[BOOKING] Requested slot unavailable call_id=%s start=%s", call_id, payload["start"])
                return "That time does not appear to be available. Please share another preferred time."

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
        await _persist_caller_name(call_id=call_id, name=name)
        booking_id = response.json().get("data", {}).get("uid", "confirmed")
        logger.info("[BOOKING] Confirmed booking call_id=%s booking_id=%s", call_id, booking_id)
        return f"Your appointment is confirmed for {appointment_time}. Thank you, {name}."
    except httpx.TimeoutException:
        logger.error("[BOOKING] Cal.com request timed out")
        return "I could not complete the booking because the calendar service timed out."
    except Exception as exc:
        logger.error("[BOOKING] Booking failed: %s", exc)
        return "I could not complete the booking due to a calendar or database error."
