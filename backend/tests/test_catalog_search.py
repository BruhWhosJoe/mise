"""Catalog search tests plus source-URL propagation regression tests."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app import catalog_cache, catalog_search, mcp_service, recipe
from app.catalog_search import match_records, validate_query
from app.config import PREVIEW_FIELDS
from app.main import create_app
from app.model_client import ModelClient
from app.models import CatalogRecord


@pytest.fixture(name='client')
def client_fixture():
    return TestClient(create_app())


def _record(id, **fields):
    values = {'assigned_id': id}
    values.update(fields)
    return CatalogRecord(**values)


def _snapshot(records, complete=True, total=None, notes=()):
    return catalog_cache.CatalogSnapshot(
        records=records,
        catalog_total=total,
        complete=complete,
        notes=list(notes),
        fetched_at=0.0,
    )


def test_validate_query_bounds():
    assert validate_query('  Floods  ') == 'Floods'
    with pytest.raises(ValueError):
        validate_query('   ')
    with pytest.raises(ValueError):
        validate_query(None)
    with pytest.raises(ValueError):
        validate_query('x' * 501)


def test_match_records_exact_id_first_then_title_substring():
    records = [
        _record('A-2', title='Floodplains of DC'),
        _record('A-1', title='A-1 downstream gauges'),
        _record('B-9', title='Bird counts'),
    ]
    found = match_records(records, 'A-1', 20)
    assert [hit.assigned_id for hit in found.matches] == ['A-1']
    assert found.searched_records == 3
    assert found.limit_applied is False
    found = match_records(records, 'flood', 20)
    assert [hit.assigned_id for hit in found.matches] == ['A-2']
    # Case-insensitive title matching.
    found = match_records(records, 'BIRD', 20)
    assert [hit.assigned_id for hit in found.matches] == ['B-9']


def test_match_records_dedupes_and_bounds():
    records = [
        _record('A-1', title='Flood maps'),
        _record('A-1', title='Flood maps duplicate'),
        _record('A-2', title='Flood gauges'),
    ]
    found = match_records(records, 'flood', 20)
    assert [hit.assigned_id for hit in found.matches] == ['A-1', 'A-2']
    assert found.searched_records == 3
    found = match_records(records, 'flood', 1)
    assert [hit.assigned_id for hit in found.matches] == ['A-1']
    assert found.limit_applied is True
    assert match_records(records, 'zoning', 20).matches == []


def test_search_route_reports_honest_coverage(client, monkeypatch):
    async def fake_snapshot(**kwargs):
        return _snapshot(
            [
                _record('A-1', title='Floodplains of DC'),
                _record('B-2', title='Bird counts'),
            ],
            complete=False,
            total=1660,
            notes=['stopped early'],
        )

    monkeypatch.setattr(
        catalog_cache, 'get_catalog_snapshot', fake_snapshot
    )
    response = client.get('/api/catalog/search?q=flood&limit=20')
    assert response.status_code == 200
    body = response.json()
    assert body['query'] == 'flood'
    assert body['returned'] == 1
    assert [hit['assigned_id'] for hit in body['records']] == ['A-1']
    assert body['searched_records'] == 2
    assert body['catalog_total'] == 1660
    assert body['retrieval_complete'] is False
    assert body['retrieval_notes'] == ['stopped early']
    assert body['limit_applied'] is False


def test_search_route_rejects_bad_input(client):
    assert client.get('/api/catalog/search').status_code == 422
    assert client.get('/api/catalog/search?q=++').status_code == 422
    assert client.get('/api/catalog/search?q=x&limit=0').status_code == 422
    assert client.get('/api/catalog/search?q=x&limit=51').status_code == 422


def test_search_route_maps_unavailable_service(client, monkeypatch):
    async def fake_snapshot(**kwargs):
        raise mcp_service.MCPUnavailableError('metadata service is unreachable')

    monkeypatch.setattr(
        catalog_cache, 'get_catalog_snapshot', fake_snapshot
    )
    response = client.get('/api/catalog/search?q=flood')
    assert response.status_code == 503


def test_detail_requests_explicit_source_url_fields(client, monkeypatch):
    seen = {}

    async def fake_layers(layer_ids, fields=None):
        seen['fields'] = fields
        return {'records': [{'AssignedID': 'CA-1', 'Title': 'T'}]}

    monkeypatch.setattr(mcp_service, 'fetch_layer_metadata', fake_layers)
    response = client.get('/api/catalog/datasets/CA-1')
    assert response.status_code == 200
    assert seen['fields'] is not None
    for required in (
        'AccessURL',
        'ServiceEndpointURL',
        'DownloadURL',
    ):
        assert required in seen['fields']
    assert seen['fields'] == list(PREVIEW_FIELDS)


def test_recipe_requests_explicit_fields_and_propagates_links(monkeypatch):
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')
    seen = {}

    async def fake_layers(layer_ids, fields=None):
        seen['fields'] = fields
        assert layer_ids == ['7']
        return {
            'rows': [
                {
                    'AssignedID': '7',
                    'Title': 'Floodplains',
                    'AccessURL': 'https://example.gov/page',
                    'ServiceEndpointURL': 'https://example.gov/service',
                    'DownloadURL': 'https://example.gov/file.zip',
                }
            ]
        }

    async def fake_complete(self, **kwargs):
        return {
            'objective': 'Assess exposure.',
            'contributions': [
                {'assigned_id': '7', 'contribution': 'Flood zones.'}
            ],
            'workflow': [
                {
                    'step': 1,
                    'title': 'Overlay',
                    'detail': 'Overlay zones on facilities.',
                    'dataset_ids': ['7'],
                }
            ],
            'combinations': [],
            'gaps': [],
            'limitations': [],
            'outputs': [],
        }

    monkeypatch.setattr(mcp_service, 'fetch_layer_metadata', fake_layers)
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    response = asyncio.run(recipe.generate_recipe('Which sites flood?', ['7']))
    for required in ('AccessURL', 'ServiceEndpointURL', 'DownloadURL'):
        assert required in seen['fields']
    (ref,) = response.datasets
    assert ref.access_url == 'https://example.gov/page'
    assert ref.service_endpoint_url == 'https://example.gov/service'
    assert ref.download_url == 'https://example.gov/file.zip'
