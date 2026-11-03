"""Route tests with a mocked MCP service (no network access)."""

import pytest
from fastapi.testclient import TestClient

from app import discovery as discovery_service
from app import mcp_service
from app import model_client
from app import recipe as recipe_service
from app.main import create_app
from app.models import (
    DiscoveryCoverage,
    DiscoveryResponse,
    Interpretation,
    MCPToolInfo,
    RecipeCoverage,
    RecipeResponse,
)


@pytest.fixture(name='client')
def client_fixture():
    return TestClient(create_app())


def test_health_reports_backend_running(client):
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok', 'service': 'mise-backend'}


def test_status_reports_tools_when_reachable(client, monkeypatch):
    async def fake_discover():
        return [
            MCPToolInfo(
                name='get_metadata_catalog',
                description='catalog',
                input_schema={'type': 'object'},
            )
        ]

    monkeypatch.setattr(mcp_service, 'discover_tools', fake_discover)
    response = client.get('/api/catalog/status')
    assert response.status_code == 200
    body = response.json()
    assert body['reachable'] is True
    assert body['error'] is None
    assert [tool['name'] for tool in body['tools']] == [
        'get_metadata_catalog'
    ]


def test_status_reports_unreachable_without_failing(client, monkeypatch):
    async def fake_discover():
        raise mcp_service.MCPUnavailableError('metadata service is unreachable')

    monkeypatch.setattr(mcp_service, 'discover_tools', fake_discover)
    response = client.get('/api/catalog/status')
    assert response.status_code == 200
    body = response.json()
    assert body['reachable'] is False
    assert body['tools'] == []
    assert 'unreachable' in body['error']


def test_preview_returns_page_and_pagination(client, monkeypatch):
    seen = {}

    async def fake_page(offset, limit, fields=None):
        seen['offset'] = offset
        seen['limit'] = limit
        return {
            'records': [
                {'id': 'a', 'title': 'Alpha'},
                {'id': 'b', 'title': 'Beta'},
            ],
            'has_more': True,
            'next_offset': 2,
            'total_records': 50,
        }

    monkeypatch.setattr(mcp_service, 'fetch_catalog_page', fake_page)
    response = client.get('/api/catalog/preview?offset=0&limit=2')
    assert response.status_code == 200
    body = response.json()
    assert seen == {'offset': 0, 'limit': 2}
    assert body['offset'] == 0
    assert body['limit'] == 2
    assert body['returned'] == 2
    assert [record['title'] for record in body['records']] == [
        'Alpha',
        'Beta',
    ]
    assert body['has_more'] is True
    assert body['next_offset'] == 2
    assert body['total_records'] == 50


def test_preview_applies_default_limit(client, monkeypatch):
    seen = {}

    async def fake_page(offset, limit, fields=None):
        seen['limit'] = limit
        return {'records': []}

    monkeypatch.setattr(mcp_service, 'fetch_catalog_page', fake_page)
    response = client.get('/api/catalog/preview')
    assert response.status_code == 200
    assert seen['limit'] == 20


def test_preview_requests_explicit_card_fields(client, monkeypatch):
    seen = {}

    async def fake_page(offset, limit, fields=None):
        seen['fields'] = fields
        return {'rows': []}

    monkeypatch.setattr(mcp_service, 'fetch_catalog_page', fake_page)
    response = client.get('/api/catalog/preview?limit=10')
    assert response.status_code == 200
    assert seen['fields'] is not None
    for required in (
        'AssignedID',
        'Title',
        'LayerList',
        'Summary',
        'Description',
        'Tags',
        'PortalName',
        'OrganizationName',
        'PortalItemType',
        'UpdateDate',
        'ModifiedDate',
        'TemporalRange',
        'AccessURL',
        'ServiceEndpointURL',
        'DownloadURL',
        'UseLimitations',
        'AccessConstraints',
        'Extent',
        'CoordinateSystemCode',
    ):
        assert required in seen['fields']


@pytest.mark.parametrize('query', ['offset=-1', 'limit=0', 'limit=101'])
def test_preview_rejects_bad_pagination(client, query):
    response = client.get(f'/api/catalog/preview?{query}')
    assert response.status_code == 422


@pytest.mark.parametrize(
    'error,status',
    [
        (mcp_service.MCPTimeoutError('timed out'), 504),
        (mcp_service.MCPUnavailableError('down'), 503),
        (mcp_service.MCPToolError('get_metadata_catalog', 'boom'), 502),
        (mcp_service.MCPMalformedError('weird'), 502),
        (mcp_service.MCPError('other'), 502),
    ],
)
def test_preview_maps_upstream_failures(client, monkeypatch, error, status):
    async def fake_page(offset, limit, fields=None):
        raise error

    monkeypatch.setattr(mcp_service, 'fetch_catalog_page', fake_page)
    response = client.get('/api/catalog/preview?limit=5')
    assert response.status_code == status
    assert response.json()['detail']


def test_detail_returns_exact_match_with_raw(client, monkeypatch):
    async def fake_layers(layer_ids, fields=None):
        assert layer_ids == ['CA-123']
        return {
            'records': [
                {
                    'LayerID': 'CA-123',
                    'Title': 'Floodplains',
                    'custom': 'preserved',
                }
            ]
        }

    monkeypatch.setattr(mcp_service, 'fetch_layer_metadata', fake_layers)
    response = client.get('/api/catalog/datasets/CA-123')
    assert response.status_code == 200
    body = response.json()
    assert body['assigned_id'] == 'CA-123'
    assert body['record']['title'] == 'Floodplains'
    assert body['record']['raw']['custom'] == 'preserved'


