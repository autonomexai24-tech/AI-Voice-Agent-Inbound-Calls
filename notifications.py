import logging
import os
from datetime import datetime
from typing import Any

import httpx


logger = logging.getLogger("notifications")

FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2"


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


async def send_booking_sms(phone_number: str, appointment_details: dict[str, Any] | str) -> bool:
    api_key = os.environ.get("FAST2SMS_API_KEY", "").strip()
    if not api_key:
        logger.error("[FAST2SMS] FAST2SMS_API_KEY is not configured")
        return False

    details = _format_appointment_details(appointment_details)
    message = f"Your appointment is confirmed for {details}. Thank you."
    payload = {
        "route": "q",
        "message": message,
        "language": "english",
        "flash": "0",
        "numbers": phone_number,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                FAST2SMS_URL,
                headers={
                    "authorization": api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.TimeoutException:
        logger.error("[FAST2SMS] Request timed out for phone=%s", phone_number)
        return False
    except Exception as exc:
        logger.error("[FAST2SMS] Request failed for phone=%s: %s", phone_number, exc)
        return False

    try:
        response_payload = response.json()
    except ValueError:
        response_payload = {"raw": response.text}

    logger.info("[FAST2SMS] Response payload: %s", response_payload)
    if response.status_code >= 400:
        logger.error("[FAST2SMS] HTTP %s for phone=%s", response.status_code, phone_number)
        return False

    if isinstance(response_payload, dict) and response_payload.get("return") is False:
        return False

    return True
