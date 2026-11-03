"""Model client unit tests: pure helpers only (no network, no loop)."""

import pytest

from app.model_client import (
    ModelAuthError,
    ModelNotConfiguredError,
    ModelOutputError,
    ModelRateLimitError,
    ModelSettings,
    ModelUpstreamError,
    build_chat_body,
    check_configured,
    classify_http_error,
    parse_chat_response,
)

SECRET = 'sk-test-key-that-must-never-leak'


def _settings(**overrides):
    values = {
        'base_url': 'https://api.meta.ai/v1',
        'chat_path': '/chat/completions',
        'name': 'test-model',
        'api_key': SECRET,
        'timeout_seconds': 60.0,
        'max_output_tokens': 3000,
        'temperature': 0.2,
        'max_retries': 1,
        'structured_mode': 'json_object',
    }
    values.update(overrides)
    return ModelSettings(**values)


def test_check_configured_passes_when_complete():
    check_configured(_settings())


def test_check_configured_names_missing_settings():
    with pytest.raises(ModelNotConfiguredError) as info:
        check_configured(_settings(api_key='', name=''))
    assert 'MF_MODEL_API_KEY' in str(info.value)
    assert 'MF_MODEL_NAME' in str(info.value)
    assert SECRET not in str(info.value)


def test_build_chat_body_json_object_mode():
    body = build_chat_body(_settings(), system='s', user='u')
    assert body['model'] == 'test-model'
    assert body['temperature'] == 0.2
    assert body['max_tokens'] == 3000
    assert body['messages'] == [
        {'role': 'system', 'content': 's'},
        {'role': 'user', 'content': 'u'},
    ]
    assert body['response_format'] == {'type': 'json_object'}
    assert SECRET not in str(body)


def test_build_chat_body_json_schema_mode():
    schema = {'type': 'object'}
    body = build_chat_body(
        _settings(structured_mode='json_schema'),
        system='s',
        user='u',
        schema_name='discovery',
        schema=schema,
    )
    assert body['response_format'] == {
        'type': 'json_schema',
        'json_schema': {'name': 'discovery', 'schema': schema},
    }


def test_build_chat_body_none_mode_omits_format():
    body = build_chat_body(_settings(structured_mode='none'), system='s', user='u')
    assert 'response_format' not in body


def _response(content, finish_reason='stop'):
    return {
        'choices': [
            {'message': {'content': content}, 'finish_reason': finish_reason}
        ]
    }


def test_parse_chat_response_returns_json():
    assert parse_chat_response(_response('{"a": 1}')) == {'a': 1}


def test_parse_chat_response_strips_fences():
    assert parse_chat_response(_response('```json\n{"a": 1}\n```')) == {'a': 1}


def test_parse_chat_response_joins_list_content():
    payload = {
        'choices': [
            {
                'message': {
                    'content': [
                        {'type': 'text', 'text': '{"a":'},
                        {'type': 'text', 'text': ' 1}'},
                    ]
                },
                'finish_reason': 'stop',
            }
        ]
    }
    assert parse_chat_response(payload) == {'a': 1}


def test_parse_chat_response_rejects_truncated():
    with pytest.raises(ModelOutputError, match='truncated'):
        parse_chat_response(_response('{"a":', finish_reason='length'))


def test_parse_chat_response_rejects_empty_and_malformed():
    with pytest.raises(ModelOutputError):
        parse_chat_response(_response('   '))
    with pytest.raises(ModelOutputError):
        parse_chat_response(_response('not json'))
    with pytest.raises(ModelOutputError):
        parse_chat_response({'choices': []})
    with pytest.raises(ModelOutputError):
        parse_chat_response('a string')


def test_classify_http_error_distinguishes_failures():
    assert isinstance(classify_http_error(401, 'bad key'), ModelAuthError)
    assert isinstance(classify_http_error(403, ''), ModelAuthError)
    assert isinstance(classify_http_error(429, ''), ModelRateLimitError)
    assert isinstance(classify_http_error(500, 'boom'), ModelUpstreamError)
    assert isinstance(classify_http_error(400, 'bad'), ModelUpstreamError)
    assert 'boom' in str(classify_http_error(500, 'boom'))


def test_classify_http_error_redacts_secrets_from_snippets():
    for status in (401, 403, 429, 500):
        message = str(
            classify_http_error(status, f'echo: {SECRET}', secrets=(SECRET,))
        )
        assert SECRET not in message
        assert '[redacted]' in message
