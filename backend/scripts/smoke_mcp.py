"""Bounded live smoke test against the real metadata MCP service.

Steps:
  1. Discover tool names and input schemas.
  2. Retrieve metadata field names and a few field definitions.
  3. Fetch one small catalog page.
  4. Fetch full metadata for one ID returned by step 3.

Run from the project root (one exact command)::

    .venv\\Scripts\\python.exe backend/scripts/smoke_mcp.py

Everything is bounded: small page sizes, one detail lookup, and the
configured MCP timeout on every call. Exits nonzero on any MCP failure.
"""

import asyncio
import json
import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

from app import mcp_service, normalize  # noqa: E402
from app.config import get_settings  # noqa: E402


def show(title, value, limit=1200):
    text = json.dumps(value, indent=2, default=str)
    if len(text) > limit:
        text = text[:limit].rstrip() + '\n... (truncated)'
    print(f'\n=== {title} ===\n{text}')


async def main() -> int:
    settings = get_settings()
    print(f'MCP URL: {settings.mcp_url}')
    print(f'timeout: {settings.mcp_timeout_seconds:g}s per call')

    try:
        tools = await mcp_service.discover_tools()
        show(
            '1. discovered tools',
            [
                {
                    'name': tool.name,
                    'description': tool.description,
                    'input_schema': tool.input_schema,
                }
                for tool in tools
            ],
        )

        fields = await mcp_service.fetch_metadata_fields()
        show('2a. raw field descriptors', fields)
        if isinstance(fields, list):
            descriptors = fields
        elif isinstance(fields, dict):
            descriptors = fields.get('fields', [])
        else:
            print(
                '\nSMOKE TEST FAILED: unexpected field-list shape: '
                f'{type(fields).__name__}'
            )
            return 1
        try:
            names = mcp_service.extract_field_names(descriptors)
        except mcp_service.MCPError as exc:
            print(f'\nSMOKE TEST FAILED: cannot use field list: {exc}')
            return 1
        sample = names[:5]
        show('2b. requesting definitions for', sample)
        if not sample:
            print(
                '\nSMOKE TEST FAILED: field list is empty; '
                'cannot request definitions.'
            )
            return 1
        definitions = await mcp_service.fetch_field_definitions(sample)
        show('2c. field definitions (sample)', definitions)

        page_payload = await mcp_service.fetch_catalog_page(
            offset=0, limit=3
        )
        show('3. raw catalog page (limit=3)', page_payload)
        page = normalize.normalize_preview(
            page_payload, offset=0, limit=3
        )
        show(
            '3b. normalized page',
            {
                'returned': page.returned,
                'has_more': page.has_more,
                'next_offset': page.next_offset,
                'total_records': page.total_records,
                'ids': [
                    record.assigned_id for record in page.records
                ],
                'titles': [record.title for record in page.records],
            },
        )
        if not page.records or not page.records[0].assigned_id:
            print('\nNo usable record ID returned; cannot run step 4.')
            return 1

        detail_id = page.records[0].assigned_id
        detail_payload = await mcp_service.fetch_layer_metadata([detail_id])
        show(f'4. raw metadata for {detail_id!r}', detail_payload)
        detail_records = [
            normalize.normalize_record(item)
            for item in normalize.extract_records(detail_payload)
        ]
        if not any(
            record.assigned_id == detail_id for record in detail_records
        ):
            print(
                '\nSMOKE TEST FAILED: detail response contains no record '
                f'for ID {detail_id!r}.'
            )
            return 1
    except mcp_service.MCPError as exc:
        print(f'\nSMOKE TEST FAILED: {exc}')
        return 1

    print('\nSMOKE TEST PASSED')
    return 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
