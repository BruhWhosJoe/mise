# Mise Handoff

Independent civic-research app (separate from MetaFabricAI — never access or copy that project).

## 1. Goal and architecture

Mise helps people discover government open datasets and assemble a **Data Recipe**:
an analysis plan explaining how selected datasets could support a research question.
It never executes analysis or invents findings.

```
Browser (React+TS+Vite, ./frontend)
  → FastAPI backend (./backend, 127.0.0.1:8001)
      → Azure metadata MCP service (remote, read-only)
      → Meta Muse Spark chat-completions API (AI discovery, recipe, chat)
```

- Frontend dev server proxies `/api` to the backend (see `frontend/vite.config.ts`).
- Backend endpoints: `/api/health`, `/api/catalog/*` (status, preview, search,
  datasets), `/api/discovery/search`, `/api/recipe/generate`, `/api/chat/message`.
- Root Python 3.12 venv at `.venv` (always use `.venv\Scripts\python.exe`).
- No secrets in code: the only credential is the Meta key in git-ignored `backend/.env`.

## 2. Completed work and key files

**Final quality pass (latest, uncommitted):**

- Search reliability (`frontend/src/state/workspaceReducer.ts`
  `search-start`, `frontend/src/components/AIDiscovery.tsx`): a new search
  immediately clears old recommendations, the old interpretation, and the
  old relevance filters, then shows "Searching N datasets…" (last known
  real catalog total, else a generic line) with elapsed time and Cancel;
  failures show only the error with Retry. Relevance resets to Show-all
  on every new search.
- Timeout fallback (`backend/app/discovery.py`, `backend/tests/
  test_discovery.py`): if the evaluator call times out, one automatic
  retry with the top 40 candidates runs before failing; coverage
  discloses the reduced shortlist. Small shortlists and a second timeout
  fail so the route can report them (3 new mocked tests).
- Design tokens (`frontend/src/index.css`, `frontend/src/App.css`): type
  scale 1.75/1.25/1.35/1/0.85rem; card radius 10px, button/chip radius
  8px, one `--shadow-card`; spacing on the 4/8/12/16/24/32 scale; three
  button styles (primary/secondary/quiet); ~1280px centered container;
  bordered `.panel` sections; recipe two-column layout (sticky dataset
  list left, content panels right, container-query stacking).
- Card action bars (`LiveRecordCard.tsx`, `LiveCatalog.tsx`
  `CollectionItem`, `LiveRecipe.tsx` `RecipeDatasetItem`,
  `DatasetDetails.tsx` `OpenSourceButton`): all actions left-ordered
  (Add primary / "Added ✓" secondary, View details, Open source page as
  a secondary button with icon, Copy link); nothing floats right.
- Assistant/state (`AssistantPanel.tsx`, `workspaceReducer.ts`,
  `WorkspaceContext.tsx`, `App.tsx`, `LiveRecipe.tsx`): quiet "Clear
  chat" with an Undo toast (single-use stash, retired by the next turn);
  New investigation clears chat (confirm copy says so); stale recipes
  show an enabled Regenerate when inputs are valid, else an exact hint
  ("Select datasets first", deselect, or search first) — never a dead
  button.

**Correction + UI polish pass (earlier, uncommitted):**

- Scores shown honestly (`frontend/src/utils/discoveryFilter.ts`,
  `frontend/src/state/workspaceReducer.ts`, `WorkspaceContext.tsx`,
  `frontend/src/components/{AIDiscovery,LiveRecordCard}.tsx`, `App.css`):
  results show the full returned set first (score-desc); explicit
  "Show all N" / "Strong matches: 85+" presets plus a custom threshold;
  prominent per-card score badge; unscored rows labeled with a rerun offer;
  chat context drops unscored rows instead of sending a fabricated 0.
- Source links end to end (`backend/app/routes/catalog.py`,
  `backend/app/recipe.py`, `backend/app/config.py`): detail and recipe
  fetches now request the same explicit `PREVIEW_FIELDS` (AccessURL /
  ServiceEndpointURL / DownloadURL) as preview/discovery instead of server
  defaults; card/detail/collection/recipe surfaces unchanged (already
  validated http(s) links with honest empty states, cached detail loads).
- Whole-catalog title/ID search (`backend/app/catalog_search.py`,
  `backend/app/models.py` `CatalogSearchResponse`,
  `GET /api/catalog/search`, `frontend/src/services/api.ts`,
  `frontend/src/components/LiveCatalog.tsx`): exact-ID-first then
  title-substring matching over the bounded cached snapshot with disclosed
  coverage (searched count, complete/partial, limit note). Never page-only.
