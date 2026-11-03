"""Backend-only client for Meta's Muse Spark chat-completions API.

Endpoint, authentication, and model identifier follow Meta's official docs:
https://dev.meta.ai/docs/cookbook/quickstart-chat-completions and
https://dev.meta.ai/docs/protocols/chat-completions (base URL
``https://api.meta.ai/v1``, ``POST /chat/completions``, model
``muse-spark-1.3``, Bearer API-key authentication). Structured output via
``response_format`` json_schema on Chat Completions is documented at
dev.meta.ai/docs/structured-output per corroborating integrations; the
sandbox could not fetch Meta's pages directly, so ``MF_MODEL_STRUCTURED_MODE``
can fall back to ``json_object`` if the provider ever rejects a request.

The API key travels only in the Authorization header. It is never logged,
never interpolated into errors, and never leaves the backend.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any

import httpx

from .config import get_settings

logger = logging.getLogger(__name__)


class ModelError(Exception):
    """Base class for sanitized model failures (never carries secrets)."""


class ModelNotConfiguredError(ModelError):
    """AI credentials/settings are missing."""


class ModelAuthError(ModelError):
    """The provider rejected our credentials (401/403)."""


class ModelRateLimitError(ModelError):
    """The provider rate-limited us (429)."""


class ModelTimeoutError(ModelError):
    """The provider did not answer in time."""


class ModelUpstreamError(ModelError):
    """Network failure or provider 4xx/5xx (other than auth/rate-limit)."""


class ModelOutputError(ModelError):
    """Invalid JSON, schema failure, or truncated model output."""


@dataclass(frozen=True)
class ModelSettings:
    base_url: str
    chat_path: str
    name: str
    api_key: str
    timeout_seconds: float
    max_output_tokens: int
    temperature: float
    max_retries: int
    structured_mode: str


def model_settings_from_env() -> ModelSettings:
    settings = get_settings()
    return ModelSettings(
        base_url=settings.model_base_url.rstrip('/'),
        chat_path=settings.model_chat_path,
        name=settings.model_name.strip(),
        api_key=settings.model_api_key.strip(),
        timeout_seconds=settings.model_timeout_seconds,
        max_output_tokens=settings.model_max_output_tokens,
        temperature=settings.model_temperature,
        max_retries=max(0, settings.model_max_retries),
        structured_mode=settings.model_structured_mode.strip().lower(),
    )


def check_configured(settings: ModelSettings) -> None:
    """Raise an actionable error unless AI calls can be attempted."""
    missing: list[str] = []
    if not settings.api_key:
        missing.append('MF_MODEL_API_KEY')
    if not settings.base_url:
        missing.append('MF_MODEL_BASE_URL')
    if not settings.name:
        missing.append('MF_MODEL_NAME')
    if missing:
        raise ModelNotConfiguredError(
            'AI features are disabled: set '
            + ', '.join(missing)
            + ' in backend/.env (see backend/.env.example) and restart '
            'the backend.'
        )


def build_chat_body(
    settings: ModelSettings,
    *,
    system: str,
    user: str,
    schema_name: str | None = None,
    schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the chat-completions request payload (pure, key-free)."""
    body: dict[str, Any] = {
        'model': settings.name,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ],
        'temperature': settings.temperature,
        'max_tokens': settings.max_output_tokens,
    }
    mode = settings.structured_mode
    if mode == 'json_schema' and schema is not None:
        body['response_format'] = {
            'type': 'json_schema',
            'json_schema': {
                'name': schema_name or 'response',
                'schema': schema,
            },
        }
    elif mode in ('json_schema', 'json_object'):
        body['response_format'] = {'type': 'json_object'}
    return body


def _extract_json_text(content: str) -> str:
    """Strip one pair of ```json fences, if the model added them."""
    stripped = content.strip()
    if stripped.startswith('```'):
        lines = stripped.splitlines()
        lines = lines[1:]
        if lines and lines[-1].strip() == '```':
            lines = lines[:-1]
        stripped = '\n'.join(lines).strip()
    return stripped


