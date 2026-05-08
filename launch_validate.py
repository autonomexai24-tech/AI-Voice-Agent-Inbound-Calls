import argparse
import json
import os
import sys
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


REQUIRED_ENV_GROUPS = (
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

REQUIRED_TABLES = (
    "call_logs",
    "transcripts",
    "bookings",
    "agent_config",
    "notification_events",
)

REQUIRED_COLUMNS = {
    "call_logs": {
        "id",
        "phone_number",
        "caller_name",
        "start_time",
        "duration",
        "status",
        "outcome",
        "summary",
        "language_code",
        "mixed_language_enabled",
        "recording_url",
    },
    "transcripts": {"call_id", "speaker", "text", "timestamp"},
    "bookings": {"call_id", "caller_name", "caller_phone", "appointment_time", "status", "sms_sent"},
    "agent_config": {
        "id",
        "business_name",
        "business_phone",
        "business_timezone",
        "booking_instructions",
        "initial_greeting",
        "system_prompt",
        "vad_threshold",
        "language_code",
        "tts_speaker",
        "mixed_language_enabled",
        "updated_at",
    },
    "notification_events": {
        "id",
        "call_id",
        "channel",
        "provider",
        "event_type",
        "status",
        "provider_response",
        "error_message",
        "created_at",
    },
}


@dataclass(frozen=True)
class CheckResult:
    name: str
    passed: bool
    detail: str


class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None


def env_value(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def redact_known_secrets(message: str) -> str:
    redacted = message
    for _, names in REQUIRED_ENV_GROUPS:
        for name in names:
            value = os.environ.get(name, "").strip()
            if value:
                redacted = redacted.replace(value, "***")
    return redacted


def validate_database_url(database_url: str) -> None:
    parsed = urlsplit(database_url)
    if not parsed.scheme or not parsed.netloc:
        raise RuntimeError("DATABASE_URL must be a full PostgreSQL connection URL.")

    userinfo = parsed.netloc.rsplit("@", 1)[0] if "@" in parsed.netloc else ""
    if "@" in userinfo:
        raise RuntimeError("DATABASE_URL contains an unescaped @ in the username/password section.")


def check_environment() -> CheckResult:
    missing = [label for label, names in REQUIRED_ENV_GROUPS if not env_value(*names)]
    invalid: list[str] = []

    event_type_id = env_value("CALCOM_EVENT_TYPE_ID", "CAL_EVENT_TYPE_ID")
    if event_type_id:
        try:
            int(event_type_id)
        except ValueError:
            invalid.append("CALCOM_EVENT_TYPE_ID must be an integer")

    database_url = env_value("DATABASE_URL")
    if database_url:
        try:
            validate_database_url(database_url)
        except Exception as exc:
            invalid.append(str(exc))

    if missing or invalid:
        detail_parts = []
        if missing:
            detail_parts.append(f"missing: {', '.join(missing)}")
        if invalid:
            detail_parts.append(f"invalid: {', '.join(invalid)}")
        return CheckResult("environment", False, "; ".join(detail_parts))

    return CheckResult("environment", True, "all required launch env vars are present")


def check_database_schema() -> CheckResult:
    database_url = env_value("DATABASE_URL")
    if not database_url:
        return CheckResult("database_schema", False, "DATABASE_URL is missing")

    try:
        import psycopg2

        with psycopg2.connect(database_url, connect_timeout=5, application_name="inbound_voice_launch_validate") as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    select table_name, column_name
                    from information_schema.columns
                    where table_schema = 'public'
                      and table_name = any(%s)
                    """,
                    (list(REQUIRED_TABLES),),
                )
                columns_by_table: dict[str, set[str]] = {}
                for table_name, column_name in cursor.fetchall():
                    columns_by_table.setdefault(table_name, set()).add(column_name)

                missing_tables = [table for table in REQUIRED_TABLES if table not in columns_by_table]
                missing_columns: list[str] = []
                for table, required_columns in REQUIRED_COLUMNS.items():
                    existing_columns = columns_by_table.get(table, set())
                    for column in sorted(required_columns - existing_columns):
                        missing_columns.append(f"{table}.{column}")

                cursor.execute("select count(*) from agent_config")
                config_count = int(cursor.fetchone()[0])

        if missing_tables or missing_columns or config_count < 1:
            detail_parts = []
            if missing_tables:
                detail_parts.append(f"missing tables: {', '.join(missing_tables)}")
            if missing_columns:
                detail_parts.append(f"missing columns: {', '.join(missing_columns)}")
            if config_count < 1:
                detail_parts.append("agent_config has no default row")
            return CheckResult("database_schema", False, "; ".join(detail_parts))

        return CheckResult("database_schema", True, "required tables, columns, and default config exist")
    except Exception as exc:
        return CheckResult("database_schema", False, redact_known_secrets(str(exc)))


def http_request(url: str, *, timeout: float = 5.0):
    opener = build_opener(NoRedirectHandler)
    request = Request(url, headers={"User-Agent": "inbound-voice-launch-validator/1.0"})
    return opener.open(request, timeout=timeout)


def check_health_endpoint(base_url: str) -> CheckResult:
    health_url = urljoin(base_url.rstrip("/") + "/", "api/health")
    try:
        with http_request(health_url) as response:
            raw_body = response.read().decode("utf-8")
            body = json.loads(raw_body)
            if response.status == 200 and body.get("status") == "healthy":
                return CheckResult("health_endpoint", True, f"{health_url} returned healthy")
            return CheckResult(
                "health_endpoint",
                False,
                f"{health_url} returned HTTP {response.status} with status={body.get('status')!r}",
            )
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return CheckResult("health_endpoint", False, f"{health_url} returned HTTP {exc.code}: {body[:300]}")
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        return CheckResult("health_endpoint", False, f"{health_url} failed: {exc}")


def check_dashboard_auth(base_url: str) -> CheckResult:
    dashboard_url = urljoin(base_url.rstrip("/") + "/", "dashboard")
    try:
        with http_request(dashboard_url) as response:
            return CheckResult(
                "dashboard_auth",
                False,
                f"{dashboard_url} returned HTTP {response.status}; expected redirect to /login",
            )
    except HTTPError as exc:
        location = exc.headers.get("Location", "")
        if exc.code in {302, 303, 307, 308} and "/login" in location:
            return CheckResult("dashboard_auth", True, "unauthenticated /dashboard redirects to /login")
        return CheckResult("dashboard_auth", False, f"unexpected HTTP {exc.code} location={location!r}")
    except (URLError, TimeoutError) as exc:
        return CheckResult("dashboard_auth", False, f"{dashboard_url} failed: {exc}")


def check_login_page(base_url: str) -> CheckResult:
    login_url = urljoin(base_url.rstrip("/") + "/", "login")
    try:
        with http_request(login_url) as response:
            if response.status == 200:
                return CheckResult("login_page", True, f"{login_url} returned HTTP 200")
            return CheckResult("login_page", False, f"{login_url} returned HTTP {response.status}")
    except HTTPError as exc:
        return CheckResult("login_page", False, f"{login_url} returned HTTP {exc.code}")
    except (URLError, TimeoutError) as exc:
        return CheckResult("login_page", False, f"{login_url} failed: {exc}")


def format_results(results: list[CheckResult]) -> str:
    lines = []
    for result in results:
        marker = "PASS" if result.passed else "FAIL"
        lines.append(f"{marker} {result.name}: {result.detail}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an Inbound AI Voice production launch.")
    parser.add_argument("--base-url", default=os.environ.get("PUBLIC_BASE_URL", "http://127.0.0.1:3000"))
    parser.add_argument("--skip-http", action="store_true", help="Run env and DB checks only.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args()

    results = [
        check_environment(),
        check_database_schema(),
    ]
    if not args.skip_http:
        results.extend(
            [
                check_health_endpoint(args.base_url),
                check_login_page(args.base_url),
                check_dashboard_auth(args.base_url),
            ]
        )

    if args.json:
        print(json.dumps([result.__dict__ for result in results], indent=2, sort_keys=True))
    else:
        print(format_results(results))

    return 0 if all(result.passed for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