- Search cancellation (`frontend/src/types.ts`, `workspaceTypes.ts`,
  `workspaceReducer.ts` `search-cancel`, `WorkspaceContext.tsx`
  `cancelAISearch`, `AIDiscovery.tsx`, `utils/guidance.ts`): Cancel button
  while loading; aborts the request, rotates the request identity so late
  responses cannot land (even after a new search), preserves prior results /
  duration / selection, records "Search canceled" (terminal, not an error);
  honest note that an already-issued model call may still finish.
- Discovery filters (`discoveryFilter.ts`, `AIDiscovery.tsx`, `App.css`):
  compact toolbar (presets, threshold range+number, sort, tag, publisher,
  dataset type, title/ID), removable chips, Clear filters, accurate
  visible/total counts, explicit "returned recommendations only" scope note.
  Filtering never touches the collection.
- Assistant reorg (`frontend/src/components/AssistantPanel.tsx`, `App.css`):
  larger heading, collapsible Current-investigation card, conversation-first
  with scrolling history and sticky composer, Help disclosure, starter
  guidance before results exist, presets labeled as filling the discovery
  box (not chat). Chat/Undo/suggestion/recipe-separation logic untouched.
- Resizing + visual hierarchy (`workspaceReducer.ts` max width 640px and 45%
  viewport cap, `App.css`, `index.css`): distinct divider line with purple
  hover/focus, wider hit area, keyboard resizing kept, saved widths kept;
  teal success, amber limitations, red errors incl. danger-style Cancel;
  larger key headings. No invented metrics, charts, or dockable panels.
- Empty states (`App.tsx`, `InvestigationSummary.tsx`, `AIDiscovery.tsx`):
  removed the redundant status pill; no "no question yet" on discovery and
  no self-navigation buttons; summary shows the in-flight question during a
  search; empty submit focuses the input with a red inline alert cleared on
  correction; completed durations still persist across nav/reload.
- Tests: `frontend/state-tests/workspaceState.test.ts` (57 node:test cases,
  `npm run test:state`); new `backend/tests/test_catalog_search.py`
  (pure matching + search route + detail/recipe field propagation).

**Earlier guided-workspace pass (uncommitted):** workspace store above page
lifecycles (`frontend/src/state/`), 3-view nav, AI relevance scores with
repair-path validation, assistant chat with typed validated actions,
resizable panel, midnight-blue nav + Manrope identity, consistent dataset
actions, recipe diagram from real links only.

## 3. Decisions (and rejections)

- Validation over rendering for recipe gaps: missing contract keys fail loudly
  (repair path) instead of defaulting to `[]`; explicit `[]` renders an honest
  empty state.
- Source restrictions constrain plans generally via prompt rules (no hardcoded IDs).
- No scores manufactured anywhere: missing score = model-output gap (labeled
  unscored, excluded from thresholds and chat context), never 0.
- Show-all is the results default; moving the threshold or a chat refinement
  engages filtering; Clear/reset restores defaults. Filters narrow the
  returned set only and say so.
- Cancellation is terminal (`canceled`), preserves duration/selection
  (results were cleared at search start, so cancel cannot resurrect rows),
  rotates identity, never retries; UI distinguishes client-side cancel from
  guaranteed provider termination.
- Detail/recipe fetch explicit `PREVIEW_FIELDS`: server field defaults are not
  trusted to include URLs.
- Catalog search runs over the bounded cached snapshot with disclosed
  coverage; discovery text filters are client-side over the returned set.
- Chat, discovery, recipe are distinct: chat never generates/overwrites recipes.
- Filter state is user-only except that a new search resets relevance to
  Show-all; filtering never alters selection.
- New searches clear old rows/interpretation/filters at start (collection,
  duration, and chat untouched) and retire the chat-applied undo snapshot;
  chat clears are single-undo via a stash retired by the next turn.
- Persistence stays v2: saves predating the text filters hydrate with empty
  strings rather than being dropped.
- Rejected: new dependencies / test frameworks (node:test + pure pytest);
  DOM tests (no runner); recipe rows have no remove control; Markdown export
  links source page only (by design); freely draggable/dockable panels.

## 4. Tested vs. unverified

**Verified this session:** `npm run build` pass; `npm run lint` clean
(0 errors, 0 warnings); `npm run test:state` 64/64 pass; backend 125 passed
+ 66 failed where every failure is the sandbox `PermissionError` socket block
(zero assertion failures — every `E` line grouped and confirmed). The 3 new
timeout-fallback tests were additionally verified with a mocked
synchronous coroutine driver (throwaway, outside the repo): 45 candidates
rank, retry sends the top 40, coverage discloses it, small-shortlist and
retry timeouts propagate.

**Unverified — needs an out-of-sandbox run:** all 66 async backend tests
(includes the 3 new timeout-fallback tests in `test_discovery.py`).

**Unverified — no browser access in this environment:** all browser behavior
below. Manual checklist:

1. Scores/filters: run a search → all results visible score-desc → apply
   Strong 85+ → move threshold → tag/publisher/type/title-ID filters →
   chips remove individually → Clear filters → counts stay accurate.
