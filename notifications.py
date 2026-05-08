import logging
import os
from time import perf_counter
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx


logger = logging.getLogger("notifications")

FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2"


@dataclass(frozen=True)
class SmsSendResult:
    sent: bool
    provider_response: str | None = None
    error_message: str | None = None


def _format_appointment_details(appointment_details: dict[str, Any] | str) -> str:
    if isinstance(appointment_details, str):
        return appointment_details

    appointment_time = str(appointment_details.get("appointment_time") or "")
    try:
        parsed = datetime.fromisoformat(appointment_time.replace("Z", "+00:00"))
        appointment_time = parsed.strftime("%A, %d %B %Y at %I:%M %p")
    except Exception:
        pass

    return appointment_time or "your confirmed appointment"


def _truncate_provider_response(value: Any, limit: int = 2000) -> str:
    text = str(value)
    return text if len(text) <= limit else f"{text[:limit]}..."


async def send_booking_sms_with_result(
    phone_number: str,
    appointment_details: dict[str, Any] | str,
    *,
    business_name: str = "Dental Clinic",
    callback_number: str = "",
) -> SmsSendResult:
    api_key = os.environ.get("FAST2SMS_API_KEY", "").strip()
    if not api_key:
        logger.error("[FAST2SMS] FAST2SMS_API_KEY is not configured")
        return SmsSendResult(sent=False, error_message="FAST2SMS_API_KEY is not configured")

    details = _format_appointment_details(appointment_details)
    clean_business_name = business_name.strip() or "Dental Clinic"
    clean_callback_number = callback_number.strip()
    message = f"Your appointment with {clean_business_name} is confirmed for {details}."
    if clean_callback_number:
        message += f" For help or changes, call {clean_callback_number}."
    message += " Thank you."
    payload = {
        "route": "q",
        "message": message,
        "language": "english",
        "flash": "0",
        "numbers": phone_number,
    }

    try:
        started_at = perf_counter()
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                FAST2SMS_URL,
                headers={
                    "authorization": api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        duration_ms = round((perf_counter() - started_at) * 1000)
    except httpx.TimeoutException:
        logger.error("[FAST2SMS] Request timed out phone_last4=%s", phone_number[-4:])
        return SmsSendResult(sent=False, error_message="Fast2SMS request timed out")
    except Exception as exc:
        logger.error("[FAST2SMS] Request failed phone_last4=%s error=%s", phone_number[-4:], exc)
        return SmsSendResult(sent=False, error_message=str(exc))

    try:
        response_payload = response.json()
    except ValueError:
        response_payload = {"raw": response.text}

    provider_response = _truncate_provider_response(response_payload)
    logger.info(
        "[FAST2SMS] Request finished phone_last4=%s status_code=%s duration_ms=%s provider_response=%s",
        phone_number[-4:],
        response.status_code,
        duration_ms,
        provider_response,
    )
    if response.status_code >= 400:
        logger.error("[FAST2SMS] HTTP %s", response.status_code)
        return SmsSendResult(
            sent=False,
            provider_response=provider_response,
            error_message=f"Fast2SMS HTTP {response.status_code}",
        )

    if isinstance(response_payload, dict) and response_payload.get("return") is False:
        return SmsSendResult(
            sent=False,
            provider_response=provider_response,
            error_message="Fast2SMS returned failure",
        )

    return SmsSendResult(sent=True, provider_response=provider_response)


async def send_booking_sms(
    phone_number: str,
    appointment_details: dict[str, Any] | str,
    *,
    business_name: str = "Dental Clinic",
    callback_number: str = "",
) -> bool:
    result = await send_booking_sms_with_result(
        phone_number,
        appointment_details,
        business_name=business_name,
        callback_number=callback_number,
    )
    return result.sent
