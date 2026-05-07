import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from livekit.agents import Agent, AgentSession, JobContext, RoomInputOptions, WorkerOptions, cli
from livekit.plugins import openai, sarvam, silero

import db
from notifications import send_booking_sms
from tools import book_appointment, set_booking_call_context


load_dotenv()

logger = logging.getLogger("inbound-agent")
logging.basicConfig(level=logging.INFO)


DEFAULT_AGENT_CONFIG = {
    "initial_greeting": "Hello, thanks for calling. How can I help you today?",
    "system_prompt": "You are a helpful inbound voice assistant.",
    "vad_threshold": 0.5,
}

TRANSCRIPT_TASKS: set[asyncio.Task[None]] = set()


@dataclass(frozen=True)
class AgentConfig:
    initial_greeting: str
    system_prompt: str
    vad_threshold: float


@dataclass
class VoicePipelineAgent:
    """Thin wrapper around the LiveKit conversational pipeline."""

    greeting: str
    system_prompt: str
    vad_threshold: float
    call_id: str | None = None

    async def start(self, ctx: JobContext) -> None:
        vad_threshold = _clamp_vad_threshold(self.vad_threshold)
        set_booking_call_context(self.call_id)
        assistant = InboundAssistant(
            instructions=self.system_prompt,
            greeting=self.greeting,
        )
        session = AgentSession(
            stt=sarvam.STT(
                language="unknown",
                model="saaras:v3",
                mode="transcribe",
                sample_rate=16000,
                flush_signal=True,
            ),
            llm=openai.LLM(
                model="gpt-4o",
                temperature=0.2,
                max_completion_tokens=160,
            ),
            tts=sarvam.TTS(
                target_language_code="hi-IN",
                model="bulbul:v3",
                speaker="kavya",
                speech_sample_rate=24000,
            ),
            vad=silero.VAD.load(
                activation_threshold=vad_threshold,
                sample_rate=16000,
            ),
            allow_interruptions=True,
            min_endpointing_delay=0.2,
            max_endpointing_delay=1.2,
            preemptive_generation=True,
        )
        _attach_transcript_logging(session, self.call_id)

        await session.start(
            assistant,
            room=ctx.room,
            room_input_options=RoomInputOptions(close_on_disconnect=False),
        )
        logger.info(
            "[AGENT] Voice pipeline started for room=%s vad_threshold=%s",
            ctx.room.name,
            vad_threshold,
        )


class InboundAssistant(Agent):
    def __init__(self, *, instructions: str, greeting: str) -> None:
        booking_policy = (
            "\n\n[BOOKING POLICY]\n"
            "If the caller wants to book an appointment, collect their name, phone number, "
            "and exact appointment date/time. Verbally repeat those details and ask for "
            "explicit confirmation. Call book_appointment only after the caller confirms. "
            "Do not use retrieval or multi-step RAG; rely only on this system prompt and "
            "the caller's current conversation for business context."
        )
        super().__init__(instructions=instructions + booking_policy, tools=[book_appointment])
        self._greeting = greeting

    async def on_enter(self) -> None:
        await self.session.generate_reply(
            instructions=f"Say this greeting exactly, then wait for the caller: {self._greeting!r}"
        )


def _clamp_vad_threshold(value: float) -> float:
    return min(1.0, max(0.0, float(value)))


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


def _find_phone_number(metadata: dict[str, Any], ctx: JobContext) -> str | None:
    metadata_candidates = (
        "phone_number",
        "phoneNumber",
        "caller_phone",
        "callerPhone",
        "from",
        "sip.phoneNumber",
    )
    for key in metadata_candidates:
        value = metadata.get(key)
        if value:
            return str(value)

    for participant in ctx.room.remote_participants.values():
        attrs = participant.attributes or {}
        for key in metadata_candidates:
            value = attrs.get(key)
            if value:
                return str(value)
        if participant.identity:
            return participant.identity

    return None


def _coerce_agent_config(row: dict[str, Any] | None) -> AgentConfig:
    source = row or DEFAULT_AGENT_CONFIG
    return AgentConfig(
        initial_greeting=str(
            source.get("initial_greeting") or DEFAULT_AGENT_CONFIG["initial_greeting"]
        ),
        system_prompt=str(source.get("system_prompt") or DEFAULT_AGENT_CONFIG["system_prompt"]),
        vad_threshold=float(source.get("vad_threshold") or DEFAULT_AGENT_CONFIG["vad_threshold"]),
    )


