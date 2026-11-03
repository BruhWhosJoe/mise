"""Normalize raw MCP catalog payloads into stable API shapes.

The remote service may use different field casings (``title`` vs ``Title``
vs ``AccessURL``), so every mapped field consults an explicit alias list and
takes the first non-empty value. Anything the server does not supply stays
missing (``None``) -- this module never invents metadata or links.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlparse

from .mcp_service import MCPMalformedError
from .models import CatalogPreviewResponse, CatalogRecord

TITLE_KEYS = (
    'title',
    'Title',
    'name',
    'Name',
    'datasetTitle',
    'dataset_title',
    'label',
    'Label',
)

DESCRIPTION_KEYS = (
    'description',
    'Description',
    'abstract',
    'Abstract',
    'summary',
    'Summary',
    'notes',
    'Notes',
)

SOURCE_KEYS = (
    'source',
    'Source',
    'publisher',
    'Publisher',
    'agency',
    'Agency',
    'organization',
    'Organization',
    'owner',
    'Owner',
)

ACCESS_URL_KEYS = (
    'AccessURL',
    'accessURL',
    'access_url',
    'accessUrl',
    'url',
    'URL',
    'link',
    'Link',
    'landingPage',
    'landing_page',
)

ID_KEYS = (
    'assigned_id',
    'assignedId',
    'AssignedID',
    'layer_id',
    'layerId',
    'LayerID',
    'id',
    'ID',
    'identifier',
    'Identifier',
)

RECORDS_KEYS = (
    'records',
    'data',
    'results',
    'items',
    'layers',
    'datasets',
    'rows',
)

PAGE_COUNT_KEYS = (
    'returned_records',
    'returnedRecords',
    'returned',
    'returned_count',
    'returnedCount',
)

SUMMARY_KEYS = (
    'Summary',
    'summary',
    'overview',
    'Overview',
)

PORTAL_KEYS = (
    'PortalName',
    'portalName',
    'portal_name',
    'Portal',
    'portal',
)

ORGANIZATION_KEYS = (
    'OrganizationName',
    'organizationName',
    'organization_name',
    'Organization',
)

ITEM_TYPE_KEYS = (
    'PortalItemType',
    'portalItemType',
    'portal_item_type',
    'ItemType',
    'itemType',
    'item_type',
    'Type',
    'type',
)

TAGS_KEYS = (
    'Tags',
    'tags',
    'keywords',
    'Keywords',
)

SERVICE_URL_KEYS = (
    'ServiceEndpointURL',
    'serviceEndpointURL',
    'service_endpoint_url',
    'ServiceURL',
    'serviceURL',
    'service_url',
    'endpoint',
    'Endpoint',
)

DOWNLOAD_URL_KEYS = (
    'DownloadURL',
    'downloadURL',
    'download_url',
    'DownloadLink',
    'downloadLink',
    'download_link',
)

UPDATE_DATE_KEYS = (
    'UpdateDate',
    'updateDate',
    'update_date',
    'LastUpdated',
    'lastUpdated',
    'last_updated',
)

MODIFIED_DATE_KEYS = (
    'ModifiedDate',
    'modifiedDate',
    'modified_date',
    'Modified',
    'modified',
)

TEMPORAL_KEYS = (
    'TemporalRange',
    'temporalRange',
    'temporal_range',
    'TemporalCoverage',
    'temporal_coverage',
)

USE_LIMITATIONS_KEYS = (
    'UseLimitations',
    'useLimitations',
    'use_limitations',
)

ACCESS_CONSTRAINTS_KEYS = (
    'AccessConstraints',
    'accessConstraints',
    'access_constraints',
)

LAYERS_KEYS = (
    'LayerList',
    'layerList',
    'layer_list',
    'Layers',
    'layers',
)

LAYER_NAME_KEYS = (
    'name',
    'Name',
    'title',
    'Title',
    'label',
    'Label',
)

COORDINATE_SYSTEM_KEYS = (
    'CoordinateSystemCode',
    'coordinateSystemCode',
    'coordinate_system_code',
    'CoordinateSystem',
    'coordinateSystem',
    'coordinate_system',
    'crs',
    'CRS',
)

HAS_MORE_KEYS = ('has_more', 'hasMore', 'more', 'has_next', 'hasNext')

NEXT_OFFSET_KEYS = ('next_offset', 'nextOffset', 'next', 'next_page', 'nextPage')

TOTAL_KEYS = (
    'total_records',
    'totalRecords',
    'total',
    'count',
    'total_count',
    'totalCount',
)


def first_present(mapping: Mapping[str, Any], keys: tuple[str, ...]) -> Any:
    """Return the first value present under any alias key, else ``None``.

    Empty strings (after stripping) do not count as present, so a later
    alias with real content still wins.
    """
    for key in keys:
        if key in mapping:
            value = mapping[key]
            if isinstance(value, str) and not value.strip():
                continue
            if value is None:
                continue
            return value
    return None


def coerce_text(value: Any) -> str | None:
    """Coerce a scalar metadata value to stripped text, else ``None``."""
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def coerce_int(value: Any) -> int | None:
    """Coerce pagination counters to int, else ``None``."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.lstrip('+-').isdigit():
            return int(stripped)
    return None


