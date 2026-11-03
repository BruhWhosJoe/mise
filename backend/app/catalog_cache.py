"""Bounded, TTL-cached full-catalog retrieval for AI discovery.

Discovery must consider the whole catalog, not just the browser's visible
page, but re-pulling 1,660+ records per question would be slow and rude to
the shared MCP server. This module fetches every page once (following the
server's ``has_more``/``next_offset`` contract with loop guards) and reuses
the snapshot until ``MF_CATALOG_CACHE_SECONDS`` (default 900) expires.

Capacity is bounded by ``MF_CATALOG_CACHE_MAX_RECORDS`` (default 5000):
retrieval stops there and reports ``complete=False`` so callers never imply
the whole catalog was considered when it was not.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

from . import mcp_service, normalize
from .config import PREVIEW_FIELDS, get_settings
from .models import CatalogRecord

logger = logging.getLogger(__name__)


@dataclass
class CatalogSnapshot:
    records: list[CatalogRecord]
    catalog_total: int | None
    complete: bool
    notes: list[str] = field(default_factory=list)
    fetched_at: float = 0.0


_CACHE: CatalogSnapshot | None = None
_LOCK = asyncio.Lock()


def clear_catalog_cache() -> None:
    """Drop the cached snapshot (used by tests and the smoke script)."""
    global _CACHE
    _CACHE = None


def _fresh_enough(snapshot: CatalogSnapshot, ttl_seconds: int) -> bool:
    return (time.monotonic() - snapshot.fetched_at) < max(ttl_seconds, 1)


async def get_catalog_snapshot(*, force_refresh: bool = False) -> CatalogSnapshot:
    """Return the cached catalog snapshot, refreshing past expiry."""
    global _CACHE
    settings = get_settings()
    cached = _CACHE
    if (
        not force_refresh
        and cached is not None
        and _fresh_enough(cached, settings.catalog_cache_seconds)
    ):
        return cached
    async with _LOCK:
        cached = _CACHE
        if (
            not force_refresh
            and cached is not None
            and _fresh_enough(cached, settings.catalog_cache_seconds)
        ):
            return cached
        _CACHE = await _fetch_all()
        return _CACHE


async def _fetch_all() -> CatalogSnapshot:
    settings = get_settings()
    page_size = max(1, min(settings.catalog_page_size, 100))
    max_records = max(1, settings.catalog_cache_max_records)
    max_pages = (max_records // page_size) + 3

    records: list[CatalogRecord] = []
    seen_ids: set[str] = set()
    seen_offsets: set[int] = set()
    notes: list[str] = []
    catalog_total: int | None = None
    complete = False
    offset = 0
    pages = 0

    while True:
        if offset in seen_offsets:
            notes.append(
                f'server repeated offset {offset}; stopped to avoid a loop'
            )
            break
        if pages >= max_pages:
            notes.append(f'stopped after {pages} pages (safety bound)')
            break
        seen_offsets.add(offset)
        pages += 1
        try:
            # Request the same card fields as the preview route (including
            # AccessURL/ServiceEndpointURL/DownloadURL): discovery
            # recommendations reuse these cached records, so the source
            # links ride along with no per-card detail requests.
            payload = await mcp_service.fetch_catalog_page(
                offset=offset, limit=page_size, fields=list(PREVIEW_FIELDS)
            )
        except mcp_service.MCPError as exc:
            if not records:
                raise
            notes.append(f'catalog page at offset {offset} failed: {exc}')
            break
        try:
            page = normalize.normalize_preview(
                payload, offset=offset, limit=page_size
            )
        except mcp_service.MCPMalformedError as exc:
            notes.append(
                f'catalog page at offset {offset} was unusable: {exc}'
            )
            break
        if catalog_total is None:
            catalog_total = page.total_records
        for record in page.records:
            if record.assigned_id is None:
                records.append(record)
                continue
            if record.assigned_id in seen_ids:
                continue
            seen_ids.add(record.assigned_id)
            records.append(record)
            if len(records) >= max_records:
                break
        if len(records) >= max_records:
            notes.append(
                f'stopped at the configured cap of {max_records} records'
            )
            break
        if page.has_more is False:
            complete = True
            break
        if page.next_offset is not None:
            offset = page.next_offset
            continue
        if page.has_more is True:
            if page.returned <= 0:
                notes.append(
                    'server claims more records but returned none and gave '
                    'no next offset; stopping'
                )
                break
            offset = offset + page.returned
            continue
        # No pagination signal at all: only continue while a known total
        # says records remain, so we cannot loop forever.
        if (
            page.returned > 0
            and catalog_total is not None
            and offset + page.returned < catalog_total
        ):
            offset = offset + page.returned
            continue
        if page.returned == 0 and catalog_total is not None and (
            offset >= catalog_total or catalog_total == 0
        ):
            complete = True
        else:
            notes.append(
                'server gave no has_more/next_offset signal; stopped after '
                f'{pages} page(s)'
            )
        break

    return CatalogSnapshot(
        records=records,
        catalog_total=catalog_total,
        complete=complete,
        notes=notes,
        fetched_at=time.monotonic(),
    )
