"""Discovery tests: pure validation plus mocked orchestration."""

import asyncio
import json

import pytest

from app import catalog_cache, discovery
from app.discovery import (
    parse_model_output,
    serialize_candidate,
    validate_question,
    validate_recommendations,
)
from app.model_client import (
    ModelClient,
    ModelOutputError,
    ModelTimeoutError,
    ModelUpstreamError,
)
from app.models import CatalogRecord


def _record(id, **fields):
    values = {'assigned_id': id}
    values.update(fields)
    return CatalogRecord(**values)


def test_validate_question_bounds():
    assert validate_question('  Why floods?  ') == 'Why floods?'
    with pytest.raises(ValueError):
        validate_question('   ')
    with pytest.raises(ValueError):
        validate_question(42)
    with pytest.raises(ValueError):
        validate_question('x' * 2001)


def test_serialize_candidate_trims_long_overviews():
    record = _record('1', title='T', summary='S' * 500)
    card = serialize_candidate(record)
    assert card['assigned_id'] == '1'
    assert card['overview'].endswith(' [...]')
    assert len(card['overview']) < 500


def test_validate_recommendations_matches_and_counts():
    candidates = [_record('1'), _record('2')]
    parsed = parse_model_output(
        {
            'interpretation': {'goal': 'g', 'assumptions': []},
            'recommendations': [
                {
                    'assigned_id': '2',
                    'relevance': 'Direct',
                    'relevance_score': 92,
                    'why': 'fits',
                    'limitations': [],
                },
                {
                    'assigned_id': '2',
                    'relevance': 'direct',
                    'relevance_score': 90,
                    'why': 'again',
                    'limitations': [],
                },
                {
                    'assigned_id': 'hallucinated',
                    'relevance': 'direct',
                    'relevance_score': 99,
                    'why': 'fake',
                    'limitations': [],
                },
            ],
            'gaps': [],
        }
    )
    matches, dropped, dupes, capped = validate_recommendations(
        candidates, parsed.recommendations, cap=8
    )
    assert [record.assigned_id for record, _ in matches] == ['2']
    assert matches[0][1].relevance == 'direct'
    assert dropped == 1
    assert dupes == 1
    assert capped is False


def test_validate_recommendations_applies_cap():
    candidates = [_record('1'), _record('2'), _record('3')]
    parsed = parse_model_output(
        {
            'interpretation': {'goal': 'g', 'assumptions': []},
            'recommendations': [
                {
                    'assigned_id': rid,
                    'relevance': 'supporting',
                    'relevance_score': 70,
                    'why': 'ok',
                    'limitations': [],
                }
                for rid in ('1', '2', '3')
            ],
            'gaps': [],
        }
    )
    matches, _dropped, _dupes, capped = validate_recommendations(
        candidates, parsed.recommendations, cap=2
    )
    assert [record.assigned_id for record, _ in matches] == ['1', '2']
    assert capped is True


def test_validate_recommendations_rejects_bad_labels_and_empty_why():
    candidates = [_record('1')]
    parsed = parse_model_output(
        {
            'interpretation': {'goal': 'g', 'assumptions': []},
            'recommendations': [
                {
                    'assigned_id': '1',
                    'relevance': 'maybe',
                    'relevance_score': 50,
                    'why': 'x',
                    'limitations': [],
                }
            ],
            'gaps': [],
        }
    )
    with pytest.raises(ModelOutputError):
        validate_recommendations(candidates, parsed.recommendations, cap=8)


def test_parse_model_output_rejects_empty_goal():
    with pytest.raises(ModelOutputError):
        parse_model_output(
            {'interpretation': {'goal': '  '}, 'recommendations': []}
        )


def _recommendation_payload(**overrides):
    payload = {
        'assigned_id': '1',
        'relevance': 'direct',
        'relevance_score': 88,
        'why': 'Maps flood zones.',
        'limitations': [],
    }
    payload.update(overrides)
    return payload


def _output_payload(recommendations):
    return {
        'interpretation': {'goal': 'g', 'assumptions': []},
        'recommendations': recommendations,
        'gaps': [],
    }


def test_parse_model_output_rejects_missing_score():
    rec = _recommendation_payload()
    del rec['relevance_score']
    with pytest.raises(ModelOutputError):
        parse_model_output(_output_payload([rec]))