2. Source/copy links: Open source + Copy link on discovery cards, catalog
   cards, View-details (all three link rows), collection review, recipe
   datasets; missing links read as honestly unavailable.
3. Cancel then search again: new search clears old rows + filters and shows
   "Searching N datasets…" with elapsed time → Cancel mid-search →
   "Search canceled", no resurrected rows → new search → late first
   response never appears.
4. Navigation/reload: switch views mid-search (loading persists, no refetch);
   reload mid-search (interrupted/retry); durations persist across nav+reload.
5. Assistant: "select the top 3" → change summary + Undo → second refinement
   composes; presets fill the discovery box without submitting or chatting;
   Clear chat → "Conversation cleared." + Undo → Undo restores; New
   investigation clears the chat too.
6. Resizing: drag divider (purple hover), keyboard arrows/Home/End on the
   focused handle, Expand/Restore, reload → width persists; wide screen caps
   near 640px.
7. Recipe: generate → two columns on wide screens (sticky dataset list),
   one column narrow → diagram shows only real links → stale notice offers
   Regenerate or an exact hint → Markdown/JSON downloads.
8. Light/dark toggle, 390px stacking (assistant stacks, handle hidden),
   keyboard-only pass, empty-question submit (red error + focus).

## 5. Known issues and next steps (priority order)

1. Run the full backend suite outside the sandbox (one run covers the 54
   async tests, incl. the new search/detail/recipe coverage).
2. Work the 8-item browser checklist above; fix anything it surfaces.
3. Confirm live AI end-to-end with a real key (discovery scores, recipe, chat).
4. Optional follow-ups: TestClient test for `/api/chat/message`; recipe
   Markdown export with full action links; DOM/component tests if a runner
   is ever adopted.
5. Nothing is committed — review `git status` and commit when ready (backend/
   is still untracked; ensure `backend/.env` stays ignored).

## 6. How to run

From `C:\Projects\metafabric`, in two terminals:

```powershell
.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001
cd frontend; npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

Verify:

```powershell
cd C:\Projects\metafabric\frontend; npm run build; npm run lint; npm run test:state
cd C:\Projects\metafabric; .venv\Scripts\python.exe -m pytest backend/tests -q
```

**Env vars** (copy `backend/.env.example` to git-ignored `backend/.env`, restart backend):
`MF_MCP_URL`, `MF_MCP_TIMEOUT_SECONDS`, `MF_MODEL_API_KEY` (required for AI;
without it catalog browsing works but AI endpoints return 503),
`MF_MODEL_BASE_URL`, `MF_MODEL_CHAT_PATH`, `MF_MODEL_NAME`,
`MF_MODEL_TIMEOUT_SECONDS`, `MF_MODEL_MAX_OUTPUT_TOKENS`,
`MF_MODEL_TEMPERATURE`, `MF_MODEL_MAX_RETRIES`, `MF_MODEL_STRUCTURED_MODE`,
plus retrieval budgets: `MF_DISCOVERY_CANDIDATES` (default 80),
`MF_DISCOVERY_MAX_RESULTS` (default 15), `MF_EXPANSION_TIMEOUT_SECONDS`
(default 30), `MF_RECIPE_*`, `MF_CATALOG_*` (see `backend/.env.example`).

## 7. Diagnosed causes (this pass)

- **6 evaluated, 0 visible at minimum 85:** valid scores below the default
  threshold, not missing data. The backend requires an integer 0–100 per
  recommendation (`backend/app/discovery.py`, repair path, 502 on failure),
  so API responses and v2 persisted saves always carry scores, and the
  frontend mapping preserves them (`scoredValue`, chip only for finite
  numbers). The old default (`showAll: false`, minimum 85 in
  `frontend/src/utils/discoveryFilter.ts`) hid every sub-85 row on first
  paint. Fixed by showing all initially with an explicit 85+ preset.
  One real fabrication was found and removed: `buildChatBody` substituted 0
  for missing scores in chat context (`WorkspaceContext.tsx`); unscored rows
  are now excluded from chat context and labeled in the UI with a rerun.
- **Missing source links:** the preview/discovery path was already sound
  (explicit `PREVIEW_FIELDS` → `sanitize_url` http(s)-only → cached records
  reused with no per-card requests → validated rendering or honest "not
  provided"). The gap was `fetch_layer_metadata` called with `fields=None`
  in `backend/app/routes/catalog.py` (`read_dataset`) and
  `backend/app/recipe.py` (`generate_recipe`): server field defaults are not
  guaranteed to include the URL fields, so detail and recipe surfaces could
  lose links the cards had. Both now request the explicit observed field
  list. Remaining missing links are either genuinely absent in source
  metadata (correctly shown as unavailable) or stale persisted records
  (View details refetches fresh metadata through the session cache).
