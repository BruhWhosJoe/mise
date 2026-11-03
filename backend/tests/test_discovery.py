"""Discovery tests: pure validation plus mocked orchestration."""

import asyncio

import pytest

from app import catalog_cache, discovery
from app.discovery import (
    parse_model_output,
    serialize_candidate,
    validate_question,
    validate_recommendations,
)
from app.model_client import ModelClient, ModelOutputError
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
                _record('1', title='Floodplains of DC'),
                _record('2', title='Bird counts'),
            ],
            total=2,
        )

    async def fake_complete(self, **kwargs):
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
    assert response.recommendations[0].record.title == 'Floodplains of DC'
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
            [_record('1', title='Floodplains of DC')], total=1
        )

    async def fake_complete(self, **kwargs):
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