def parse_chat_response(payload: Any) -> Any:
    """Extract parsed JSON from a chat-completions response (pure).

    Raises :class:`ModelOutputError` on truncation, empty content, invalid
    JSON, or unexpected shapes.
    """
    if not isinstance(payload, dict):
        raise ModelOutputError('model returned a non-object response')
    choices = payload.get('choices')
    if not isinstance(choices, list) or not choices:
        raise ModelOutputError('model response has no choices')
    first = choices[0]
    if not isinstance(first, dict):
        raise ModelOutputError('model response choice is malformed')
    if first.get('finish_reason') == 'length':
        raise ModelOutputError(
            'model output was truncated (finish_reason=length); '
            'raise MF_MODEL_MAX_OUTPUT_TOKENS or narrow the request'
        )
    message = first.get('message')
    if not isinstance(message, dict):
        raise ModelOutputError('model response has no message')
    content = message.get('content')
    if isinstance(content, list):
        parts = [
            block.get('text')
            for block in content
            if isinstance(block, dict)
            and isinstance(block.get('text'), str)
        ]
        content = '\n'.join(parts)
    if not isinstance(content, str) or not content.strip():
        raise ModelOutputError('model returned empty content')
    try:
        return json.loads(_extract_json_text(content))
    except (json.JSONDecodeError, ValueError) as exc:
        raise ModelOutputError(
            f'model returned invalid JSON: {exc}'
        ) from exc


def classify_http_error(
    status: int, snippet: str, secrets: tuple[str, ...] = ()
) -> ModelError:
    """Map a provider HTTP failure to a typed error (pure).

    Listed secrets are redacted from the provider snippet first, so even a
    hostile echo can never carry credentials into logs or API responses.
    """
    scrubbed = snippet.strip()[:500]
    for secret in secrets:
        if secret:
            scrubbed = scrubbed.replace(secret, '[redacted]')
    short = scrubbed[:300]
    detail = f' (provider said: {short})' if short else ''
    if status in (401, 403):
        return ModelAuthError(
            'Model authentication failed. Check MF_MODEL_API_KEY and '
            'restart the backend.' + detail
        )
    if status == 429:
        return ModelRateLimitError(
            'Model rate limit reached. Wait a little and retry.' + detail
        )
    return ModelUpstreamError(
        f'Model request failed (HTTP {status}).' + detail
    )


def _is_retryable(exc: BaseException) -> bool:
    return isinstance(
        exc,
        (ModelRateLimitError, ModelTimeoutError, ModelUpstreamError),
    )


class ModelClient:
    """Thin async wrapper: one JSON chat call with bounded retries."""

    def __init__(self, settings: ModelSettings | None = None) -> None:
        self._settings = settings or model_settings_from_env()

    async def complete_json(
        self,
        *,
        system: str,
        user: str,
        schema_name: str | None = None,
        schema: dict[str, Any] | None = None,
    ) -> Any:
        settings = self._settings
        check_configured(settings)
        url = f'{settings.base_url}{settings.chat_path}'
        body = build_chat_body(
            settings, system=system, user=user,
            schema_name=schema_name, schema=schema,
        )
        headers = {
            'Authorization': f'Bearer {settings.api_key}',
            'Content-Type': 'application/json',
        }
        timeout = httpx.Timeout(settings.timeout_seconds)
        attempts = 1 + settings.max_retries
        last_error: ModelError | None = None
        async with httpx.AsyncClient(timeout=timeout) as client:
            for attempt in range(1, attempts + 1):
                try:
                    response = await client.post(url, headers=headers, json=body)
                except httpx.TimeoutException as exc:
                    last_error = ModelTimeoutError(
                        'Model request timed out after '
                        f'{settings.timeout_seconds:g}s.'
                    )
                    logger.warning('model timeout (attempt %d)', attempt)
                except httpx.HTTPError as exc:
                    last_error = ModelUpstreamError(
                        f'Model network failure: {type(exc).__name__}.'
                    )
                    logger.warning('model network failure: %s', type(exc).__name__)
                else:
                    if response.status_code == 200:
                        try:
                            return parse_chat_response(response.json())
                        except ModelOutputError:
                            # Never retry parse problems as quota burns.
                            raise
                        except ValueError as exc:
                            raise ModelOutputError(
                                'model returned a non-JSON response'
                            ) from exc
                    snippet = ''
                    try:
                        snippet = response.text
                    except Exception:
                        snippet = ''
                    last_error = classify_http_error(
                        response.status_code,
                        snippet,
                        secrets=(settings.api_key,),
                    )
                    logger.warning(
                        'model HTTP %d (attempt %d)',
                        response.status_code,
                        attempt,
                    )
                assert last_error is not None
                if attempt >= attempts or not _is_retryable(last_error):
                    raise last_error
                await asyncio.sleep(min(2 ** (attempt - 1), 8))
        assert last_error is not None
        raise last_error