@pytest.mark.parametrize('score', [-1, 101, 150])
def test_parse_model_output_rejects_out_of_range_scores(score):
    with pytest.raises(ModelOutputError):
        parse_model_output(
            _output_payload([_recommendation_payload(relevance_score=score)])
        )


@pytest.mark.parametrize('score', [True, False, 'high', 85.5, None, [90]])
def test_parse_model_output_rejects_non_integer_scores(score):
    with pytest.raises(ModelOutputError):
        parse_model_output(
            _output_payload([_recommendation_payload(relevance_score=score)])
        )


@pytest.mark.parametrize('score', [0, 85, 100])
def test_parse_model_output_accepts_score_bounds(score):
    parsed = parse_model_output(
        _output_payload([_recommendation_payload(relevance_score=score)])
    )
    assert parsed.recommendations[0].relevance_score == score


def test_parse_model_output_accepts_integral_float_score():
    parsed = parse_model_output(
        _output_payload([_recommendation_payload(relevance_score=85.0)])
    )
    assert parsed.recommendations[0].relevance_score == 85


def test_validate_recommendations_rejects_unknown_ids_without_scores():
    # Unknown IDs are dropped (and counted) before score checks run, so a
    # hallucinated ID can never smuggle in a score.
    candidates = [_record('1')]
    parsed = parse_model_output(
        _output_payload(
            [
                _recommendation_payload(
                    assigned_id='hallucinated', relevance_score=99
                ),
                _recommendation_payload(
                    assigned_id='1', relevance_score=70
                ),
            ]
        )
    )
    matches, dropped, _dupes, _capped = validate_recommendations(
        candidates, parsed.recommendations, cap=8
    )
    assert dropped == 1
    assert [record.assigned_id for record, _ in matches] == ['1']
    assert matches[0][1].relevance_score == 70


def _snapshot(records, complete=True, total=None):
    return catalog_cache.CatalogSnapshot(
        records=records,
        catalog_total=total,
        complete=complete,
        notes=[] if complete else ['stopped early'],
        fetched_at=0.0,
    )


def _run(coro):
    return asyncio.run(coro)


def test_run_discovery_success(monkeypatch):
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')

    async def fake_snapshot(**kwargs):
        return _snapshot(
            [
                _record('1', title='Flood risk zones'),
                _record('2', title='Bird counts'),
            ],
            total=2,
        )

    async def fake_complete(self, **kwargs):
        if kwargs.get('schema_name') == 'expansion':
            return {'keywords': ['inundation'], 'place': ['DC']}
        return {
            'interpretation': {'goal': 'Assess flood risk.', 'assumptions': []},
            'recommendations': [
                {
                    'assigned_id': '1',
                    'relevance': 'direct',
                    'relevance_score': 92,
                    'why': 'Maps flood zones.',
                    'limitations': ['2009 vintage.'],
                }
            ],
            'gaps': ['No parcel-level damage data retrieved.'],
        }

    monkeypatch.setattr(
        catalog_cache, 'get_catalog_snapshot', fake_snapshot
    )
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    response = _run(discovery.run_discovery('flood risk in DC'))
    assert response.question == 'flood risk in DC'
    assert response.interpretation.goal == 'Assess flood risk.'
    assert [rec.record.assigned_id for rec in response.recommendations] == ['1']
    assert response.recommendations[0].record.title == 'Flood risk zones'
    assert response.coverage.expanded_terms == ['inundation']
    assert response.coverage.expansion_fallback is False
    assert response.recommendations[0].relevance == 'direct'
    assert response.recommendations[0].relevance_score == 92
    assert response.coverage.records_retrieved == 2
    assert response.coverage.retrieval_complete is True
    assert response.coverage.candidates_evaluated == 1
    assert response.partial is False


def test_run_discovery_empty_matches_is_not_an_error(monkeypatch):
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')

    async def fake_snapshot(**kwargs):
        return _snapshot([_record('1', title='Bird counts')], total=1)

    async def fake_complete(self, **kwargs):
        return {
            'interpretation': {'goal': 'Find zoning maps.', 'assumptions': []},
            'recommendations': [],
            'gaps': ['No zoning records retrieved.'],
        }

    monkeypatch.setattr(
        catalog_cache, 'get_catalog_snapshot', fake_snapshot
    )
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    response = _run(discovery.run_discovery('zoning maps'))
    assert response.recommendations == []
    assert response.partial is False


