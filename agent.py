import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from livekit.agents import Agent, AgentSession, JobContext, RoomInputOptions, WorkerOptions, cli
from livekit.plugins import openai, sarvam, silero

import db
from notifications import SmsSendResult, send_booking_sms_with_result
from tools import book_appointment, set_booking_call_context


load_dotenv()

logger = logging.getLogger("inbound-agent")
logging.basicConfig(level=logging.INFO)

AGENT_STATUS_PATH = Path(os.environ.get("AGENT_STATUS_PATH", "/tmp/inbound-agent-status.json"))


DEFAULT_AGENT_CONFIG = {
    "business_name": "Dental Clinic",
    "business_phone": "",
    "business_timezone": "Asia/Kolkata",
    "booking_instructions": "Confirm caller name, phone number, date, and time before booking.",
    "initial_greeting": "Hello, thanks for calling. How can I help you today?",
    "system_prompt": "You are a helpful inbound voice assistant.",
    "vad_threshold": 0.45,
    "language_code": "en-IN",
    "tts_speaker": "amelia",
    "mixed_language_enabled": False,
}

TRANSCRIPT_TASKS: set[asyncio.Task[None]] = set()
INITIAL_PARTICIPANT_WAIT_SECONDS = 3.0

STARTUP_ENV_GROUPS = (
    ("DATABASE_URL", ("DATABASE_URL",)),
    ("OPENAI_API_KEY", ("OPENAI_API_KEY",)),
    ("LIVEKIT_URL", ("LIVEKIT_URL",)),
    ("LIVEKIT_API_KEY", ("LIVEKIT_API_KEY",)),
    ("LIVEKIT_API_SECRET", ("LIVEKIT_API_SECRET",)),
    ("SARVAM_AI_API_KEY or SARVAM_API_KEY", ("SARVAM_AI_API_KEY", "SARVAM_API_KEY")),
    ("CALCOM_API_KEY", ("CALCOM_API_KEY",)),
    ("CALCOM_EVENT_TYPE_ID or CAL_EVENT_TYPE_ID", ("CALCOM_EVENT_TYPE_ID", "CAL_EVENT_TYPE_ID")),
    ("FAST2SMS_API_KEY", ("FAST2SMS_API_KEY",)),
    ("DASHBOARD_PASSWORD", ("DASHBOARD_PASSWORD",)),
)

PRACTICAL_VAD_MIN = 0.3
PRACTICAL_VAD_MAX = 0.7
ENDPOINTING_MIN_DELAY = 0.15
ENDPOINTING_MAX_DELAY = 0.8
LLM_MAX_COMPLETION_TOKENS = 150
MIN_INTERRUPTION_DURATION = 0.3
FALSE_INTERRUPTION_TIMEOUT = 1.0
VAD_MIN_SPEECH_DURATION = 0.04
VAD_MIN_SILENCE_DURATION = 0.35
VAD_PREFIX_PADDING_DURATION = 0.25
VAD_MAX_BUFFERED_SPEECH = 12.0
BOOKING_PREFLIGHT_FILLER = "One moment while I book that for you."

SUPPORTED_LANGUAGE_CODES = {"en-IN", "hi-IN", "kn-IN"}
LANGUAGE_LABELS = {
    "en-IN": "English",
    "hi-IN": "Hindi",
    "kn-IN": "Kannada",
}
SARVAM_SPEAKERS_BY_LANGUAGE = {
    "en-IN": "amelia",
    "hi-IN": "kavya",
    "kn-IN": "kavitha",
}
SUPPORTED_SARVAM_SPEAKERS = {
    "amelia",
    "kavya",
    "kavitha",
}


def log_event(level: int, event: str, **fields: Any) -> None:
    payload = {
        "event": event,
        **fields,
    }
    logger.log(level, json.dumps(payload, default=str, sort_keys=True))


def write_runtime_status(status: str, **fields: Any) -> None:
    payload = {
        "status": status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **fields,
    }
    try:
        AGENT_STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
        temp_path = AGENT_STATUS_PATH.with_suffix(AGENT_STATUS_PATH.suffix + ".tmp")
        temp_path.write_text(json.dumps(payload, default=str, sort_keys=True), encoding="utf-8")
        temp_path.replace(AGENT_STATUS_PATH)
    except Exception as exc:
        log_event(
            logging.WARNING,
            "runtime_status_write_failed",
            path=str(AGENT_STATUS_PATH),
            error_type=type(exc).__name__,
            error=_redact_secret_values(str(exc)),
        )


