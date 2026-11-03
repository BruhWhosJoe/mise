"""Backend configuration.

Values come from environment variables (optionally via ``backend/.env``)
with safe local defaults. No secrets are required for local development.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def load_dotenv(path: str) -> None:
    """Minimal ``KEY=VALUE`` loader. Never overrides real environment vars."""
    try:
        with open(path, encoding='utf-8') as handle:
            lines = handle.read().splitlines()
    except OSError:
        return
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith('#') or '=' not in stripped:
            continue
        key, _, value = stripped.partition('=')
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(os.path.dirname(_BACKEND_DIR), '.env'))
load_dotenv(os.path.join(_BACKEND_DIR, '.env'))


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _get_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


# Explicit catalog fields requested for preview pages: every Always Search
# field plus the source/URL/type/date fields that dataset cards need.
# Observed in the live field schema 2026-11-02. If the service ever
# rejects a name here, trim this list to what the smoke test reports.
PREVIEW_FIELDS = [
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
]


@dataclass(frozen=True)
class Settings:
    mcp_url: str
    mcp_timeout_seconds: float
    preview_default_limit: int
    preview_max_limit: int
    backend_host: str
    backend_port: int
    model_api_key: str
    model_base_url: str
    model_chat_path: str
    model_name: str
    model_timeout_seconds: float
    model_max_output_tokens: int
    model_temperature: float
    model_max_retries: int
    model_structured_mode: str
    discovery_candidates: int
    discovery_max_results: int
    expansion_timeout_seconds: float
    recipe_max_datasets: int
    catalog_cache_seconds: int
    catalog_cache_max_records: int
    catalog_page_size: int
    recipe_max_input_chars: int


def get_settings() -> Settings:
    """Build fresh settings from the environment on every call."""
    return Settings(
        mcp_url=os.environ.get(
            'MF_MCP_URL',
            'https://ca-metadata-mcp-dev.wittyforest-26c063ae.eastus.azurecontainerapps.io/mcp',
        ),
        mcp_timeout_seconds=_get_float('MF_MCP_TIMEOUT_SECONDS', 20.0),
        preview_default_limit=_get_int('MF_PREVIEW_DEFAULT_LIMIT', 20),
        preview_max_limit=_get_int('MF_PREVIEW_MAX_LIMIT', 100),
        backend_host=os.environ.get('MF_BACKEND_HOST', '127.0.0.1'),
        backend_port=_get_int('MF_BACKEND_PORT', 8001),
        model_api_key=os.environ.get('MF_MODEL_API_KEY', ''),
        model_base_url=os.environ.get(
            'MF_MODEL_BASE_URL', 'https://api.meta.ai/v1'
        ),
        model_chat_path=os.environ.get(
            'MF_MODEL_CHAT_PATH', '/chat/completions'
        ),
        # Documented at https://dev.meta.ai/docs/cookbook/quickstart-chat-completions
        # and https://dev.meta.ai/docs/protocols/chat-completions.
        model_name=os.environ.get('MF_MODEL_NAME', 'muse-spark-1.3'),
        model_timeout_seconds=_get_float('MF_MODEL_TIMEOUT_SECONDS', 60.0),
        model_max_output_tokens=_get_int('MF_MODEL_MAX_OUTPUT_TOKENS', 3000),
        model_temperature=_get_float('MF_MODEL_TEMPERATURE', 0.2),
        model_max_retries=_get_int('MF_MODEL_MAX_RETRIES', 1),
        # json_schema is the documented Chat Completions mode per the
        # sources above; fall back to json_object if the provider rejects it.
        model_structured_mode=os.environ.get(
            'MF_MODEL_STRUCTURED_MODE', 'json_schema'
        ),
        discovery_candidates=_get_int('MF_DISCOVERY_CANDIDATES', 80),
        discovery_max_results=_get_int('MF_DISCOVERY_MAX_RESULTS', 15),
        expansion_timeout_seconds=_get_float(
            'MF_EXPANSION_TIMEOUT_SECONDS', 30.0
        ),
        recipe_max_datasets=_get_int('MF_RECIPE_MAX_DATASETS', 10),
        catalog_cache_seconds=_get_int('MF_CATALOG_CACHE_SECONDS', 900),
        catalog_cache_max_records=_get_int(
            'MF_CATALOG_CACHE_MAX_RECORDS', 5000
        ),
        catalog_page_size=_get_int('MF_CATALOG_PAGE_SIZE', 100),
        recipe_max_input_chars=_get_int('MF_RECIPE_MAX_INPUT_CHARS', 60000),
    )
