"""Catalog cache tests with a mocked MCP service (no network)."""

import asyncio

import pytest

from app import catalog_cache, mcp_service


@pytest.fixture(autouse=True)
def _clear_cache():
    catalog_cache.clear_catalog_cache()
    yield
    catalog_cache.clear_catalog_cache()


def _run(coro):
    return asyncio.run(coro)


def _page(rows, offset, total, has_more=True):
    return {
        'rows': rows,
        'offset': offset,
        'total_records': total,
        'has_more': has_more,
        'next_offset': offset + len(rows) if has_more else offset,
    }


def test_cache_follows_pages_until_done(monkeypatch):
    calls = []

    async def fake_page(offset, limit, fields=None):
        calls.append(offset)
        if offset == 0:
            return _page(
                [{'AssignedID': '1'}, {'AssignedID': '2'}], 0, 3
            )
        return {
            'rows': [{'AssignedID': '3'}],
            'offset': 2,
            'total_records': 3,
            'has_more': False,
            'next_offset': 2,
        }

    monkeypatch.setattr(mcp_service, 'fetch_catalog_page', fake_page)
    snapshot = _run(catalog_cache.get_catalog_snapshot())
    assert [record.assigned_id for record in snapshot.records] == [
        '1',
        '2',
        '3',
    ]
    assert snapshot.catalog_total == 3
    assert snapshot.complete is True
    assert calls == [0, 2]


def test_cache_dedupes_ids_and_stops_on_repeated_offset(monkeypatch):
    calls = []

    async def fake_page(offset, limit, fields=None):
        calls.append(offset)
        return {
            'rows': [{'AssignedID': '1'}],
            'offset': offset,
            'total_records': 99,
            'has_more': True,
            'next_offset': offset,
        }

    monkeypatch.setattr(mcp_service, 'fetch_catalog_page', fake_page)
    snapshot = _run(catalog_cache.get_catalog_snapshot())
    assert [record.assigned_id for record in snapshot.records] == ['1']
    assert snapshot.complete is False
    assert any('repeated offset' in note for note in snapshot.notes)


def test_cache_first_page_failure_propagates(monkeypatch):
    async def fake_page(offset, limit, fields=None):
        raise mcp_service.MCPUnavailableError('down')

    monkeypatch.setattr(mcp_service, 'fetch_catalog_page', fake_page)
    with pytest.raises(mcp_service.MCPUnavailableError):
        _run(catalog_cache.get_catalog_snapshot())


def test_cache_later_page_failure_goes_partial(monkeypatch):
    async def fake_page(offset, limit, fields=None):
        if offset == 0:
            return _page([{'AssignedID': '1'}], 0, 99)
        raise mcp_service.MCPTimeoutError('slow')

    monkeypatch.setattr(mcp_service, 'fetch_catalog_page', fake_page)
    snapshot = _run(catalog_cache.get_catalog_snapshot())
    assert [record.assigned_id for record in snapshot.records] == ['1']
    assert snapshot.complete is False
    assert snapshot.notes


def test_cache_requests_card_fields_for_source_urls(monkeypatch):
    seen = {}

    async def fake_page(offset, limit, fields=None):
        seen['fields'] = fields
        return {
            'rows': [{'AssignedID': '1'}],
            'offset': 0,
            'total_records': 1,
            'has_more': False,
            'next_offset': 0,
        }

    monkeypatch.setattr(mcp_service, 'fetch_catalog_page', fake_page)
    _run(catalog_cache.get_catalog_snapshot())
    assert seen['fields'] is not None
    for required in ('AccessURL', 'ServiceEndpointURL', 'DownloadURL'):
        assert required in seen['fields']


def test_cache_reuses_snapshot_until_forced(monkeypatch):
    calls = []

    async def fake_page(offset, limit, fields=None):
        calls.append(offset)
        return {
            'rows': [{'AssignedID': '1'}],
            'offset': 0,
            'total_records': 1,
            'has_more': False,
            'next_offset': 0,
        }

    monkeypatch.setattr(mcp_service, 'fetch_catalog_page', fake_page)
    first = _run(catalog_cache.get_catalog_snapshot())
    second = _run(catalog_cache.get_catalog_snapshot())
    assert first is second
    assert calls == [0]
    third = _run(catalog_cache.get_catalog_snapshot(force_refresh=True))
    assert third is not first
    assert calls == [0, 0]