def _env_value(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def _redact_secret_values(message: str) -> str:
    redacted = message
    for _, env_names in STARTUP_ENV_GROUPS:
        for env_name in env_names:
            value = os.environ.get(env_name, "").strip()
            if value and value in redacted:
                redacted = redacted.replace(value, "***")
    return redacted


def _prepare_provider_env_aliases() -> None:
    sarvam_api_key = _env_value("SARVAM_API_KEY")
    sarvam_ai_api_key = _env_value("SARVAM_AI_API_KEY")
    if not sarvam_api_key and sarvam_ai_api_key:
        os.environ["SARVAM_API_KEY"] = sarvam_ai_api_key


def validate_startup_environment() -> None:
    _prepare_provider_env_aliases()

    missing = [
        label
        for label, env_names in STARTUP_ENV_GROUPS
        if not _env_value(*env_names)
    ]
    if missing:
        write_runtime_status("startup_failed", component="environment", missing=missing)
        log_event(logging.ERROR, "startup_env_validation_failed", missing=missing)
        raise RuntimeError("Missing required environment variable(s): " + ", ".join(missing))

    event_type_id = _env_value("CALCOM_EVENT_TYPE_ID", "CAL_EVENT_TYPE_ID")
    try:
        int(str(event_type_id))
    except (TypeError, ValueError) as exc:
        write_runtime_status("startup_failed", component="environment", invalid=["CALCOM_EVENT_TYPE_ID"])
        log_event(logging.ERROR, "startup_env_validation_failed", invalid=["CALCOM_EVENT_TYPE_ID"])
        raise RuntimeError("CALCOM_EVENT_TYPE_ID must be an integer") from exc

    try:
        db.fetch_one("select 1 as ok")
    except Exception as exc:
        redacted_error = _redact_secret_values(str(exc))
        write_runtime_status(
            "startup_db_failed",
            component="database",
            error_type=type(exc).__name__,
            error=redacted_error,
        )
        log_event(logging.ERROR, "startup_db_validation_failed", error=redacted_error)
        raise RuntimeError("Database connectivity validation failed") from exc

    write_runtime_status("startup_validated", component="startup")
    log_event(logging.INFO, "startup_validation_passed")


@dataclass(frozen=True)
class AgentConfig:
    business_name: str
    business_phone: str
    business_timezone: str
    booking_instructions: str
    initial_greeting: str
    system_prompt: str
    vad_threshold: float
    language_code: str
    tts_speaker: str
    mixed_language_enabled: bool


@dataclass(frozen=True)
class RuntimeLanguageConfig:
    primary_language_code: str
    stt_language: str
    tts_language_code: str
    tts_speaker: str
    mixed_language_enabled: bool


@dataclass
class VoicePipelineAgent:
    """Thin wrapper around the LiveKit conversational pipeline."""

    greeting: str
    system_prompt: str
    business_name: str
    business_phone: str
    business_timezone: str
    booking_instructions: str
    vad_threshold: float
    language_code: str
    tts_speaker: str
    mixed_language_enabled: bool
    call_id: str | None = None

    async def start(self, ctx: JobContext) -> None:
        vad_threshold = _clamp_vad_threshold(self.vad_threshold)
        language_config = _build_runtime_language_config(
            self.language_code,
            self.mixed_language_enabled,
            self.tts_speaker,
        )
        set_booking_call_context(self.call_id)
        assistant = InboundAssistant(
            instructions=self.system_prompt,
            greeting=self.greeting,
            business_name=self.business_name,
            business_phone=self.business_phone,
            business_timezone=self.business_timezone,
            booking_instructions=self.booking_instructions,
            language_config=language_config,
        )
        session = AgentSession(
            stt=sarvam.STT(
                language=language_config.stt_language,
                model="saaras:v3",
                mode="transcribe",
                sample_rate=16000,
                flush_signal=True,
            ),
            llm=openai.LLM(
                model="gpt-4o",
                temperature=0.2,
                max_completion_tokens=LLM_MAX_COMPLETION_TOKENS,
            ),
            tts=sarvam.TTS(
                target_language_code=language_config.tts_language_code,
                model="bulbul:v3",
                speaker=language_config.tts_speaker,
                speech_sample_rate=24000,
            ),
            vad=silero.VAD.load(
                min_speech_duration=VAD_MIN_SPEECH_DURATION,
                min_silence_duration=VAD_MIN_SILENCE_DURATION,
                prefix_padding_duration=VAD_PREFIX_PADDING_DURATION,
                max_buffered_speech=VAD_MAX_BUFFERED_SPEECH,
                activation_threshold=vad_threshold,
                sample_rate=16000,
            ),
            allow_interruptions=True,
            min_interruption_duration=MIN_INTERRUPTION_DURATION,
            min_endpointing_delay=ENDPOINTING_MIN_DELAY,
            max_endpointing_delay=ENDPOINTING_MAX_DELAY,
            false_interruption_timeout=FALSE_INTERRUPTION_TIMEOUT,
            preemptive_generation=True,
        )
        _attach_transcript_logging(session, self.call_id)

        await session.start(
            assistant,
            room=ctx.room,
            room_input_options=RoomInputOptions(close_on_disconnect=False),
        )
        logger.info(
            "[AGENT] Voice pipeline started for room=%s vad_threshold=%s language=%s stt_language=%s tts_language=%s speaker=%s mixed_language=%s endpointing_min=%s endpointing_max=%s max_completion_tokens=%s",
            ctx.room.name,
            vad_threshold,
            language_config.primary_language_code,
            language_config.stt_language,
            language_config.tts_language_code,
            language_config.tts_speaker,
            language_config.mixed_language_enabled,
            ENDPOINTING_MIN_DELAY,
            ENDPOINTING_MAX_DELAY,
            LLM_MAX_COMPLETION_TOKENS,
        )


class InboundAssistant(Agent):
    def __init__(
        self,
        *,
        instructions: str,
        greeting: str,
        business_name: str,
        business_phone: str,
        business_timezone: str,
        booking_instructions: str,
        language_config: RuntimeLanguageConfig,
    ) -> None:
        language_policy = _build_language_policy(language_config)
        business_policy = (
            "\n\n[BUSINESS SETTINGS]\n"
            f"Business name: {business_name}.\n"
            f"Callback phone: {business_phone or 'not provided'}.\n"
            f"Business timezone: {business_timezone}.\n"
            f"Booking instructions: {booking_instructions}."
        )
        response_policy = (
            "\n\n[RESPONSE POLICY]\n"
            "Keep replies short, calm, and receptionist-like. Ask one question at a time. "
            "Prefer one concise sentence. Use two short sentences only for appointment confirmation or booking failure. "
            "Never leave dead air. If you need time to process, say a brief filler like "
            '"One moment" or "Let me check that." '
            "Do not pause silently for more than one second."
        )
        booking_policy = (
            "\n\n[BOOKING POLICY]\n"
            "If the caller wants to book an appointment, collect their name, phone number, "
            "and exact appointment date/time. Verbally repeat those details and ask for "
            "explicit confirmation. Call book_appointment only after the caller confirms. "
            "When calling book_appointment, pass confirmed_by_caller=true only if the caller explicitly confirmed the repeated details. "
            f'Immediately before calling book_appointment, say only: "{BOOKING_PREFLIGHT_FILLER}" '
            "After the tool returns, say only the result or ask for one alternate time. "
            "Do not use retrieval or multi-step RAG; rely only on this system prompt and "
            "the caller's current conversation for business context."
        )
        super().__init__(
            instructions=instructions + business_policy + language_policy + response_policy + booking_policy,
            tools=[book_appointment],
        )
        self._greeting = greeting

    async def on_enter(self) -> None:
        await self.session.generate_reply(
            instructions=f"Say this greeting exactly, then wait for the caller: {self._greeting!r}"
        )


def _clamp_vad_threshold(value: float) -> float:
    raw_value = float(value)
    if _coerce_bool(os.environ.get("ALLOW_FULL_VAD_RANGE")):
        return min(1.0, max(0.0, raw_value))

    clamped = min(PRACTICAL_VAD_MAX, max(PRACTICAL_VAD_MIN, raw_value))
    if clamped != raw_value:
        logger.warning(
            "[CONFIG] VAD threshold %.3f outside practical range %.1f-%.1f; using %.3f",
            raw_value,
            PRACTICAL_VAD_MIN,
            PRACTICAL_VAD_MAX,
            clamped,
        )
    return clamped


def _normalize_vad_threshold(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        fallback = float(DEFAULT_AGENT_CONFIG["vad_threshold"])
        logger.warning("[CONFIG] Invalid vad_threshold=%r; using default %.2f", value, fallback)
        return fallback
    return _clamp_vad_threshold(parsed)


def _normalize_language_code(value: Any) -> str:
    language_code = str(value or DEFAULT_AGENT_CONFIG["language_code"]).strip()
    if language_code in SUPPORTED_LANGUAGE_CODES:
        return language_code

    logger.warning(
        "[CONFIG] Unsupported language_code=%r; falling back to %s",
        language_code,
        DEFAULT_AGENT_CONFIG["language_code"],
    )
    return str(DEFAULT_AGENT_CONFIG["language_code"])


def _normalize_tts_speaker(value: Any, language_code: str) -> str:
    configured_speaker = str(value or "").strip().lower()
    expected_speaker = SARVAM_SPEAKERS_BY_LANGUAGE[language_code]
    if configured_speaker == expected_speaker:
        return configured_speaker

    if configured_speaker:
        logger.warning(
            "[CONFIG] tts_speaker=%r does not match language_code=%s; using %s",
            configured_speaker,
            language_code,
            expected_speaker,
        )
    return expected_speaker


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _build_runtime_language_config(
    language_code: str,
    mixed_language_enabled: bool,
    tts_speaker: str,
) -> RuntimeLanguageConfig:
    primary_language_code = _normalize_language_code(language_code)
    return RuntimeLanguageConfig(
        primary_language_code=primary_language_code,
        stt_language="unknown" if mixed_language_enabled else primary_language_code,
        tts_language_code=primary_language_code,
        tts_speaker=_normalize_tts_speaker(tts_speaker, primary_language_code),
        mixed_language_enabled=mixed_language_enabled,
    )


def _build_language_policy(language_config: RuntimeLanguageConfig) -> str:
    primary_language = LANGUAGE_LABELS[language_config.primary_language_code]
    if language_config.mixed_language_enabled:
        return (
            "\n\n[LANGUAGE POLICY]\n"
            f"Use {primary_language} as the primary response language. "
            "The caller may mix English, Hindi, or Kannada; handle this naturally and keep replies short. "
            "Do not translate every sentence or mention language switching. "
            "If the caller clearly prefers another supported language, adapt softly while keeping the conversation booking-focused."
        )

    return (
        "\n\n[LANGUAGE POLICY]\n"
        f"Respond in {primary_language}. If the caller uses another language, ask briefly for clarification or adapt only when needed for clarity. "
        "Keep replies concise, formal, and booking-focused."
    )


def _parse_json_metadata(raw_metadata: str | None) -> dict[str, Any]:
    if not raw_metadata:
        return {}
    try:
        parsed = json.loads(raw_metadata)
    except json.JSONDecodeError:
        logger.warning("[METADATA] Room metadata is not valid JSON: %s", raw_metadata)
        return {}
    if not isinstance(parsed, dict):
        logger.warning("[METADATA] Room metadata JSON is not an object")
        return {}
    return parsed


async def _wait_for_initial_participant(ctx: JobContext) -> Any | None:
    if ctx.room.remote_participants:
        return next(iter(ctx.room.remote_participants.values()))

    wait_for_participant = getattr(ctx, "wait_for_participant", None)
    if not callable(wait_for_participant):
        await asyncio.sleep(0.25)
        return next(iter(ctx.room.remote_participants.values()), None)

    try:
        return await asyncio.wait_for(wait_for_participant(), timeout=INITIAL_PARTICIPANT_WAIT_SECONDS)
    except asyncio.TimeoutError:
        log_event(
            logging.WARNING,
            "livekit_initial_participant_timeout",
            room=ctx.room.name,
            timeout_seconds=INITIAL_PARTICIPANT_WAIT_SECONDS,
        )
    except Exception as exc:
        log_event(
            logging.WARNING,
            "livekit_initial_participant_wait_failed",
            room=ctx.room.name,
            error_type=type(exc).__name__,
            error=_redact_secret_values(str(exc)),
        )
    return next(iter(ctx.room.remote_participants.values()), None)


def _participant_phone_number(participant: Any) -> str | None:
    metadata_candidates = (
        "phone_number",
        "phoneNumber",
        "caller_phone",
        "callerPhone",
        "from",
        "sip.phoneNumber",
        "sip.phone_number",
        "sip.trunkPhoneNumber",
    )
    attrs = getattr(participant, "attributes", None) or {}
    for key in metadata_candidates:
        value = _metadata_lookup(attrs, key)
        if value:
            return str(value)

    identity = getattr(participant, "identity", None)
    return str(identity) if identity else None


def _find_phone_number(metadata: dict[str, Any], ctx: JobContext, initial_participant: Any | None = None) -> str | None:
    metadata_candidates = (
        "phone_number",
        "phoneNumber",
        "caller_phone",
        "callerPhone",
        "from",
        "sip.phoneNumber",
        "sip.phone_number",
        "sip.trunkPhoneNumber",
    )
    for key in metadata_candidates:
        value = _metadata_lookup(metadata, key)
        if value:
            return str(value)

    if initial_participant:
        participant_phone = _participant_phone_number(initial_participant)
        if participant_phone:
            return participant_phone

    for participant in ctx.room.remote_participants.values():
        participant_phone = _participant_phone_number(participant)
        if participant_phone:
            return participant_phone

    return None


def _metadata_lookup(source: dict[str, Any], key: str) -> Any:
    if not isinstance(source, dict):
        return None

    if key in source:
        return source[key]

    current: Any = source
    for part in key.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _coerce_agent_config(row: dict[str, Any] | None) -> AgentConfig:
    source = row or DEFAULT_AGENT_CONFIG
    language_code = _normalize_language_code(source.get("language_code"))
    return AgentConfig(
        business_name=str(source.get("business_name") or DEFAULT_AGENT_CONFIG["business_name"]),
        business_phone=str(source.get("business_phone") or DEFAULT_AGENT_CONFIG["business_phone"]),
        business_timezone=str(source.get("business_timezone") or DEFAULT_AGENT_CONFIG["business_timezone"]),
        booking_instructions=str(source.get("booking_instructions") or DEFAULT_AGENT_CONFIG["booking_instructions"]),
        initial_greeting=str(
            source.get("initial_greeting") or DEFAULT_AGENT_CONFIG["initial_greeting"]
        ),
        system_prompt=str(source.get("system_prompt") or DEFAULT_AGENT_CONFIG["system_prompt"]),
        vad_threshold=_normalize_vad_threshold(source.get("vad_threshold")),
        language_code=language_code,
        tts_speaker=_normalize_tts_speaker(source.get("tts_speaker"), language_code),
        mixed_language_enabled=_coerce_bool(
            source.get("mixed_language_enabled")
            if "mixed_language_enabled" in source
            else DEFAULT_AGENT_CONFIG["mixed_language_enabled"]
        ),
    )


def fetch_active_agent_config() -> AgentConfig:
    """Load the latest agent configuration through PostgreSQL."""
    try:
        row = db.fetch_one(
            """
            select
                business_name,
                business_phone,
                business_timezone,
                booking_instructions,
                initial_greeting,
                system_prompt,
                vad_threshold,
                language_code,
                tts_speaker,
                mixed_language_enabled,
                updated_at
            from agent_config
            order by updated_at desc nulls last
            limit 1
            """
        )
    except Exception as exc:
        logger.error("[CONFIG] Failed to fetch agent_config: %s", exc)
        return _coerce_agent_config(None)

    if not row:
        logger.warning("[CONFIG] No agent_config rows found; using defaults")
        return _coerce_agent_config(None)

    config = _coerce_agent_config(row)
    logger.info(
        "[CONFIG] Loaded active agent_config updated_at=%s language=%s speaker=%s mixed_language=%s",
        row.get("updated_at"),
        config.language_code,
        config.tts_speaker,
        config.mixed_language_enabled,
    )
    return config


def create_call_log(caller_phone: str | None, config: AgentConfig) -> tuple[str | None, datetime]:
    phone_number = caller_phone or "unknown"
    started_at = datetime.now(timezone.utc)
    try:
        row = db.execute_returning_one(
            """
            insert into call_logs (
                phone_number,
                start_time,
                status,
                outcome,
                language_code,
                mixed_language_enabled
            )
            values (%s, %s, %s, %s, %s, %s)
            returning id
            """,
            (
                phone_number,
                started_at,
                "connected",
                "in_progress",
                config.language_code,
                config.mixed_language_enabled,
            ),
        )
    except Exception as exc:
        logger.error("[DB] Failed to create call_logs row: %s", exc)
        return None, started_at

    call_id = str(row["id"]) if row and row.get("id") else None
    if call_id:
        log_event(
            logging.INFO,
            "call_log_created",
            call_id=call_id,
            status="connected",
            outcome="in_progress",
            phone_last4=phone_number[-4:] if phone_number != "unknown" else None,
            language_code=config.language_code,
            mixed_language_enabled=config.mixed_language_enabled,
        )
    return call_id, started_at


def create_failed_inbound_session_log(
    *,
    room_name: str | None,
    error_type: str,
    error_message: str,
) -> str | None:
    started_at = datetime.now(timezone.utc)
    summary = f"LiveKit room connection failed before agent start: {error_type}: {error_message}"
    try:
        row = db.execute_returning_one(
            """
            insert into call_logs (
                phone_number,
                start_time,
                duration,
                status,
                outcome,
                summary
            )
            values (%s, %s, %s, %s, %s, %s)
            returning id
            """,
            (
                "unknown",
                started_at,
                0,
                "failed",
                "livekit_connect_failed",
                summary[:500],
            ),
        )
    except Exception as exc:
        log_event(
            logging.ERROR,
            "failed_inbound_session_log_create_failed",
            room=room_name,
            error_type=type(exc).__name__,
            error=_redact_secret_values(str(exc)),
        )
        return None

    call_id = str(row["id"]) if row and row.get("id") else None
    log_event(
        logging.ERROR,
        "failed_inbound_session_logged",
        call_id=call_id,
        room=room_name,
        outcome="livekit_connect_failed",
        failure_error_type=error_type,
    )
    return call_id


async def _fetch_confirmed_booking(call_id: str) -> dict[str, Any] | None:
    def _fetch() -> dict[str, Any] | None:
        return db.fetch_one(
            """
            select call_id, appointment_time, status, sms_sent
            from bookings
            where call_id = %s and status = %s
            limit 1
            """,
            (call_id, "confirmed"),
        )

    return await asyncio.to_thread(_fetch)


async def _claim_unsent_confirmed_booking_for_sms(call_id: str) -> dict[str, Any] | None:
    def _claim() -> dict[str, Any] | None:
        return db.execute_returning_one(
            """
            update bookings
            set sms_sent = true
            where call_id = %s
              and status = %s
              and sms_sent = false
            returning call_id, appointment_time, status, sms_sent, caller_name, caller_phone
            """,
            (call_id, "confirmed"),
        )

    return await asyncio.to_thread(_claim)


async def _release_booking_sms_claim(call_id: str) -> None:
    def _release() -> None:
        db.execute(
            """
            update bookings
            set sms_sent = false
            where call_id = %s
              and status = %s
            """,
            (call_id, "confirmed"),
        )

    await asyncio.to_thread(_release)


async def complete_call_log(
    call_id: str | None,
    started_at: datetime,
    *,
    status: str = "completed",
    outcome: str | None = None,
) -> None:
    if not call_id:
        logger.info("[DB] No call_id available; skipping call completion update")
        return

    ended_at = datetime.now(timezone.utc)
    duration = max(0, int((ended_at - started_at).total_seconds()))
    final_outcome = outcome

    if final_outcome is None:
        try:
            final_outcome = "booked" if await _fetch_confirmed_booking(call_id) else "completed"
        except Exception as exc:
            logger.error("[DB] Failed to check booking outcome for call_id=%s: %s", call_id, exc)
            final_outcome = "completed"

    def _update() -> None:
        db.execute(
            """
            update call_logs
            set duration = %s,
                status = %s,
                outcome = %s,
                summary = %s
            where id = %s
            """,
            (duration, status, final_outcome, _build_call_summary(final_outcome, duration, status=status), call_id),
        )

    try:
        await asyncio.to_thread(_update)
        logger.info(
            "[DB] Completed call_log id=%s status=%s outcome=%s duration=%ss",
            call_id,
            status,
            final_outcome,
            duration,
        )
    except Exception as exc:
        logger.error("[DB] Failed to update call completion for call_id=%s: %s", call_id, exc)


async def drain_transcript_tasks(timeout: float = 2.0) -> None:
    if not TRANSCRIPT_TASKS:
        return

    pending = set(TRANSCRIPT_TASKS)
    done, still_pending = await asyncio.wait(pending, timeout=timeout)
    if done:
        logger.info("[TRANSCRIPT] Drained %s transcript task(s)", len(done))
    if still_pending:
        logger.warning("[TRANSCRIPT] Cancelling %s pending transcript task(s)", len(still_pending))
        for task in still_pending:
            task.cancel()


async def send_post_call_booking_sms(
    call_id: str | None,
    caller_phone: str | None,
    *,
    business_name: str = "Dental Clinic",
    business_phone: str = "",
) -> None:
    if not call_id:
        logger.info("[SMS] No call_id available; skipping post-call SMS check")
        return

    try:
        booking = await _claim_unsent_confirmed_booking_for_sms(call_id)
    except Exception as exc:
        logger.error("[SMS] Failed to check confirmed booking for call_id=%s: %s", call_id, exc)
        return

    if not booking:
        logger.info("[SMS] No unsent confirmed booking for call_id=%s; SMS skipped", call_id)
        return

    sms_phone = str(booking.get("caller_phone") or caller_phone or "").strip()
    if not sms_phone:
        logger.error("[SMS] Confirmed booking has no phone number; SMS skipped call_id=%s", call_id)
        await record_notification_event(
            call_id,
            SmsSendResult(sent=False, error_message="Confirmed booking has no phone number"),
        )
        try:
            await _release_booking_sms_claim(call_id)
        except Exception as exc:
            logger.error("[SMS] Failed to release booking SMS claim for call_id=%s: %s", call_id, exc)
        return

    result = await send_booking_sms_with_result(
        sms_phone,
        booking,
        business_name=business_name,
        callback_number=business_phone,
    )
    await record_notification_event(call_id, result)
    if not result.sent:
        logger.error("[SMS] Fast2SMS send failed for call_id=%s", call_id)
        try:
            await _release_booking_sms_claim(call_id)
            logger.info("[SMS] Released booking SMS claim for retry call_id=%s", call_id)
        except Exception as exc:
            logger.error("[SMS] Failed to release booking SMS claim for call_id=%s: %s", call_id, exc)
        return

    logger.info("[SMS] Marked booking SMS sent for call_id=%s", call_id)


async def record_notification_event(call_id: str, result: SmsSendResult) -> None:
    def _insert() -> None:
        db.execute(
            """
            insert into notification_events (
                call_id,
                channel,
                provider,
                event_type,
                status,
                provider_response,
                error_message
            )
            values (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                call_id,
                "sms",
                "fast2sms",
                "booking_confirmation",
                "sent" if result.sent else "failed",
                result.provider_response,
                result.error_message,
            ),
        )

    try:
        await asyncio.to_thread(_insert)
        log_event(
            logging.INFO,
            "notification_event_recorded",
            call_id=call_id,
            channel="sms",
            provider="fast2sms",
            status="sent" if result.sent else "failed",
        )
    except Exception as exc:
        logger.error("[SMS] Failed to record notification event for call_id=%s: %s", call_id, exc)


async def finalize_call(
    call_id: str | None,
    started_at: datetime,
    caller_phone: str | None,
    *,
    business_name: str = "Dental Clinic",
    business_phone: str = "",
) -> None:
    log_event(logging.INFO, "call_shutdown_finalize_started", call_id=call_id)
    try:
        await drain_transcript_tasks()
        await complete_call_log(call_id, started_at)
        await send_post_call_booking_sms(
            call_id,
            caller_phone,
            business_name=business_name,
            business_phone=business_phone,
        )
    finally:
        write_runtime_status("call_finalized", call_id=call_id)
        log_event(logging.INFO, "call_shutdown_finalize_finished", call_id=call_id)


def _build_call_summary(outcome: str | None, duration: int, *, status: str = "completed") -> str:
    normalized_status = (status or "").lower()

    if outcome == "booked":
        return f"Booked appointment during a {duration}s call."
    if outcome == "agent_start_failed":
        return "Agent failed to start; call did not complete normally."
    if outcome == "livekit_connect_failed":
        return "LiveKit room connection failed before the agent could start."
    if normalized_status in {"failed", "missed", "error"}:
        return f"Call ended with status {normalized_status} after {duration}s."
    if duration < 5:
        return f"Call ended before a full conversation could be completed ({duration}s)."
    return f"Call completed without a confirmed booking in {duration}s."


def _conversation_text(item: Any) -> str:
    text_content = getattr(item, "text_content", None)
    if text_content:
        return str(text_content).strip()

    content = getattr(item, "content", "")
    if isinstance(content, list):
        return " ".join(str(part) for part in content if part).strip()
    return str(content or "").strip()


async def log_transcript_turn(call_id: str, speaker: str, text: str) -> None:
    if not text:
        return

    def _insert() -> None:
        db.execute(
            """
            insert into transcripts (call_id, speaker, text, timestamp)
            values (%s, %s, %s, %s)
            """,
            (call_id, speaker, text, datetime.now(timezone.utc)),
        )

    try:
        await asyncio.to_thread(_insert)
    except Exception as exc:
        logger.error("[DB] Failed to log transcript turn: %s", exc)


def _track_transcript_task(coro: Any) -> None:
    task = asyncio.create_task(coro)
    TRANSCRIPT_TASKS.add(task)
    task.add_done_callback(TRANSCRIPT_TASKS.discard)


def _attach_transcript_logging(session: AgentSession, call_id: str | None) -> None:
    if not call_id:
        logger.warning("[TRANSCRIPT] No call_id available; transcript persistence disabled")
        return

    @session.on("conversation_item_added")
    def _on_conversation_item_added(event: Any) -> None:
        item = getattr(event, "item", None)
        speaker = str(getattr(item, "role", "") or "").strip()
        if speaker not in {"user", "assistant"}:
            return
        text = _conversation_text(item)
        _track_transcript_task(log_transcript_turn(call_id, speaker, text))


async def entrypoint(ctx: JobContext) -> None:
    try:
        await ctx.connect()
    except Exception as exc:
        room_name = getattr(getattr(ctx, "room", None), "name", None)
        redacted_error = _redact_secret_values(str(exc))
        failed_call_id = create_failed_inbound_session_log(
            room_name=room_name,
            error_type=type(exc).__name__,
            error_message=redacted_error,
        )
        write_runtime_status(
            "livekit_connect_failed",
            call_id=failed_call_id,
            room=room_name,
            error_type=type(exc).__name__,
            error=redacted_error,
        )
        log_event(
            logging.ERROR,
            "livekit_room_connect_failed",
            call_id=failed_call_id,
            room=room_name,
            error_type=type(exc).__name__,
            error=redacted_error,
            action="Check LIVEKIT_URL/API credentials, LiveKit dispatch rule, SIP trunk routing, and room permissions.",
        )
        return

    write_runtime_status("room_connected", room=ctx.room.name)
    log_event(logging.INFO, "livekit_room_connected", room=ctx.room.name)

    # SIP metadata can arrive on the room, job dispatch metadata, or participant attributes.
    initial_participant = await _wait_for_initial_participant(ctx)
    room_metadata = _parse_json_metadata(getattr(ctx.room, "metadata", None))
    job_metadata = _parse_json_metadata(getattr(getattr(ctx, "job", None), "metadata", None))
    metadata = {**room_metadata, **job_metadata}

    caller_phone = _find_phone_number(metadata, ctx, initial_participant)
    if caller_phone:
        log_event(logging.INFO, "caller_identity_detected", room=ctx.room.name, phone_last4=caller_phone[-4:])
    else:
        log_event(logging.WARNING, "caller_identity_unavailable", room=ctx.room.name)

    config = fetch_active_agent_config()
    call_id, call_started_at = create_call_log(caller_phone, config)
    agent = VoicePipelineAgent(
        greeting=config.initial_greeting,
        system_prompt=config.system_prompt,
        business_name=config.business_name,
        business_phone=config.business_phone,
        business_timezone=config.business_timezone,
        booking_instructions=config.booking_instructions,
        vad_threshold=config.vad_threshold,
        language_code=config.language_code,
        tts_speaker=config.tts_speaker,
        mixed_language_enabled=config.mixed_language_enabled,
        call_id=call_id,
    )

    try:
        await agent.start(ctx)
    except Exception as exc:
        redacted_error = _redact_secret_values(str(exc))
        write_runtime_status(
            "agent_start_failed",
            call_id=call_id,
            room=ctx.room.name,
            error_type=type(exc).__name__,
            error=redacted_error,
        )
        log_event(
            logging.ERROR,
            "agent_pipeline_start_failed",
            call_id=call_id,
            room=ctx.room.name,
            error_type=type(exc).__name__,
            error=redacted_error,
        )
        await complete_call_log(
            call_id,
            call_started_at,
            status="failed",
            outcome="agent_start_failed",
        )
        return

    write_runtime_status(
        "call_active",
        call_id=call_id,
        room=ctx.room.name,
        language_code=config.language_code,
        mixed_language_enabled=config.mixed_language_enabled,
    )
    ctx.add_shutdown_callback(
        lambda: finalize_call(
            call_id,
            call_started_at,
            caller_phone,
            business_name=config.business_name,
            business_phone=config.business_phone,
        )
    )
    logger.info("[LIVEKIT] Worker entrypoint finished initialization for room=%s", ctx.room.name)


if __name__ == "__main__":
    validate_startup_environment()
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="inbound-voice-agent",
        )
    )
