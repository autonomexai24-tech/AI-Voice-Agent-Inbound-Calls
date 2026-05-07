import os
from functools import lru_cache

from supabase import Client, create_client


SUPABASE_URL_ENV = "SUPABASE_SELF_HOSTED_URL"
SUPABASE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY"


class SupabaseConfigError(RuntimeError):
    """Raised when required Supabase service-role configuration is missing."""


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SupabaseConfigError(f"Missing required environment variable: {name}")
    return value


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """Return the service-role Supabase client for the self-hosted Kong URL."""
    url = _required_env(SUPABASE_URL_ENV)
    service_role_key = _required_env(SUPABASE_KEY_ENV)
    return create_client(url, service_role_key)


def reset_supabase_client_cache() -> None:
    """Clear the cached client after environment changes in tests or scripts."""
    get_supabase.cache_clear()
