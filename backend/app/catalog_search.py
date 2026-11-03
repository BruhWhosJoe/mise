"""Whole-catalog title/ID search over the bounded cached snapshot.

The Browse Catalog view pages through live MCP results, so filtering the
visible page can never honestly claim to search the catalog. This module
matches a title substring (case-insensitive) or an exact dataset ID
against every record in the TTL-cached snapshot from
:mod:`app.catalog_cache` -- the same bounded retrieval discovery uses --
and reports exactly how many records were considered.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .models import CatalogRecord

MAX_QUERY_CHARS = 500
DEFAULT_SEARCH_LIMIT = 20
MAX_SEARCH_LIMIT = 50


@dataclass
class CatalogSearchResult:
    matches: list[CatalogRecord]
    searched_records: int
    limit_applied: bool = False


def validate_query(query: object) -> str:
    """Strip and bound a catalog search query (pure, raises ValueError)."""
    if not isinstance(query, str) or not query.strip():
        raise ValueError('q must be a nonempty search string')
    cleaned = query.strip()
    if len(cleaned) > MAX_QUERY_CHARS:
        raise ValueError(
            f'q must be at most {MAX_QUERY_CHARS} characters'
        )
    return cleaned


def match_records(
    records: list[CatalogRecord], query: str, limit: int
) -> CatalogSearchResult:
    """Match an exact ID first, then title substrings (pure).

    Exact ``assigned_id`` matches come first (in catalog order), then
    case-insensitive title-substring matches, deduplicated by ID. The
    result is bounded to ``limit`` with ``limit_applied`` set when more
    matched; ``searched_records`` is always the full input size so
    callers can disclose coverage honestly.
    """
    cleaned = query.strip()
    lowered = cleaned.lower()
    exact: list[CatalogRecord] = []
    partial: list[CatalogRecord] = []
    seen: set[str] = set()
    for record in records:
        assigned = record.assigned_id
        if (
            assigned is not None
            and assigned == cleaned
            and assigned not in seen
        ):
            exact.append(record)
            seen.add(assigned)
    for record in records:
        assigned = record.assigned_id
        if assigned is not None and assigned in seen:
            continue
        title = record.title
        if title is not None and lowered in title.lower():
            partial.append(record)
            if assigned is not None:
                seen.add(assigned)
    ordered = exact + partial
    bounded = max(limit, 0)
    matches = ordered[:bounded]
    return CatalogSearchResult(
        matches=matches,
        searched_records=len(records),
        limit_applied=len(ordered) > len(matches),
    )
