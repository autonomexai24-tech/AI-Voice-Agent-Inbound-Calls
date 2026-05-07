import os
import time
from pathlib import Path
from urllib.parse import urlsplit

import psycopg2


DATABASE_URL_ENV = "DATABASE_URL"
SCHEMA_PATH = Path(__file__).with_name("schema.sql")
MAX_ATTEMPTS = 30
RETRY_DELAY_SECONDS = 2


def _validate_database_url(database_url: str) -> None:
    parsed = urlsplit(database_url)
    if not parsed.scheme or not parsed.netloc:
        raise RuntimeError("DATABASE_URL must be a full PostgreSQL connection URL.")

    userinfo = parsed.netloc.rsplit("@", 1)[0] if "@" in parsed.netloc else ""
    if "@" in userinfo:
        raise RuntimeError(
            "DATABASE_URL contains an unescaped @ in the username/password section. "
            "Percent-encode @ as %40 in the database password."
        )


def main() -> None:
    database_url = os.environ.get(DATABASE_URL_ENV, "").strip()
    if not database_url:
        raise RuntimeError(f"Missing required environment variable: {DATABASE_URL_ENV}")
    _validate_database_url(database_url)

    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    if not schema_sql.strip():
        raise RuntimeError(f"Schema file is empty: {SCHEMA_PATH}")

    last_error: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            with psycopg2.connect(database_url) as connection:
                with connection.cursor() as cursor:
                    cursor.execute(schema_sql)
                connection.commit()
            break
        except psycopg2.OperationalError as exc:
            last_error = exc
            print(f"Database not ready yet ({attempt}/{MAX_ATTEMPTS}): {exc}")
            time.sleep(RETRY_DELAY_SECONDS)
    else:
        raise RuntimeError("Database did not become ready in time.") from last_error

    print(f"Initialized database schema from {SCHEMA_PATH}")


if __name__ == "__main__":
    main()
