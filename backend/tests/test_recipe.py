"""Recipe tests: pure validation plus mocked orchestration."""

import asyncio

import pytest

from app import mcp_service, recipe
from app.model_client import ModelClient, ModelOutputError
from app.models import CatalogRecord, RecipeDatasetRef
from app.recipe import (
    RECIPE_SYSTEM,
    MissingMetadataError,
    parse_model_output,
    serialize_records,
    validate_recipe_refs,
    validate_selection,
)


def _record(id, **fields):
    values = {'assigned_id': id}
    values.update(fields)
    return CatalogRecord(**values)


def test_recipe_dataset_ref_carries_authoritative_links():
    ref = RecipeDatasetRef(
        assigned_id='1',
        title='Floodplains',
        access_url='https://example.gov/page',
        service_endpoint_url='https://example.gov/service',
        download_url='https://example.gov/file.zip',
    )
    assert ref.access_url == 'https://example.gov/page'
    assert ref.service_endpoint_url == 'https://example.gov/service'
    assert ref.download_url == 'https://example.gov/file.zip'
    assert RecipeDatasetRef(assigned_id='2').service_endpoint_url is None
    assert RecipeDatasetRef(assigned_id='2').download_url is None


def test_validate_selection_cleans_and_bounds():
    assert validate_selection(['1', ' 2 ', '1'], 10) == ['1', '2']
    with pytest.raises(ValueError):
        validate_selection([], 10)
    with pytest.raises(ValueError):
        validate_selection(['  '], 10)
    with pytest.raises(ValueError):
        validate_selection([42], 10)
    with pytest.raises(ValueError):
        validate_selection(['1', '2', '3'], 2)


def test_serialize_records_marks_budget_trims():
    records = [_record('1', title='T')]
    cards, trimmed = serialize_records(records, 60000)
    assert trimmed is False
    assert cards[0]['title'] == 'T'
    big = _record('1', raw={'blob': 'x' * 5000})
    _cards, trimmed = serialize_records([big], 1000)
    assert trimmed is True


def test_validate_recipe_refs_accepts_exact_coverage():
    parsed = parse_model_output(
        {
            'objective': 'Compare flood zones with facilities.',
            'contributions': [
                {'assigned_id': '1', 'contribution': 'Zones.'},
                {'assigned_id': '2', 'contribution': 'Sites.'},
            ],
            'workflow': [
                {
                    'step': 1,
                    'title': 'Overlay',
                    'detail': 'Overlay zones on sites.',
                    'dataset_ids': ['1', '2'],
                }
            ],
            'combinations': [
                {
                    'dataset_ids': ['1', '2'],
                    'approach': 'Spatial join.',
                    'prerequisites': 'Same CRS.',
                    'uncertainty': 'Alignment unknown.',
                }
            ],
            'gaps': [],
            'limitations': [],
            'outputs': ['A map.'],
        }
    )
    validate_recipe_refs(['1', '2'], parsed)


def _full_output(**overrides):
    payload = {
        'objective': 'Assess exposure.',
        'contributions': [{'assigned_id': '1', 'contribution': 'Zones.'}],
        'workflow': [
            {
                'step': 1,
                'title': 'Overlay',
                'detail': 'Overlay zones.',
                'dataset_ids': ['1'],
            }
        ],
        'combinations': [],
        'gaps': [],
        'limitations': [],
        'outputs': [],
    }
    payload.update(overrides)
    return payload


def test_parse_model_output_rejects_omitted_contract_keys():
    for missing in (
        'workflow',
        'combinations',
        'gaps',
        'limitations',
        'outputs',
    ):
        payload = _full_output()
        del payload[missing]
        with pytest.raises(ModelOutputError):
            parse_model_output(payload)


def test_parse_model_output_accepts_explicit_empty_sections():
    parsed = parse_model_output(_full_output())
    assert parsed.combinations == []
    assert parsed.gaps == []
    assert parsed.limitations == []
    assert parsed.outputs == []


def test_parse_model_output_rejects_empty_workflow():
    with pytest.raises(ModelOutputError):
        parse_model_output(_full_output(workflow=[]))


def test_serialize_records_exposes_source_restrictions():
    label_layer = _record(
        '490',
        title='Neighborhood Labels',
        use_limitations='For label placement only; inappropriate for calculation.',
        access_constraints='None.',
    )
    cards, trimmed = serialize_records([label_layer], 60000)
    assert trimmed is False
    assert (
        cards[0]['use_limitations']
        == 'For label placement only; inappropriate for calculation.'
    )
    assert cards[0]['access_constraints'] == 'None.'


def test_recipe_prompt_constrains_restricted_layers():
    assert 'ONLY for its explicitly permitted purposes' in RECIPE_SYSTEM
    assert 'merely append a disclaimer' in RECIPE_SYSTEM
    assert 'make' in RECIPE_SYSTEM and 'prerequisite' in RECIPE_SYSTEM
    assert 'surface the conflict' in RECIPE_SYSTEM
    assert 'geometry types' in RECIPE_SYSTEM
    assert 'untrusted source data' in RECIPE_SYSTEM