def test_run_discovery_repairs_missing_score(monkeypatch):
    # A missing score is a model-output failure, never a silent zero: the
    # first response is rejected and the repair attempt supplies the score.
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')
    calls = []

    async def fake_snapshot(**kwargs):
        return _snapshot(
            [
                _record('1', title='Flood risk zones'),
                _record('2', title='Bird counts'),
            ],
            total=2,
        )

    async def fake_complete(self, **kwargs):
        if kwargs.get('schema_name') == 'expansion':
            return {'keywords': ['inundation'], 'place': []}
        calls.append(kwargs.get('user', ''))
        if len(calls) == 1:
            return {
                'interpretation': {'goal': 'g', 'assumptions': []},
                'recommendations': [
                    {
                        'assigned_id': '1',
                        'relevance': 'direct',
                        'why': 'Maps flood zones.',
                        'limitations': [],
                    }
                ],
                'gaps': [],
            }
        return {
            'interpretation': {'goal': 'g', 'assumptions': []},
            'recommendations': [
                {
                    'assigned_id': '1',
                    'relevance': 'direct',
                    'relevance_score': 88,
                    'why': 'Maps flood zones.',
                    'limitations': [],
                }
            ],
            'gaps': [],
        }

    monkeypatch.setattr(
        catalog_cache, 'get_catalog_snapshot', fake_snapshot
    )
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    response = _run(discovery.run_discovery('flood risk in DC'))
    assert len(calls) == 2
    assert 'rejected' in calls[1]
    assert response.recommendations[0].relevance_score == 88
    assert response.coverage.expanded_terms == ['inundation']
    assert response.coverage.expansion_fallback is False


def test_run_discovery_marks_partial_retrieval(monkeypatch):
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')

    async def fake_snapshot(**kwargs):
        return _snapshot(
            [_record('1', title='Floodplains')], complete=False, total=1660
        )

    async def fake_complete(self, **kwargs):
        return {
            'interpretation': {'goal': 'g', 'assumptions': []},
            'recommendations': [],
            'gaps': [],
        }

    monkeypatch.setattr(
        catalog_cache, 'get_catalog_snapshot', fake_snapshot
    )
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    response = _run(discovery.run_discovery('floods'))
    assert response.partial is True
    assert response.coverage.retrieval_complete is False


def test_run_discovery_falls_back_when_expansion_fails(monkeypatch):
    # A dead expansion call must not kill the search: the question's own
    # terms still rank, and coverage discloses the fallback.
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')

    async def fake_snapshot(**kwargs):
        return _snapshot(
            [
                _record('1', title='Flood risk zones'),
                _record('2', title='Bird counts'),
            ],
            total=2,
        )

    async def fake_complete(self, **kwargs):
        if kwargs.get('schema_name') == 'expansion':
            raise ModelUpstreamError('expansion timed out')
        return {
            'interpretation': {'goal': 'g', 'assumptions': []},
            'recommendations': [
                {
                    'assigned_id': '1',
                    'relevance': 'direct',
                    'relevance_score': 90,
                    'why': 'Maps flood zones.',
                    'limitations': [],
                }
            ],
            'gaps': [],
        }

    monkeypatch.setattr(
        catalog_cache, 'get_catalog_snapshot', fake_snapshot
    )
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    response = _run(discovery.run_discovery('flood risk in DC'))
    assert [rec.record.assigned_id for rec in response.recommendations] == ['1']
    assert response.coverage.expanded_terms == []
    assert response.coverage.expansion_fallback is True
    assert any(
        'expansion was unavailable' in note
        for note in response.coverage.retrieval_notes
    )


