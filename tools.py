import logging
import os
import asyncio
from time import perf_counter
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Annotated, Any

import httpx
from livekit.agents import llm

import db


logger = logging.getLogger("agent-tools")

_current_call_id: ContextVar[str | None] = ContextVar("current_call_id", default=None)
_active_call_id: str | None = None
BOOKING_PREFLIGHT_FILLER = "One moment while I book that for you."
BOOKING_LATENCY_WARNING_MS = 2000
CALCOM_TIMEOUT = httpx.Timeout(4.0, connect=1.0, read=2.5, write=2.0, pool=1.0)
DEFAULT_CALCOM_API_VERSION = "2026-02-25"


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


def _calcom_api_version() -> str:
    return os.environ.get("CALCOM_API_VERSION", DEFAULT_CALCOM_API_VERSION).strip() or DEFAULT_CALCOM_API_VERSION


def _normalize_datetime(date_time: str) -> str:
    value = date_time.strip()
    if not value:
        raise ValueError("date_time is required")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    utc_value = parsed.astimezone(timezone.utc).isoformat()
    return utc_value.replace("+00:00", "Z")


def _clean_phone_number(phone: str) -> str:
    return phone.replace("+", "").replace(" ", "").replace("-", "").strip()


def _coerce_confirmation(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "confirmed", "caller confirmed"}
    return bool(value)


def _booking_payload(name: str, phone: str, date_time: str) -> dict[str, Any]:
    clean_name = name.strip()
    clean_phone = _clean_phone_number(phone)
    if not clean_name:
        raise ValueError("caller name is required")
    if not clean_phone:
        raise ValueError("caller phone number is required")

    return {
        "eventTypeId": _event_type_id(),
        "start": _normalize_datetime(date_time),
        "attendee": {
            "name": clean_name,
            "email": f"{clean_phone or 'caller'}@voice-caller.invalid",
            "phoneNumber": phone.strip(),
            "timeZone": "Asia/Kolkata",
            "language": "en",
        },
        "bookingFieldsResponses": {
            "notes": f"Booked during inbound AI voice call. Phone: {phone}",
        },
    }


async def _insert_booking_record(call_id: str, appointment_time: str, name: str, phone: str) -> None:
    clean_name = name.strip()
    clean_phone = phone.strip()
    await asyncio.to_thread(
        lambda: db.execute(
            """
            insert into bookings (call_id, caller_name, caller_phone, appointment_time, status, sms_sent)
            values (%s, %s, %s, %s, %s, %s)
            on conflict (call_id) do update
            set caller_name = excluded.caller_name,
                caller_phone = excluded.caller_phone,
                appointment_time = excluded.appointment_time,
                status = excluded.status,
                sms_sent = excluded.sms_sent
            """,
            (call_id, clean_name, clean_phone, appointment_time, "confirmed", False),
        )
    )


async def _persist_booking_caller_details(call_id: str, name: str, phone: str) -> None:
    clean_name = name.strip()
    clean_phone = phone.strip()
    if not clean_name and not clean_phone:
        return

    try:
        await asyncio.to_thread(
            lambda: db.execute(
                """
                update call_logs
                set caller_name = coalesce(nullif(%s, ''), caller_name),
                    phone_number = case
                        when phone_number is null or phone_number = '' or phone_number = 'unknown'
                        then coalesce(nullif(%s, ''), phone_number)
                        else phone_number
                    end
                where id = %s
                """,
                (clean_name, clean_phone, call_id),
            )
        )
    except Exception as exc:
        logger.error("[BOOKING] Failed to persist caller details for call_id=%s: %s", call_id, exc)


@llm.function_tool(
    description=(
        "Create a Cal.com appointment only after the caller has verbally confirmed "
        "the exact name, phone number, and appointment date/time. Never call this "
        "tool while proposing options or before explicit confirmation. Immediately "
        f'before calling this tool, tell the caller exactly: "{BOOKING_PREFLIGHT_FILLER}" '
        "Set confirmed_by_caller to true only after the caller explicitly confirms the repeated details."
    )
)
async def book_appointment(
    name: Annotated[str, "Confirmed caller name"],
    phone: Annotated[str, "Confirmed caller phone number"],
    date_time: Annotated[str, "Confirmed appointment datetime in ISO 8601 format"],
    confirmed_by_caller: Annotated[
        bool,
        "True only when the caller verbally confirmed the repeated name, phone number, and appointment date/time.",
    ] = False,
) -> str:
    call_id = _current_call_id.get() or _active_call_id
    if not call_id:
        logger.error("[BOOKING] Missing call context; refusing to create booking")
        return "I cannot complete the booking right now because this call is missing booking context."

    if not _coerce_confirmation(confirmed_by_caller):
        logger.warning("[BOOKING] Refusing booking without explicit caller confirmation call_id=%s", call_id)
        return (
            "Before I book it, please confirm the name, phone number, and appointment time once more."
        )

    try:
        payload = _booking_payload(name=name, phone=phone, date_time=date_time)
        api_key = _required_env("CALCOM_API_KEY")
    except Exception as exc:
        logger.error("[BOOKING] Invalid booking request: %s", exc)
        return f"I could not book that appointment because the booking details are incomplete: {exc}"

    try:
        booking_started_at = perf_counter()
        logger.info(
            "[BOOKING] Booking tool started call_id=%s spoken_filler_required=%r calcom_timeout_seconds=%s",
            call_id,
            BOOKING_PREFLIGHT_FILLER,
            CALCOM_TIMEOUT,
        )
        async with httpx.AsyncClient(timeout=CALCOM_TIMEOUT) as client:
            create_started_at = perf_counter()
            response = await client.post(
                "https://api.cal.com/v2/bookings",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "cal-api-version": _calcom_api_version(),
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            create_ms = round((perf_counter() - create_started_at) * 1000)
            logger.info(
                "[BOOKING] Booking request finished call_id=%s start=%s duration_ms=%s status_code=%s",
                call_id,
                payload["start"],
                create_ms,
                response.status_code,
            )
        if response.status_code not in (200, 201):
            logger.error("[BOOKING] Cal.com failed %s: %s", response.status_code, response.text)
            return "I could not complete the booking because the calendar service rejected the request."

        appointment_time = payload["start"]
        await _insert_booking_record(call_id=call_id, appointment_time=appointment_time, name=name, phone=phone)
        await _persist_booking_caller_details(call_id=call_id, name=name, phone=phone)
        booking_id = response.json().get("data", {}).get("uid", "confirmed")
        total_ms = round((perf_counter() - booking_started_at) * 1000)
        if total_ms > BOOKING_LATENCY_WARNING_MS:
            logger.warning("[BOOKING] Booking exceeded voice latency budget call_id=%s duration_ms=%s", call_id, total_ms)
        logger.info("[BOOKING] Confirmed booking call_id=%s booking_id=%s duration_ms=%s", call_id, booking_id, total_ms)
        return f"Your appointment is confirmed for {appointment_time}. Thank you, {name}."
    except httpx.TimeoutException:
        logger.error("[BOOKING] Cal.com request timed out")
        return "I could not complete the booking because the calendar service timed out."
    except Exception as exc:
        logger.error("[BOOKING] Booking failed: %s", exc)
        return "I could not complete the booking due to a calendar or database error."
