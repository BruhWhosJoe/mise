"""Rate limiter tests: pure window logic plus middleware integration."""

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app import discovery as discovery_service
from app.main import create_app
from app.models import DiscoveryCoverage, DiscoveryResponse, Interpretation
from app.rate_limit import (
    RATE_LIMIT_MESSAGE,
    RateLimiter,
    client_ip,
    limited_prefix,
)


@pytest.fixture(name='client')
def client_fixture():
    return TestClient(create_app())


def test_limited_prefix_matches_ai_routes_only():
    assert limited_prefix('/api/discovery/search') == '/api/discovery'
    assert limited_prefix('/api/recipe/generate') == '/api/recipe'
    assert limited_prefix('/api/chat/message') == '/api/chat'
    assert limited_prefix('/api/health') is None
    assert limited_prefix('/api/catalog/search') is None
    assert limited_prefix('/api/discoveryx') is None
    assert limited_prefix('/') is None


def _request(headers=None, client=None):
    return Request(
        {
            'type': 'http',
            'method': 'GET',
            'path': '/',
            'headers': headers or [],
            'client': client,
        }
    )


def test_client_ip_prefers_forwarded_header():
    forwarded = _request(
        headers=[(b'x-forwarded-for', b'203.0.113.9, 70.0.0.1')],
        client=('10.0.0.1', 1234),
    )
    assert client_ip(forwarded) == '203.0.113.9'
    direct = _request(client=('10.0.0.1', 1234))
    assert client_ip(direct) == '10.0.0.1'
    assert client_ip(_request()) == 'unknown'


def test_limiter_allows_eight_per_minute_per_key():
    limiter = RateLimiter(max_requests=8, window_seconds=60.0)
    for index in range(8):
        allowed, _ = limiter.check(('ip', '/api/chat'), float(index))
        assert allowed is True
    allowed, retry_after = limiter.check(('ip', '/api/chat'), 8.0)
    assert allowed is False
    assert retry_after == pytest.approx(52.0)
    # Other IPs and prefixes are unaffected.
    assert limiter.check(('other', '/api/chat'), 8.0)[0] is True
    assert limiter.check(('ip', '/api/recipe'), 8.0)[0] is True
    # The window slides: the first hit expires at t=60.
    assert limiter.check(('ip', '/api/chat'), 60.0)[0] is True


def test_middleware_denies_the_ninth_request_per_minute(client, monkeypatch):
    async def fake_run(question):
        return DiscoveryResponse(
            question=question,
            interpretation=Interpretation(goal='g', assumptions=[]),
            recommendations=[],
            gaps=[],
            coverage=DiscoveryCoverage(records_retrieved=0),
            partial=False,
        )

    monkeypatch.setattr(discovery_service, 'run_discovery', fake_run)
    for _ in range(8):
        response = client.post('/api/discovery/search', json={'question': 'q'})
        assert response.status_code == 200
    denied = client.post('/api/discovery/search', json={'question': 'q'})
    assert denied.status_code == 429
    assert denied.json() == {'detail': RATE_LIMIT_MESSAGE}
    assert 'Retry-After' in denied.headers
    # A different client IP gets its own budget.
    other = client.post(
        '/api/discovery/search',
        json={'question': 'q'},
        headers={'X-Forwarded-For': '203.0.113.9'},
    )
    assert other.status_code == 200
    # Unlimited routes are untouched.
    assert client.get('/api/health').status_code == 200
