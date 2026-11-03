"""Remote metadata MCP service client, built on the FastMCP SDK.

Every public function opens a short-lived client session, applies a finite
timeout, and raises a sanitized :class:`MCPError` subclass on failure so
routes can map problems to honest HTTP statuses without leaking internals.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Mapping
from typing import Any

import httpx
from fastmcp import Client

from .config import get_settings
from .models import MCPToolInfo

logger = logging.getLogger(__name__)


class MCPError(Exception):
    """Base class for sanitized metadata-service failures."""


class MCPTimeoutError(MCPError):
    """The metadata service did not answer within the configured timeout."""


class MCPUnavailableError(MCPError):
    """The metadata service could not be reached (transport failure)."""


class MCPToolError(MCPError):
    """A metadata-service tool call reported an error."""

    def __init__(self, tool: str, message: str) -> None:
        super().__init__(f"tool {tool!r} failed: {message}")
        self.tool = tool


class MCPMalformedError(MCPError):
    """The metadata service answered with an unexpected response shape."""


def _summarize(exc: BaseException, limit: int = 300) -> str:
    text = f"{type(exc).__name__}: {exc}".strip()
    return text if len(text) <= limit else text[:limit].rstrip() + '...'


def is_tool_error(result: Any) -> bool:
    """Read the error flag across FastMCP/MCP result spellings."""
    flag = getattr(result, 'is_error', None)
    if flag is None:
        flag = getattr(result, 'isError', False)
    return bool(flag)


def extract_payload(result: Any) -> Any:
    """Pull a tool's data out of a FastMCP result object.

    Prefers ``.data`` (hydrated Python values), then ``structured_content``
    dicts (unwrapping a lone ``{"result": ...}`` envelope), then content
    blocks whose text may itself be JSON. Plain values pass through.
    """
    if result is None or isinstance(result, (dict, list, str, int, float)):
        return result
    data = getattr(result, 'data', None)
    if isinstance(data, (dict, list, str, int, float)):
        return data
    if data is not None:
        model_dump = getattr(data, 'model_dump', None)
        if callable(model_dump):
            try:
                return model_dump(mode='json')
            except Exception:  # fall through to structured content
                pass
    structured = getattr(result, 'structured_content', None)
    if isinstance(structured, dict):
        if set(structured.keys()) == {'result'}:
            return structured['result']
        return structured
    content = getattr(result, 'content', None)
    texts: list[str] = []
    if isinstance(content, list):
        for block in content:
            text = getattr(block, 'text', None)
            if isinstance(text, str):
                texts.append(text)
    if not texts:
        raise MCPMalformedError(
            'tool result had no structured content or text blocks'
        )
    parsed = [_maybe_json(text) for text in texts]
    return parsed[0] if len(parsed) == 1 else parsed


def _maybe_json(text: str) -> Any:
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return text


async def _call_tool(tool: str, arguments: dict[str, Any]) -> Any:
    settings = get_settings()
    try:
        async with Client(settings.mcp_url) as client:
            result = await asyncio.wait_for(
                client.call_tool(tool, arguments),
                timeout=settings.mcp_timeout_seconds,
            )
    except (asyncio.TimeoutError, TimeoutError) as exc:
        raise MCPTimeoutError(
            f'metadata service timed out after '
            f'{settings.mcp_timeout_seconds:g}s'
        ) from exc
    except MCPError:
        raise
    except (httpx.HTTPError, OSError, ConnectionError) as exc:
        logger.warning('MCP transport failure: %s', _summarize(exc))
        raise MCPUnavailableError(
            'metadata service is unreachable'
        ) from exc
    except Exception as exc:  # defensive: never leak SDK internals
        logger.warning('MCP call failure: %s', _summarize(exc))
        raise MCPError(f'metadata service request failed: {_summarize(exc)}') from exc
    if is_tool_error(result):
        try:
            detail = extract_payload(result)
        except MCPError:
            detail = 'unknown tool error'
        if not isinstance(detail, str):
            detail = json.dumps(detail, default=str)[:500]
        raise MCPToolError(tool, detail)
    try:
        return extract_payload(result)
    except MCPError:
        raise
    except Exception as exc:
        raise MCPMalformedError(
            f'could not interpret tool {tool!r} response: {_summarize(exc)}'
        ) from exc


async def discover_tools() -> list[MCPToolInfo]:
    """List tools (with schemas) offered by the metadata service."""
    settings = get_settings()
    try:
        async with Client(settings.mcp_url) as client:
            tools = await asyncio.wait_for(
                client.list_tools(), timeout=settings.mcp_timeout_seconds
            )
    except (asyncio.TimeoutError, TimeoutError) as exc:
        raise MCPTimeoutError(
            f'metadata service timed out after '
            f'{settings.mcp_timeout_seconds:g}s'
        ) from exc
    except (httpx.HTTPError, OSError, ConnectionError) as exc:
        logger.warning('MCP transport failure: %s', _summarize(exc))
        raise MCPUnavailableError(
            'metadata service is unreachable'
        ) from exc
    except Exception as exc:
        logger.warning('MCP discovery failure: %s', _summarize(exc))
        raise MCPError(
            f'metadata service discovery failed: {_summarize(exc)}'
        ) from exc
    infos: list[MCPToolInfo] = []
    for tool in tools or []:
        schema = getattr(tool, 'input_schema', None)
        if schema is None:
            # Legacy spelling only; never evaluated unless needed, since
            # accessing it emits a deprecation warning on current SDKs.
            schema = getattr(tool, 'inputSchema', None)
        parameters = getattr(tool, 'parameters', None)
        if not isinstance(schema, dict) and isinstance(parameters, dict):
            schema = parameters
        description = getattr(tool, 'description', None)
        infos.append(
            MCPToolInfo(
                name=str(getattr(tool, 'name', 'unknown')),
                description=str(description)
                if description is not None
                else None,
                input_schema=schema if isinstance(schema, dict) else None,
            )
        )
    return infos


async def fetch_catalog_page(
    offset: int,
    limit: int,
    fields: list[str] | None = None,
) -> Any:
    """Fetch one raw catalog page from the metadata service."""
    return await _call_tool(
        'get_metadata_catalog',
        {'fields': fields, 'offset': offset, 'limit': limit},
    )


async def fetch_layer_metadata(
    layer_ids: list[str], fields: list[str] | None = None
) -> Any:
    """Fetch raw metadata for explicit layer/dataset IDs."""
    return await _call_tool(
        'get_layer_metadata', {'layer_ids': layer_ids, 'fields': fields}
    )


async def fetch_metadata_fields(default_search_only: bool = False) -> Any:
    """Fetch available metadata field names from the service."""
    return await _call_tool(
        'get_metadata_fields', {'default_search_only': default_search_only}
    )


def extract_field_names(fields: Any) -> list[str]:
    """Extract validated field-name strings from a field-list response.

    Accepts plain names or descriptor objects shaped like
    ``{"fieldName": ..., "EnableDefaultSearch": ...}``. Anything else
    raises :class:`MCPMalformedError`: dictionaries are never stringified
    and malformed items never dissolve into an empty success.
    """
    if not isinstance(fields, list):
        raise MCPMalformedError(
            'expected a list of field names/descriptors, '
            f'got {type(fields).__name__}'
        )
    names: list[str] = []
    for index, item in enumerate(fields):
        if isinstance(item, str):
            if not item.strip():
                raise MCPMalformedError(
                    f'field entry #{index} is an empty name'
                )
            names.append(item.strip())
        elif isinstance(item, Mapping):
            raw_name = item.get('fieldName')
            if not isinstance(raw_name, str) or not raw_name.strip():
                raise MCPMalformedError(
                    f'field entry #{index} has no usable fieldName: '
                    f'{str(dict(item))[:200]}'
                )
            names.append(raw_name.strip())
        else:
            raise MCPMalformedError(
                f'field entry #{index} is neither a name nor a '
                f'descriptor: {type(item).__name__}'
            )
    return names


async def fetch_field_definitions(
    fields: list[str] | list[dict[str, Any]] | None = None,
) -> Any:
    """Fetch definitions for metadata fields from the service.

    Accepts plain names or raw field-descriptor objects; descriptors are
    reduced to validated ``fieldName`` strings before the request is built.
    """
    names = None if fields is None else extract_field_names(fields)
    return await _call_tool(
        'get_metadata_field_definitions', {'fields': names}
    )