def coerce_bool(value: Any) -> bool | None:
    """Coerce has_more style flags to bool, else ``None``."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ('true', '1', 'yes'):
            return True
        if lowered in ('false', '0', 'no'):
            return False
    return None


def sanitize_url(value: Any) -> str | None:
    """Keep only absolute http/https URLs with a host; else ``None``.

    This is what makes a source link safe to render as clickable.
    """
    text = coerce_text(value)
    if text is None:
        return None
    try:
        parsed = urlparse(text)
    except ValueError:
        return None
    if parsed.scheme.lower() not in ('http', 'https'):
        return None
    if not parsed.netloc:
        return None
    return text


def locate_records(payload: Any) -> tuple[list[Mapping[str, Any]], bool]:
    """Find the record list inside a payload.

    Returns the usable mapping items plus whether a list container was
    located at all (a bare list or a list under a known key). Non-mapping
    items are skipped rather than crashing normalization.
    """
    if isinstance(payload, list):
        candidates: Any = payload
    elif isinstance(payload, Mapping):
        candidates = first_present(payload, RECORDS_KEYS)
        if not isinstance(candidates, list):
            return [], False
    else:
        return [], False
    return [item for item in candidates if isinstance(item, Mapping)], True


def extract_records(payload: Any) -> list[Mapping[str, Any]]:
    """Find the record list inside a payload.

    Accepts a bare list or a mapping holding the list under a known key.
    Non-mapping items are skipped rather than crashing normalization.
    """
    items, _located = locate_records(payload)
    return items


def parse_tags(value: Any) -> list[str] | None:
    """Split a tags value into clean tag strings, else ``None``.

    Accepts a list of scalars or a string with comma/semicolon separators.
    """
    if value is None:
        return None
    if isinstance(value, list):
        tags = [
            text for text in (coerce_text(item) for item in value) if text
        ]
        return tags or None
    text = coerce_text(value)
    if text is None:
        return None
    tags = [
        part.strip() for part in re.split(r'[;,]+', text) if part.strip()
    ]
    return tags or None


def parse_layer_names(value: Any) -> list[str] | None:
    """Read layer names from the observed LayerList shapes, else ``None``.

    Handles a JSON-encoded string, a plain string (one layer), or a list
    of strings/mappings. Anything else yields ``None``; the original value
    always survives in ``record.raw``.
    """
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            value = json.loads(stripped)
        except (json.JSONDecodeError, ValueError):
            return [stripped]
    if isinstance(value, list):
        names: list[str] = []
        for item in value:
            if isinstance(item, str):
                if item.strip():
                    names.append(item.strip())
            elif isinstance(item, Mapping):
                name = coerce_text(first_present(item, LAYER_NAME_KEYS))
                if name:
                    names.append(name)
        return names or None
    if isinstance(value, Mapping):
        name = coerce_text(first_present(value, LAYER_NAME_KEYS))
        return [name] if name else None
    return None


def normalize_record(raw: Mapping[str, Any]) -> CatalogRecord:
    """Map one raw metadata mapping to a CatalogRecord.

    The original mapping is preserved verbatim in ``record.raw``.
    """
    raw_dict = dict(raw)
    return CatalogRecord(
        assigned_id=coerce_text(first_present(raw_dict, ID_KEYS)),
        title=coerce_text(first_present(raw_dict, TITLE_KEYS)),
        description=coerce_text(first_present(raw_dict, DESCRIPTION_KEYS)),
        summary=coerce_text(first_present(raw_dict, SUMMARY_KEYS)),
        source=coerce_text(first_present(raw_dict, SOURCE_KEYS)),
        portal_name=coerce_text(first_present(raw_dict, PORTAL_KEYS)),
        organization_name=coerce_text(
            first_present(raw_dict, ORGANIZATION_KEYS)
        ),
        item_type=coerce_text(first_present(raw_dict, ITEM_TYPE_KEYS)),
        tags=parse_tags(first_present(raw_dict, TAGS_KEYS)),
        access_url=sanitize_url(first_present(raw_dict, ACCESS_URL_KEYS)),
        service_endpoint_url=sanitize_url(
            first_present(raw_dict, SERVICE_URL_KEYS)
        ),
        download_url=sanitize_url(first_present(raw_dict, DOWNLOAD_URL_KEYS)),
        update_date=coerce_text(first_present(raw_dict, UPDATE_DATE_KEYS)),
        modified_date=coerce_text(
            first_present(raw_dict, MODIFIED_DATE_KEYS)
        ),
        temporal_range=coerce_text(first_present(raw_dict, TEMPORAL_KEYS)),
        use_limitations=coerce_text(
            first_present(raw_dict, USE_LIMITATIONS_KEYS)
        ),
        access_constraints=coerce_text(
            first_present(raw_dict, ACCESS_CONSTRAINTS_KEYS)
        ),
        layer_names=parse_layer_names(first_present(raw_dict, LAYERS_KEYS)),
        coordinate_system=coerce_text(
            first_present(raw_dict, COORDINATE_SYSTEM_KEYS)
        ),
        raw=raw_dict,
    )


def normalize_preview(
    payload: Any, offset: int, limit: int
) -> CatalogPreviewResponse:
    """Build a preview page, preserving server pagination info.

    ``returned`` is the actual number of records received, which may differ
    from the requested ``limit``. Pagination fields stay ``None`` unless the
    server supplied them.

    A successful empty page is only returned when the payload is genuinely
    empty. If the server states nonzero records yet nothing usable parses --
    a stated page count with zero items, or a nonzero total with no record
    list at all -- this raises :class:`MCPMalformedError` instead of
    reporting a misleading ``returned: 0``.
    """
    items, located = locate_records(payload)
    records = [normalize_record(item) for item in items]
    envelope = payload if isinstance(payload, Mapping) else {}
    if not records:
        stated = coerce_int(first_present(envelope, PAGE_COUNT_KEYS))
        if stated is not None and stated > 0:
            raise MCPMalformedError(
                f'server reported {stated} records on this page but none '
                'could be parsed'
            )
        total = coerce_int(first_present(envelope, TOTAL_KEYS))
        if not located and total is not None and total > 0:
            raise MCPMalformedError(
                f'server reported total_records={total} but the payload has '
                'no recognizable record list'
            )
    return CatalogPreviewResponse(
        records=records,
        offset=offset,
        limit=limit,
        returned=len(records),
        has_more=coerce_bool(first_present(envelope, HAS_MORE_KEYS)),
        next_offset=coerce_int(first_present(envelope, NEXT_OFFSET_KEYS)),
        total_records=coerce_int(first_present(envelope, TOTAL_KEYS)),
    )
