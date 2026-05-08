import os
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

import psycopg2
from psycopg2.extras import RealDictCursor


DATABASE_URL_ENV = "DATABASE_URL"


class DatabaseConfigError(RuntimeError):
    pass


def _required_database_url() -> str:
    value = os.environ.get(DATABASE_URL_ENV, "").strip()
    if not value:
        raise DatabaseConfigError(f"Missing required environment variable: {DATABASE_URL_ENV}")
    return value


@contextmanager
def get_connection() -> Iterator[Any]:
    connection = psycopg2.connect(
        _required_database_url(),
        connect_timeout=5,
        application_name="inbound_voice_agent",
    )
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def fetch_all(query: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query, params)
            return [dict(row) for row in cursor.fetchall()]


def fetch_one(query: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query, params)
            row = cursor.fetchone()
            return dict(row) if row else None


def execute(query: str, params: Sequence[Any] = ()) -> None:
    with get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, params)


def execute_returning_one(query: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    with get_connection() as connection:
        with connection.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query, params)
            row = cursor.fetchone()
            return dict(row) if row else None