@pytest.mark.parametrize(
    'payload',
    [
        {'records': []},
        {'records': [{'id': 'other-id', 'title': 'Wrong one'}]},
        {'records': 'not-a-list'},
    ],
)
def test_detail_returns_404_without_exact_match(
    client, monkeypatch, payload
):
    async def fake_layers(layer_ids, fields=None):
        return payload

    monkeypatch.setattr(mcp_service, 'fetch_layer_metadata', fake_layers)
    response = client.get('/api/catalog/datasets/CA-999')
    assert response.status_code == 404


def test_detail_maps_unavailable_service(client, monkeypatch):
    async def fake_layers(layer_ids, fields=None):
        raise mcp_service.MCPUnavailableError('metadata service is unreachable')

    monkeypatch.setattr(mcp_service, 'fetch_layer_metadata', fake_layers)
    response = client.get('/api/catalog/datasets/CA-123')
    assert response.status_code == 503


def _discovery_response():
    return DiscoveryResponse(
        question='floods?',
        interpretation=Interpretation(goal='Assess risk.', assumptions=[]),
        recommendations=[],
        gaps=['No matches retrieved.'],
        coverage=DiscoveryCoverage(records_retrieved=10),
        partial=False,
    )


def test_discovery_search_success(client, monkeypatch):
    async def fake_run(question):
        assert question == 'floods?'
        return _discovery_response()

    monkeypatch.setattr(discovery_service, 'run_discovery', fake_run)
    response = client.post('/api/discovery/search', json={'question': 'floods?'})
    assert response.status_code == 200
    body = response.json()
    assert body['question'] == 'floods?'
    assert body['recommendations'] == []


def test_discovery_search_rejects_bad_question(client, monkeypatch):
    async def fake_run(question):
        raise ValueError('question must not be empty')

    monkeypatch.setattr(discovery_service, 'run_discovery', fake_run)
    response = client.post('/api/discovery/search', json={'question': '  '})
    assert response.status_code == 422


@pytest.mark.parametrize(
    'error,status,code',
    [
        (model_client.ModelNotConfiguredError('set key'), 503, 'ai_not_configured'),
        (model_client.ModelAuthError('bad key'), 502, 'model_auth_failed'),
        (model_client.ModelRateLimitError('slow'), 429, 'model_rate_limited'),
        (model_client.ModelTimeoutError('slow'), 504, 'model_timeout'),
        (model_client.ModelOutputError('bad json'), 502, 'model_output_invalid'),
        (model_client.ModelUpstreamError('5xx'), 502, 'model_upstream'),
    ],
)
def test_discovery_search_maps_model_failures(
    client, monkeypatch, error, status, code
):
    async def fake_run(question):
        raise error

    monkeypatch.setattr(discovery_service, 'run_discovery', fake_run)
    response = client.post('/api/discovery/search', json={'question': 'q'})
    assert response.status_code == status
    assert response.json()['detail']['code'] == code


def test_discovery_search_maps_mcp_failure(client, monkeypatch):
    async def fake_run(question):
        raise mcp_service.MCPUnavailableError('metadata service is unreachable')

    monkeypatch.setattr(discovery_service, 'run_discovery', fake_run)
    response = client.post('/api/discovery/search', json={'question': 'q'})
    assert response.status_code == 503


def _recipe_response():
    return RecipeResponse(
        question='floods?',
        dataset_ids=['1'],
        datasets=[],
        objective='Assess exposure.',
        contributions=[],
        workflow=[],
        combinations=[],
        gaps=[],
        limitations=[],
        outputs=[],
        generated_at='2026-11-02T00:00:00+00:00',
        coverage=RecipeCoverage(
            datasets_requested=1, datasets_resolved=1, metadata_complete=True
        ),
    )


def test_recipe_generate_success(client, monkeypatch):
    async def fake_generate(question, dataset_ids):
        assert dataset_ids == ['1']
        return _recipe_response()

    monkeypatch.setattr(recipe_service, 'generate_recipe', fake_generate)
    response = client.post(
        '/api/recipe/generate', json={'question': 'floods?', 'dataset_ids': ['1']}
    )
    assert response.status_code == 200
    assert response.json()['objective'] == 'Assess exposure.'


def test_recipe_generate_rejects_bad_selection(client, monkeypatch):
    async def fake_generate(question, dataset_ids):
        raise ValueError('select at least one dataset')

    monkeypatch.setattr(recipe_service, 'generate_recipe', fake_generate)
    response = client.post(
        '/api/recipe/generate', json={'question': 'floods?', 'dataset_ids': []}
    )
    assert response.status_code == 422


def test_recipe_generate_maps_not_configured(client, monkeypatch):
    async def fake_generate(question, dataset_ids):
        raise model_client.ModelNotConfiguredError('set key')

    monkeypatch.setattr(recipe_service, 'generate_recipe', fake_generate)
    response = client.post(
        '/api/recipe/generate', json={'question': 'floods?', 'dataset_ids': ['1']}
    )
    assert response.status_code == 503
    assert response.json()['detail']['code'] == 'ai_not_configured'
