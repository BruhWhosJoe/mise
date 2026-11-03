"""Query expansion tests: pure parsing plus mocked model calls."""

import asyncio

import pytest

from app import expansion
from app.expansion import expand_query, parse_expansion_output
from app.model_client import (
    ModelClient,
    ModelOutputError,
    ModelSettings,
    ModelUpstreamError,
)


def _settings(**overrides):
    values = {
        'base_url': 'https://models.test/v1',
        'chat_path': '/chat/completions',
        'name': 'test-model',
        'api_key': 'test-key',
        'timeout_seconds': 60.0,
        'max_output_tokens': 3000,
        'temperature': 0.2,
        'max_retries': 1,
        'structured_mode': 'json_schema',
    }
    values.update(overrides)
    return ModelSettings(**values)


def test_parse_expansion_output_accepts_keywords_and_place():
    result = parse_expansion_output(
        {'keywords': ['crash', 'crosswalk'], 'place': ['Washington, DC']}
    )
    assert result.keywords == ['crash', 'crosswalk']
    assert result.place == ['Washington, DC']


def test_parse_expansion_output_tolerates_a_lone_place_string():
    result = parse_expansion_output({'keywords': [], 'place': 'DC'})
    assert result.keywords == []
    assert result.place == ['DC']


def test_parse_expansion_output_drops_blanks_dupes_and_caps():
    result = parse_expansion_output(
        {
            'keywords': ['crash', '  ', 'crash', 42, None]
            + [f'term-{index}' for index in range(30)],
            'place': ['DC', 'DC', '  '],
            'extra': 'ignored',
        }
    )
    assert result.keywords[:2] == ['crash', 'term-0']
    assert len(result.keywords) == expansion.MAX_KEYWORDS
    assert result.place == ['DC']


def test_parse_expansion_output_rejects_unusable_payloads():
    with pytest.raises(ModelOutputError):
        parse_expansion_output(['keywords'])
    with pytest.raises(ModelOutputError):
        parse_expansion_output('just text')
    with pytest.raises(ModelOutputError):
        parse_expansion_output(None)
    with pytest.raises(ModelOutputError):
        parse_expansion_output({'keywords': 'crash'})


def _run(coro):
    return asyncio.run(coro)


def test_expand_query_uses_one_small_bounded_call(monkeypatch):
    seen = {}

    async def fake_complete(self, **kwargs):
        seen['schema_name'] = kwargs.get('schema_name')
        seen['timeout'] = self._settings.timeout_seconds
        seen['tokens'] = self._settings.max_output_tokens
        seen['retries'] = self._settings.max_retries
        return {'keywords': ['crash'], 'place': ['DC']}

    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    monkeypatch.delenv('MF_EXPANSION_TIMEOUT_SECONDS', raising=False)
    result = _run(expand_query('pedestrian safety?', _settings()))
    assert result.keywords == ['crash']
    assert result.place == ['DC']
    assert seen['schema_name'] == 'expansion'
    assert seen['timeout'] == 30.0
    assert seen['tokens'] == expansion.EXPANSION_MAX_OUTPUT_TOKENS
    assert seen['retries'] == 0


def test_expand_query_keeps_tighter_configured_budgets(monkeypatch):
    seen = {}

    async def fake_complete(self, **kwargs):
        seen['timeout'] = self._settings.timeout_seconds
        seen['tokens'] = self._settings.max_output_tokens
        return {'keywords': [], 'place': []}

    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    monkeypatch.delenv('MF_EXPANSION_TIMEOUT_SECONDS', raising=False)
    _run(
        expand_query(
            'anything?',
            _settings(timeout_seconds=5.0, max_output_tokens=100),
        )
    )
    assert seen['timeout'] == 5.0
    assert seen['tokens'] == 100


def test_expand_query_timeout_is_env_configurable(monkeypatch):
    seen = {}

    async def fake_complete(self, **kwargs):
        seen['timeout'] = self._settings.timeout_seconds
        return {'keywords': [], 'place': []}

    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    monkeypatch.setenv('MF_EXPANSION_TIMEOUT_SECONDS', '12')
    _run(expand_query('anything?', _settings()))
    assert seen['timeout'] == 12.0


def test_expand_query_propagates_model_failures(monkeypatch):
    async def fake_complete(self, **kwargs):
        raise ModelUpstreamError('expansion timed out')

    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    with pytest.raises(ModelUpstreamError):
        _run(expand_query('pedestrian safety?', _settings()))