def fetch_active_agent_config() -> AgentConfig:
    """Load the latest agent configuration through the service-role Supabase client."""
    try:
        result = (
            db.get_supabase()
            .table("agent_config")
            .select("initial_greeting, system_prompt, vad_threshold, updated_at")
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[CONFIG] Failed to fetch agent_config: %s", exc)
        return _coerce_agent_config(None)

    rows = result.data or []
    if not rows:
        logger.warning("[CONFIG] No agent_config rows found; using defaults")
        return _coerce_agent_config(None)

    config = _coerce_agent_config(rows[0])
    logger.info("[CONFIG] Loaded active agent_config updated_at=%s", rows[0].get("updated_at"))
    return config


def create_call_log(caller_phone: str | None) -> tuple[str | None, datetime]:
    phone_number = caller_phone or "unknown"
    started_at = datetime.now(timezone.utc)
    try:
        result = (
            db.get_supabase()
            .table("call_logs")
            .insert(
                {
                    "phone_number": phone_number,
                    "start_time": started_at.isoformat(),
                    "status": "connected",
                    "outcome": "in_progress",
                }
            )
            .execute()
        )
    except Exception as exc:
        logger.error("[DB] Failed to create call_logs row: %s", exc)
        return None, started_at

    rows = result.data or []
    call_id = rows[0].get("id") if rows else None
    if call_id:
        logger.info("[DB] Created call_logs row id=%s", call_id)
    return call_id, started_at


async def _fetch_confirmed_booking(call_id: str) -> dict[str, Any] | None:
    def _fetch() -> dict[str, Any] | None:
        result = (
            db.get_supabase()
            .table("bookings")
            .select("call_id, appointment_time, status, sms_sent")
            .eq("call_id", call_id)
            .eq("status", "confirmed")
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None

    return await asyncio.to_thread(_fetch)


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
        db.get_supabase().table("call_logs").update(
            {
                "duration": duration,
                "status": status,
                "outcome": final_outcome,
            }
        ).eq("id", call_id).execute()

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


async def send_post_call_booking_sms(call_id: str | None, caller_phone: str | None) -> None:
    if not call_id:
        logger.info("[SMS] No call_id available; skipping post-call SMS check")
        return
    if not caller_phone:
        logger.info("[SMS] No caller phone available; skipping post-call SMS check")
        return

    try:
        booking = await _fetch_confirmed_booking(call_id)
    except Exception as exc:
        logger.error("[SMS] Failed to check confirmed booking for call_id=%s: %s", call_id, exc)
        return

    if not booking or booking.get("sms_sent"):
        logger.info("[SMS] No unsent confirmed booking for call_id=%s; SMS skipped", call_id)
        return

    sent = await send_booking_sms(caller_phone, booking)
    if not sent:
        logger.error("[SMS] Fast2SMS send failed for call_id=%s", call_id)
        return

    def _mark_sent() -> None:
        db.get_supabase().table("bookings").update({"sms_sent": True}).eq(
            "call_id", call_id
        ).execute()

    try:
        await asyncio.to_thread(_mark_sent)
        logger.info("[SMS] Marked booking SMS sent for call_id=%s", call_id)
    except Exception as exc:
        logger.error("[SMS] Failed to mark sms_sent=true for call_id=%s: %s", call_id, exc)


async def finalize_call(call_id: str | None, started_at: datetime, caller_phone: str | None) -> None:
    await drain_transcript_tasks()
    await complete_call_log(call_id, started_at)
    await send_post_call_booking_sms(call_id, caller_phone)


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
        db.get_supabase().table("transcripts").insert(
            {
                "call_id": call_id,
                "speaker": speaker,
                "text": text,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        ).execute()

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
        logger.exception("[LIVEKIT] Failed to connect to room: %s", exc)
        return

    logger.info("[LIVEKIT] Connected to room=%s", ctx.room.name)

    # SIP metadata can arrive on the room, job dispatch metadata, or participant attributes.
    await asyncio.sleep(0.25)
    room_metadata = _parse_json_metadata(getattr(ctx.room, "metadata", None))
    job_metadata = _parse_json_metadata(getattr(ctx.job, "metadata", None))
    metadata = {**room_metadata, **job_metadata}

    caller_phone = _find_phone_number(metadata, ctx)
    if caller_phone:
        logger.info("[CALLER] Incoming caller ID: %s", caller_phone)
    else:
        logger.info("[CALLER] Incoming caller ID unavailable")

    config = fetch_active_agent_config()
    call_id, call_started_at = create_call_log(caller_phone)
    agent = VoicePipelineAgent(
        greeting=config.initial_greeting,
        system_prompt=config.system_prompt,
        vad_threshold=config.vad_threshold,
        call_id=call_id,
    )

    try:
        await agent.start(ctx)
    except Exception as exc:
        logger.exception("[AGENT] Placeholder startup failed: %s", exc)
        await complete_call_log(
            call_id,
            call_started_at,
            status="failed",
            outcome="agent_start_failed",
        )
        return

    ctx.add_shutdown_callback(lambda: finalize_call(call_id, call_started_at, caller_phone))
    logger.info("[LIVEKIT] Worker entrypoint finished initialization for room=%s", ctx.room.name)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="inbound-voice-agent",
        )
    )
