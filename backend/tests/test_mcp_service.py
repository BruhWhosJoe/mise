"""MCP result-shaping unit tests (no network; fakes stand in for SDK types)."""

import asyncio
from types import SimpleNamespace

import pytest

from app import mcp_service
from app.mcp_service import (
    MCPMalformedError,
    extract_field_names,
    extract_payload,
    is_tool_error,
)


def test_is_tool_error_reads_both_spellings():
    assert is_tool_error(SimpleNamespace(is_error=True)) is True
    assert is_tool_error(SimpleNamespace(is_error=False)) is False
    assert is_tool_error(SimpleNamespace(isError=True)) is True
    assert is_tool_error(SimpleNamespace()) is False
    assert is_tool_error({'not': 'a result'}) is False


def test_extract_payload_passes_plain_values_through():
    assert extract_payload({'a': 1}) == {'a': 1}
    assert extract_payload([1, 2]) == [1, 2]
    assert extract_payload('text') == 'text'
    assert extract_payload(None) is None


def test_extract_payload_prefers_data_over_structured():
    result = SimpleNamespace(
        data={'records': [1]},
        structured_content={'records': [2]},
        content=[],
    )
    assert extract_payload(result) == {'records': [1]}


def test_extract_payload_falls_back_when_data_is_none():
    result = SimpleNamespace(
        data=None,
        structured_content={'records': [2]},
        content=[],
    )
    assert extract_payload(result) == {'records': [2]}


def test_extract_payload_unwraps_lone_result_envelope():
    result = SimpleNamespace(
        data=None, structured_content={'result': [1, 2]}, content=[]
    )
    assert extract_payload(result) == [1, 2]


def test_extract_payload_dumps_model_data():
    class FakeModel:
        def model_dump(self, mode='json'):
            assert mode == 'json'
            return {'records': [3]}

    result = SimpleNamespace(data=FakeModel(), structured_content=None)
    assert extract_payload(result) == {'records': [3]}


def test_extract_payload_parses_single_json_text_block():
    result = SimpleNamespace(
        data=None,
        structured_content=None,
        content=[SimpleNamespace(text='{"records": [4]}')],
    )
    assert extract_payload(result) == {'records': [4]}


def test_extract_payload_keeps_plain_text_block():
    result = SimpleNamespace(
        data=None, structured_content=None, content=[SimpleNamespace(text='hi')]
    )
    assert extract_payload(result) == 'hi'


def test_extract_payload_rejects_empty_result():
    result = SimpleNamespace(data=None, structured_content=None, content=[])
    with pytest.raises(MCPMalformedError):
        extract_payload(result)


# Live shape observed 2026-11-02: get_metadata_fields returns descriptor
# objects, while get_metadata_field_definitions requires name strings.
LIVE_DESCRIPTORS = [
    {'fieldName': 'AssignedID', 'EnableDefaultSearch': True},
    {'fieldName': 'Title', 'EnableDefaultSearch': False},
]


def test_extract_field_names_accepts_live_descriptors():
    assert extract_field_names(LIVE_DESCRIPTORS) == ['AssignedID', 'Title']


def test_extract_field_names_accepts_plain_strings():
    assert extract_field_names(['AssignedID', ' Title ']) == [
        'AssignedID',
        'Title',
    ]


@pytest.mark.parametrize(
    'bad',
    [
        'not-a-list',
        {'fields': ['AssignedID']},
        None,
        [{'EnableDefaultSearch': True}],
        [{'fieldName': '   '}],
        [{'fieldName': 42}],
        ['AssignedID', 42],
        [None],
    ],
)
def test_extract_field_names_rejects_malformed(bad):
    with pytest.raises(MCPMalformedError):
        extract_field_names(bad)


def test_field_definitions_call_receives_name_strings(monkeypatch):
    seen = {}

    async def fake_call_tool(tool, arguments):
        seen['tool'] = tool
        seen['arguments'] = arguments
        return {'ok': True}

    monkeypatch.setattr(mcp_service, '_call_tool', fake_call_tool)
    result = asyncio.run(mcp_service.fetch_field_definitions(LIVE_DESCRIPTORS))
    assert result == {'ok': True}
    assert seen['tool'] == 'get_metadata_field_definitions'
    assert seen['arguments'] == {'fields': ['AssignedID', 'Title']}


def test_field_definitions_passes_none_through(monkeypatch):
    seen = {}

    async def fake_call_tool(tool, arguments):
        seen['arguments'] = arguments
        return {'ok': True}

    monkeypatch.setattr(mcp_service, '_call_tool', fake_call_tool)
    asyncio.run(mcp_service.fetch_field_definitions(None))
    assert seen['arguments'] == {'fields': None}


def test_field_definitions_rejects_malformed_before_calling(monkeypatch):
    calls = []

    async def fake_call_tool(tool, arguments):
        calls.append((tool, arguments))
        return {'ok': True}

    monkeypatch.setattr(mcp_service, '_call_tool', fake_call_tool)
    with pytest.raises(MCPMalformedError):
        asyncio.run(
            mcp_service.fetch_field_definitions([{'no_name': True}])
        )
    assert calls == []