def test_validate_recipe_refs_rejects_stray_and_missing():
    step = [
        {
            'step': 1,
            'title': 'Overlay',
            'detail': 'Overlay the layer.',
            'dataset_ids': ['1'],
        }
    ]
    parsed = parse_model_output(
        {
            'objective': 'o',
            'contributions': [{'assigned_id': '1', 'contribution': 'c'}],
            'workflow': step,
            'combinations': [],
            'gaps': [],
            'limitations': [],
            'outputs': [],
        }
    )
    with pytest.raises(ModelOutputError):
        validate_recipe_refs(['1', '2'], parsed)
    stray = parse_model_output(
        {
            'objective': 'o',
            'contributions': [{'assigned_id': '9', 'contribution': 'c'}],
            'workflow': step,
            'combinations': [],
            'gaps': [],
            'limitations': [],
            'outputs': [],
        }
    )
    with pytest.raises(ModelOutputError):
        validate_recipe_refs(['1'], stray)


def _run(coro):
    return asyncio.run(coro)


def _model_ok(**kwargs):
    return {
        'objective': 'Assess exposure.',
        'contributions': [
            {'assigned_id': '1', 'contribution': 'Flood zones.'},
            {'assigned_id': '2', 'contribution': 'Facilities.'},
        ],
        'workflow': [
            {
                'step': 1,
                'title': 'Overlay',
                'detail': 'Overlay zones on facilities.',
                'dataset_ids': ['1', '2'],
            }
        ],
        'combinations': [],
        'gaps': ['No parcel data.'],
        'limitations': ['Check CRS.'],
        'outputs': ['An exposure table.'],
    }


def test_generate_recipe_success(monkeypatch):
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')

    async def fake_layers(layer_ids, fields=None):
        assert layer_ids == ['1', '2']
        return {
            'rows': [
                {'AssignedID': '1', 'Title': 'Floodplains'},
                {'AssignedID': '2', 'Title': 'Facilities'},
            ]
        }

    async def fake_complete(self, **kwargs):
        return _model_ok()

    monkeypatch.setattr(mcp_service, 'fetch_layer_metadata', fake_layers)
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    response = _run(recipe.generate_recipe('Which sites flood?', ['1', '2']))
    assert response.question == 'Which sites flood?'
    assert response.objective == 'Assess exposure.'
    assert [ref.assigned_id for ref in response.datasets] == ['1', '2']
    assert response.datasets[0].title == 'Floodplains'
    assert response.coverage.metadata_complete is True
    assert response.generated_at


def test_generate_recipe_rejects_missing_metadata(monkeypatch):
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')

    async def fake_layers(layer_ids, fields=None):
        return {'rows': [{'AssignedID': '1', 'Title': 'Floodplains'}]}

    async def fail_complete(self, **kwargs):
        raise AssertionError('model must not be called')

    monkeypatch.setattr(mcp_service, 'fetch_layer_metadata', fake_layers)
    monkeypatch.setattr(ModelClient, 'complete_json', fail_complete)
    with pytest.raises(MissingMetadataError) as info:
        _run(recipe.generate_recipe('Which sites flood?', ['1', '2']))
    assert '2' in str(info.value)


def test_generate_recipe_repairs_bad_refs_once(monkeypatch):
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')
    calls = []

    async def fake_layers(layer_ids, fields=None):
        return {'rows': [{'AssignedID': '1', 'Title': 'Floodplains'}]}

    async def fake_complete(self, **kwargs):
        calls.append(kwargs['user'])
        if len(calls) == 1:
            bad = _model_ok()
            bad['contributions'] = [
                {'assigned_id': 'zzz', 'contribution': 'Bogus.'}
            ]
            return bad
        fixed = _model_ok()
        fixed['contributions'] = [
            {'assigned_id': '1', 'contribution': 'Flood zones.'}
        ]
        fixed['workflow'] = [
            {
                'step': 1,
                'title': 'Overlay',
                'detail': 'Overlay zones on facilities.',
                'dataset_ids': ['1'],
            }
        ]
        return fixed

    monkeypatch.setattr(mcp_service, 'fetch_layer_metadata', fake_layers)
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    response = _run(recipe.generate_recipe('Floods?', ['1']))
    assert len(calls) == 2
    assert response.contributions[0].assigned_id == '1'
    assert response.workflow[0].dataset_ids == ['1']
    assert response.combinations == []
    assert response.gaps == ['No parcel data.']
    assert response.limitations == ['Check CRS.']
    assert response.outputs == ['An exposure table.']


def test_generate_recipe_fails_after_bad_repair(monkeypatch):
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')

    async def fake_layers(layer_ids, fields=None):
        return {'rows': [{'AssignedID': '1', 'Title': 'Floodplains'}]}

    async def fake_complete(self, **kwargs):
        bad = _model_ok()
        bad['contributions'] = [{'assigned_id': 'zzz', 'contribution': 'x'}]
        return bad

    monkeypatch.setattr(mcp_service, 'fetch_layer_metadata', fake_layers)
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    with pytest.raises(ModelOutputError):
        _run(recipe.generate_recipe('Floods?', ['1']))


def test_generate_recipe_rejects_empty_workflow_after_repair(monkeypatch):
    monkeypatch.setenv('MF_MODEL_API_KEY', 'test-key')
    calls = []

    async def fake_layers(layer_ids, fields=None):
        return {'rows': [{'AssignedID': '1', 'Title': 'Floodplains'}]}

    async def fake_complete(self, **kwargs):
        calls.append(kwargs['user'])
        bad = _model_ok()
        bad['workflow'] = []
        return bad

    monkeypatch.setattr(mcp_service, 'fetch_layer_metadata', fake_layers)
    monkeypatch.setattr(ModelClient, 'complete_json', fake_complete)
    with pytest.raises(ModelOutputError, match='no workflow steps'):
        _run(recipe.generate_recipe('Floods?', ['1']))
    assert len(calls) == 2