def test_run_discovery_expansion_terms_add_recall(monkeypatch):
    # The expansion-only synonym reaches a record the raw question misses.
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')

    async def fake_snapshot(**kwargs):
        return _snapshot(
            [
                _record('1', title='Inundation maps'),
                _record('2', title='Bird counts'),
            ],
            total=2,
        )

    async def fake_complete(self, **kwargs):
        if kwargs.get('schema_name') == 'expansion':
            return {'keywords': ['inundation'], 'place': []}
        return {
            'interpretation': {'goal': 'g', 'assumptions': []},
            'recommendations': [
                {
                    'assigned_id': '1',
                    'relevance': 'direct',
                    'relevance_score': 90,
                    'why': 'Maps inundation.',
                    'limitations': [],
                }
            ],
            'gaps': [],
        }

    monkeypatch.setattr(
        catalog_cache, 'get_catalog_snapshot', fake_snapshot
    )
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    response = _run(discovery.run_discovery('floods'))
    assert response.coverage.candidates_evaluated == 1
    assert [rec.record.assigned_id for rec in response.recommendations] == ['1']
    assert response.coverage.expanded_terms == ['inundation']
    assert response.coverage.expansion_fallback is False


def _many_term_records(count):
    # Each record matches one distinct question term, so every record ranks
    # (no term is ubiquitous) and the first record matches two terms to win
    # the top rank deterministically.
    terms = [f'topic{i:02d}' for i in range(count)]
    records = [
        _record(str(i + 1), title=f'Dataset survey {term}')
        for i, term in enumerate(terms)
    ]
    records[0] = _record('1', title=f'Dataset survey {terms[0]} {terms[1]}')
    return terms, records


def test_run_discovery_timeout_retries_once_with_top_40(monkeypatch):
    # A timeout on the full shortlist retries automatically with the top 40
    # candidates; coverage discloses the reduced shortlist.
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')
    terms, records = _many_term_records(45)
    prompt_sizes = []

    async def fake_snapshot(**kwargs):
        return _snapshot(records, total=len(records))

    async def fake_complete(self, **kwargs):
        if kwargs.get('schema_name') == 'expansion':
            return {'keywords': [], 'place': []}
        prompt_sizes.append(len(json.loads(kwargs['user'])['candidates']))
        if len(prompt_sizes) == 1:
            raise ModelTimeoutError('timed out')
        return {
            'interpretation': {'goal': 'g', 'assumptions': []},
            'recommendations': [
                {
                    'assigned_id': '1',
                    'relevance': 'direct',
                    'relevance_score': 90,
                    'why': 'Topical survey.',
                    'limitations': [],
                }
            ],
            'gaps': [],
        }

    monkeypatch.setattr(
        catalog_cache, 'get_catalog_snapshot', fake_snapshot
    )
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    response = _run(discovery.run_discovery(' '.join(terms)))
    assert prompt_sizes == [45, 40]
    assert response.coverage.candidates_evaluated == 40
    assert [rec.record.assigned_id for rec in response.recommendations] == ['1']
    assert any(
        'retried once with the top 40' in note
        for note in response.coverage.retrieval_notes
    )


def test_run_discovery_timeout_without_reduction_reraises(monkeypatch):
    # A shortlist already at 40 or fewer has nothing to shed: the timeout
    # propagates so the route can report it.
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')
    calls = []

    async def fake_snapshot(**kwargs):
        return _snapshot(
            [
                _record('1', title='Flood risk zones'),
                _record('2', title='Bird counts'),
            ],
            total=2,
        )

    async def fake_complete(self, **kwargs):
        if kwargs.get('schema_name') == 'expansion':
            return {'keywords': [], 'place': []}
        calls.append(kwargs)
        raise ModelTimeoutError('timed out')

    monkeypatch.setattr(
        catalog_cache, 'get_catalog_snapshot', fake_snapshot
    )
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    with pytest.raises(ModelTimeoutError):
        _run(discovery.run_discovery('flood risk'))
    assert len(calls) == 1


def test_run_discovery_timeout_on_retry_fails(monkeypatch):
    # The fallback is a single retry: a second timeout is the final answer.
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')
    terms, records = _many_term_records(45)
    calls = []

    async def fake_snapshot(**kwargs):
        return _snapshot(records, total=len(records))

    async def fake_complete(self, **kwargs):
        if kwargs.get('schema_name') == 'expansion':
            return {'keywords': [], 'place': []}
        calls.append(kwargs)
        raise ModelTimeoutError('timed out')

    monkeypatch.setattr(
        catalog_cache, 'get_catalog_snapshot', fake_snapshot
    )
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    with pytest.raises(ModelTimeoutError):
        _run(discovery.run_discovery(' '.join(terms)))
    assert len(calls) == 2
