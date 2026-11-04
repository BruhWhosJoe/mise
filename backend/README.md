# Mise backend

Small FastAPI service that connects the Mise frontend to the remote
metadata MCP service. Flow: browser → our backend → MCP → browser.

## Layout

- `app/main.py` — FastAPI application factory and router wiring
- `app/config.py` — environment-based settings (see `.env.example`)
- `app/mcp_service.py` — FastMCP SDK client wrapper with timeouts and
  sanitized errors
- `app/normalize.py` — alias-aware response normalization (no invented data)
- `app/models.py` — Pydantic response models
- `app/routes/` — HTTP routes (`health`, `catalog`)
- `tests/` — pytest suite (normalization + routes with a mocked service)
- `scripts/smoke_mcp.py` — bounded live smoke test against the real MCP server

## Setup

From `C:\Projects\Mise` (uses the root `.venv`, Python 3.12):

```powershell
.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
```

See the note at the top of `requirements.txt`: after your first working
install, run `pip freeze` and pin the versions you tested with.

## Run the backend

From `C:\Projects\Mise` (keep this terminal running):

```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8001
```

Health check: http://127.0.0.1:8001/api/health

## Run the tests

From `C:\Projects\Mise`:

```powershell
.venv\Scripts\python.exe -m pytest backend/tests -q
```

## Live smoke test

Bounded: discovers tools, reads fields, fetches 3 records, then full
metadata for one returned ID. From `C:\Projects\Mise`:

```powershell
.venv\Scripts\python.exe backend/scripts/smoke_mcp.py
```

## Endpoints

- `GET /api/health` — backend liveness (never contacts MCP)
- `GET /api/catalog/status` — MCP reachability plus discovered tool
  names/schemas; always 200, `reachable: false` when the remote is sick
- `GET /api/catalog/preview?offset=0&limit=20` — one bounded page of real
  records plus server pagination info (`has_more`, `next_offset`,
  `total_records` when supplied)
- `GET /api/catalog/datasets/{assigned_id}` — full available metadata for
  one exact ID, or 404

Upstream failures map to 503 (unreachable), 504 (timeout), or 502 (tool or
malformed response) with short sanitized messages. Raw server metadata is
always preserved in each record's `raw` field; mapped fields stay missing
rather than invented, and only `http(s)` source URLs are exposed.

## Configuration

Copy `backend/.env.example` to `backend/.env` to override defaults:

- `MF_MCP_URL` — metadata MCP endpoint
- `MF_MCP_TIMEOUT_SECONDS` — per-call timeout (default 20)
- `MF_PREVIEW_DEFAULT_LIMIT` / `MF_PREVIEW_MAX_LIMIT` — page bounds
- `MF_BACKEND_HOST` / `MF_BACKEND_PORT` — documented run address

No MCP secrets are used. The Vite dev server proxies `/api` to
`http://127.0.0.1:8001`, so the browser never calls the backend cross-origin.

## AI discovery + recipes (Meta Llama API)

New endpoints:

- `POST /api/discovery/search` (`{"question": "..."}`) — interpreted goal,
  recommended real datasets with explanations and Direct/Supporting labels,
  gaps, and coverage info.
- `POST /api/recipe/generate` (`{"question": "...", "dataset_ids": [...]}`) —
  a structured analysis plan for 1–10 selected datasets.

Retrieval/ranking approach (see `app/discovery.py`): the backend pulls the
full catalog into a bounded TTL cache (`MF_CATALOG_CACHE_SECONDS`, default
900s; capped at `MF_CATALOG_CACHE_MAX_RECORDS`), ranks every record locally
with transparent field-weighted lexical matching, and sends only the top
`MF_DISCOVERY_CANDIDATES` (default 40) to the model for relevance judgment.
Lexical matching misses synonyms and typos and is disclosed as such in the
response coverage; the model evaluates the shortlist, never the whole
catalog. At most `MF_DISCOVERY_MAX_RESULTS` (default 8) recommendations are
returned, with disclosure when the cap trims results. Every model-returned
ID is validated against real candidates; facts come from MCP, not the model.

New modules: `app/model_client.py` (Bearer-auth chat client, bounded
timeouts/retries, typed errors, secrets never logged), `app/catalog_cache.py`
(full-catalog TTL cache with loop/duplicate guards), `app/retrieval.py`
(lexical scoring), `app/discovery.py`, `app/recipe.py` (one bounded repair
attempt, then loud failure).

Provider sources: Meta's official docs at
https://dev.meta.ai/docs/cookbook/quickstart-chat-completions and
https://dev.meta.ai/docs/protocols/chat-completions (base URL
`https://api.meta.ai/v1`, `POST /chat/completions`, model `muse-spark-1.3`,
Bearer API-key authentication), with `response_format` json_schema
structured output on Chat Completions corroborated by integrations citing
dev.meta.ai/docs/structured-output. Our sandbox cannot fetch Meta's pages
directly; if the provider ever rejects a request shape, set
`MF_MODEL_STRUCTURED_MODE=json_object` in `backend/.env` and restart.

Setup: copy `backend/.env.example` to `backend/.env` (git-ignored), paste
your key into `MF_MODEL_API_KEY`, and restart the backend. Without a key,
catalog browsing keeps working while AI endpoints answer 503
`ai_not_configured`. Keys never appear in logs, errors, or frontend code.

Opt-in live AI smoke test (consumes model quota, not part of pytest):

```powershell
.venv\Scripts\python.exe backend/scripts/smoke_ai.py "flood risk in DC"
```
