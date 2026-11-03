"""In-memory per-IP rate limiting for the expensive AI endpoints.

Only ``/api/discovery``, ``/api/recipe`` and ``/api/chat`` are limited;
catalog browsing and health checks stay unlimited. State lives in the
process (one limiter per app instance), which is all a single Render
service needs. Denials answer 429 with a ``{'detail': ...}`` body so the
existing frontend error path shows the friendly message verbatim.
"""

from __future__ import annotations

import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

RATE_LIMITED_PREFIXES = ('/api/discovery', '/api/recipe', '/api/chat')
MAX_REQUESTS_PER_MINUTE = 8
WINDOW_SECONDS = 60.0
MAX_TRACKED_KEYS = 512

RATE_LIMIT_MESSAGE = (
    'Too many requests — please wait a minute and try again.'
)


def limited_prefix(path: str) -> str | None:
    """The rate-limited prefix a path falls under, if any (pure)."""
    for prefix in RATE_LIMITED_PREFIXES:
        if path == prefix or path.startswith(prefix + '/'):
            return prefix
    return None


def client_ip(request: Request) -> str:
    """Best-effort client IP, honoring Render's proxy header first."""
    forwarded = request.headers.get('x-forwarded-for')
    if forwarded:
        first = forwarded.split(',')[0].strip()
        if first:
            return first
    if request.client is not None:
        return request.client.host
    return 'unknown'


class RateLimiter:
    """Sliding-window counter keyed by (client IP, endpoint prefix)."""

    def __init__(
        self,
        *,
        max_requests: int = MAX_REQUESTS_PER_MINUTE,
        window_seconds: float = WINDOW_SECONDS,
    ) -> None:
        self._max = max_requests
        self._window = window_seconds
        self._hits: dict[tuple[str, str], list[float]] = {}

    def check(self, key: tuple[str, str], now: float) -> tuple[bool, float]:
        """Check and record a hit: (allowed, retry_after_seconds)."""
        hits = [made for made in self._hits.get(key, []) if now - made < self._window]
        if len(hits) >= self._max:
            return False, max(self._window - (now - hits[0]), 0.0)
        hits.append(now)
        self._hits[key] = hits
        if len(self._hits) > MAX_TRACKED_KEYS:
            self._prune(now)
        return True, 0.0

    def _prune(self, now: float) -> None:
        expired = [
            key
            for key, made in self._hits.items()
            if not any(now - mark < self._window for mark in made)
        ]
        for key in expired:
            del self._hits[key]


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Enforce the shared limiter ahead of the AI routes."""

    def __init__(self, app, limiter: RateLimiter | None = None) -> None:
        super().__init__(app)
        self._limiter = limiter if limiter is not None else RateLimiter()

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        prefix = limited_prefix(request.url.path)
        if prefix is None:
            return await call_next(request)
        allowed, retry_after = self._limiter.check(
            (client_ip(request), prefix), time.monotonic()
        )
        if not allowed:
            return JSONResponse(
                {'detail': RATE_LIMIT_MESSAGE},
                status_code=429,
                headers={'Retry-After': str(int(retry_after) + 1)},
            )
        return await call_next(request)
