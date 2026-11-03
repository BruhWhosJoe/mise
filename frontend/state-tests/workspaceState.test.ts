import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type {
  CatalogPreview,
  DiscoveryResponse,
  LiveRecord,
  RecipeResponse,
} from '../src/services/api'
import type { WorkspaceState } from '../src/state/workspaceTypes'
import type { MinimalStorage } from '../src/state/persistence'
import {
  LEGACY_WORKSPACE_STORAGE_KEY,
  MAX_PERSIST_BYTES,
  RECIPE_INTERRUPTED_MESSAGE,
  SEARCH_INTERRUPTED_MESSAGE,
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_STORAGE_VERSION,
  loadWorkspace,
  saveWorkspace,
} from '../src/state/persistence'
import {
  ASSISTANT_DEFAULT_WIDTH,
  ASSISTANT_MAX_WIDTH,
  ASSISTANT_MIN_WIDTH,
  createInitialState,
  defaultDiscoveryUI,
  effectiveAssistantWidth,
  isRecipeStale,
  maxAssistantWidth,
  recipeInputsValid,
  selectedIds,
  workspaceReducer,
} from '../src/state/workspaceReducer'
import type {
  ChatAction,
  DiscoveryRecommendation,
} from '../src/services/api'
import {
  DEFAULT_MIN_RELEVANCE,
  clampMinScore,
  countUnscored,
  filterRecommendations,
  highestScore,
  sortRecommendations,
  visibleRecommendations,
} from '../src/utils/discoveryFilter'
import type { DiscoveryView } from '../src/utils/discoveryFilter'
import { nextAction, nextActionView } from '../src/utils/guidance'
import type { GuidanceInput } from '../src/utils/guidance'
import {
  buildRecipeGraph,
  shortNodeLabel,
} from '../src/utils/recipeGraph'
import {
  authoritativeLinks,
  hasAnyLink,
  preferredShareLink,
} from '../src/utils/datasetLinks'

function makeRecord(id: string, title: string): LiveRecord {
  return {
    assigned_id: id,
    title,
    description: `${title} description`,
    summary: `${title} summary`,
    source: 'test-source',
    portal_name: 'test-portal',
    organization_name: 'test-org',
    item_type: 'dataset',
    tags: ['test'],
    access_url: 'https://example.test/record',
    service_endpoint_url: null,
    download_url: null,
    update_date: null,
    modified_date: null,
    temporal_range: null,
    use_limitations: null,
    access_constraints: null,
    layer_names: null,
    coordinate_system: null,
    raw: { id },
  }
}

function makeDiscovery(question: string, record: LiveRecord): DiscoveryResponse {
  return {
    question,
    interpretation: { goal: 'test goal', assumptions: [] },
    recommendations: [
      {
        record,
        relevance: 'direct',
        relevance_score: 92,
        why: 'test why',
        limitations: [],
      },
    ],
    gaps: [],
    coverage: {
      retrieval_method: 'test',
      retrieval_note: 'test note',
      catalog_total: 1,
      records_retrieved: 1,
      retrieval_complete: true,
      retrieval_notes: [],
      candidates_evaluated: 1,
      candidates_excluded_no_id: 0,
      model_dropped_unknown_ids: 0,
      model_duplicates_removed: 0,
      result_cap: 10,
      cap_applied: false,
      top_candidates: [],
    },
    partial: false,
    partial_reason: null,
  }
}

function makeRecipe(question: string, ids: string[]): RecipeResponse {
  return {
    question,
    dataset_ids: ids,
    datasets: ids.map((id) => ({
      assigned_id: id,
      title: `title ${id}`,
      organization_name: 'test-org',
      portal_name: null,
      access_url: null,
      service_endpoint_url: null,
      download_url: null,
    })),
    objective: 'test objective',
    contributions: ids.map((id) => ({
      assigned_id: id,
      contribution: 'test contribution',
    })),
    workflow: [],
    combinations: [],
    gaps: [],
    limitations: [],
    outputs: [],
    generated_at: '2026-01-01T00:00:00Z',
    coverage: {
      datasets_requested: ids.length,
      datasets_resolved: ids.length,
      metadata_complete: true,
    },
  }
}

function makePreview(): CatalogPreview {
  return {
    records: [makeRecord('c-1', 'catalog one')],
    offset: 0,
    limit: 10,
    returned: 1,
    has_more: false,
    next_offset: null,
    total_records: 1,
  }
}

class MemoryStorage implements MinimalStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  raw(): string | null {
    return this.getItem(WORKSPACE_STORAGE_KEY)
  }
}

class QuotaStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error('quota exceeded')
  }
}

/** A state with a finished search, a selection, and a ready recipe. */
function investigatedState(): WorkspaceState {
  let state = createInitialState('inv-1')
  state = workspaceReducer(state, { type: 'set-draft', draft: 'test draft' })
  state = workspaceReducer(state, {
    type: 'search-start',
    question: 'flood risk?',
    requestId: 1,
    startedAt: 1000,
  })
  const record = makeRecord('a-1', 'record one')
  state = workspaceReducer(state, {
    type: 'search-success',
    investigationId: 'inv-1',
    requestId: 1,
    result: makeDiscovery('flood risk?', record),
    endedAt: 4500,
  })
  state = workspaceReducer(state, {
    type: 'toggle-live',
    record,
    source: 'ai',
    at: 4600,
  })
  state = workspaceReducer(state, {
    type: 'recipe-start',
    requestId: 1,
    startedAt: 5000,
  })
  state = workspaceReducer(state, {
    type: 'recipe-success',
    investigationId: 'inv-1',
    requestId: 1,
    data: makeRecipe('flood risk?', ['a-1']),
    question: 'flood risk?',
    ids: ['a-1'],
    endedAt: 9000,
  })
  return state
}

describe('navigation preserves the investigation', () => {
  it('keeps draft, submitted question, results, and durations across views', () => {
    let state = investigatedState()
    state = workspaceReducer(state, { type: 'set-view', view: 'recipe' })
    state = workspaceReducer(state, { type: 'set-view', view: 'catalog' })
    state = workspaceReducer(state, { type: 'set-view', view: 'discover' })
    assert.equal(state.draftQuestion, 'test draft')
    assert.equal(state.submittedQuestion, 'flood risk?')
    assert.equal(state.liveQuestion, 'flood risk?')
    assert.equal(state.aiSearch.status, 'ready')
    assert.equal(state.aiSearch.result?.question, 'flood risk?')
    assert.equal(state.aiSearch.durationMs, 3500)
    assert.equal(state.recipe.status, 'ready')
    assert.equal(state.recipe.durationMs, 4000)
    assert.deepEqual(selectedIds(state), ['a-1'])
    assert.equal(isRecipeStale(state), false)
  })

  it('stores completed durations instead of restarting a timer at zero', () => {
    let state = createInitialState('inv-1')
    state = workspaceReducer(state, {
      type: 'search-start',
      question: 'q',
      requestId: 1,
      startedAt: 1000,
    })
    // A failed attempt keeps the previous completed result and duration.
    state = workspaceReducer(state, {
      type: 'search-error',
      investigationId: 'inv-1',
      requestId: 1,
      error: 'boom',
      endedAt: 2000,
      interrupted: false,
    })
    assert.equal(state.aiSearch.durationMs, null)
    state = workspaceReducer(state, {
      type: 'search-start',
      question: 'q',
      requestId: 2,
      startedAt: 3000,
    })
    const record = makeRecord('a-1', 'record one')
    state = workspaceReducer(state, {
      type: 'search-success',
      investigationId: 'inv-1',
      requestId: 2,
      result: makeDiscovery('q', record),
      endedAt: 8000,
    })
    assert.equal(state.aiSearch.durationMs, 5000)
    // A later failed refresh still shows the previous completed duration.
    state = workspaceReducer(state, {
      type: 'search-start',
      question: 'q',
      requestId: 3,
      startedAt: 9000,
    })
    state = workspaceReducer(state, {
      type: 'search-error',
      investigationId: 'inv-1',
      requestId: 3,
      error: 'boom',
      endedAt: 9500,
      interrupted: false,
    })
    assert.equal(state.aiSearch.result?.question, 'q')
    assert.equal(state.aiSearch.durationMs, 5000)
  })

  it('ignores stale responses from superseded requests and investigations', () => {
    let state = createInitialState('inv-1')
    state = workspaceReducer(state, {
      type: 'search-start',
      question: 'first',
      requestId: 1,
      startedAt: 1000,
    })
    state = workspaceReducer(state, {
      type: 'search-start',
      question: 'second',
      requestId: 2,
      startedAt: 2000,
    })
    const stale = makeDiscovery('first', makeRecord('old', 'old'))
    state = workspaceReducer(state, {
      type: 'search-success',
      investigationId: 'inv-1',
      requestId: 1,
      result: stale,
      endedAt: 3000,
    })
    assert.equal(state.aiSearch.status, 'loading')
    assert.equal(state.aiSearch.result, null)
    state = workspaceReducer(state, {
      type: 'search-success',
      investigationId: 'inv-other',
      requestId: 2,
      result: stale,
      endedAt: 3000,
    })
    assert.equal(state.aiSearch.status, 'loading')
    const fresh = makeDiscovery('second', makeRecord('new', 'new'))
    state = workspaceReducer(state, {
      type: 'search-success',
      investigationId: 'inv-1',
      requestId: 2,
      result: fresh,
      endedAt: 3000,
    })
    assert.equal(state.aiSearch.status, 'ready')
    assert.equal(state.aiSearch.result?.question, 'second')
  })
})

describe('search cancellation', () => {
  it('records cancellation and preserves results, duration, and selection', () => {
    let state = investigatedState()
    state = workspaceReducer(state, {
      type: 'search-start',
      question: 'second?',
      requestId: 2,
      startedAt: 10_000,
    })
    state = workspaceReducer(state, {
      type: 'search-cancel',
      investigationId: 'inv-1',
      requestId: 3,
      endedAt: 11_000,
    })
    assert.equal(state.aiSearch.status, 'canceled')
    assert.equal(state.aiSearch.error, 'Search canceled')
    assert.equal(state.aiSearch.requestId, 3)
    assert.equal(state.aiSearch.result?.question, 'flood risk?')
    assert.equal(state.aiSearch.durationMs, 3500)
    assert.deepEqual(selectedIds(state), ['a-1'])
  })

  it('ignores late responses after a cancel, including past a new search', () => {
    let state = investigatedState()
    state = workspaceReducer(state, {
      type: 'search-start',
      question: 'second?',
      requestId: 2,
      startedAt: 10_000,
    })
    state = workspaceReducer(state, {
      type: 'search-cancel',
      investigationId: 'inv-1',
      requestId: 3,
      endedAt: 11_000,
    })
    // The canceled flight's late success carries the old identity: dropped.
    state = workspaceReducer(state, {
      type: 'search-success',
      investigationId: 'inv-1',
      requestId: 2,
      result: makeDiscovery('second?', makeRecord('late', 'late')),
      endedAt: 12_000,
    })
    assert.equal(state.aiSearch.status, 'canceled')
    assert.equal(state.aiSearch.result?.question, 'flood risk?')
    // A new search starts clean; the canceled flight still cannot land.
    state = workspaceReducer(state, {
      type: 'search-start',
      question: 'third?',
      requestId: 4,
      startedAt: 13_000,
    })
    state = workspaceReducer(state, {
      type: 'search-success',
      investigationId: 'inv-1',
      requestId: 2,
      result: makeDiscovery('second?', makeRecord('late', 'late')),
      endedAt: 14_000,
    })
    assert.equal(state.aiSearch.status, 'loading')
    state = workspaceReducer(state, {
      type: 'search-error',
      investigationId: 'inv-1',
      requestId: 3,
      error: 'late failure',
      endedAt: 14_000,
      interrupted: false,
    })
    assert.equal(state.aiSearch.status, 'loading')
    state = workspaceReducer(state, {
      type: 'search-success',
      investigationId: 'inv-1',
      requestId: 4,
      result: makeDiscovery('third?', makeRecord('fresh', 'fresh')),
      endedAt: 15_000,
    })
    assert.equal(state.aiSearch.status, 'ready')
    assert.equal(state.aiSearch.result?.question, 'third?')
  })

  it('ignores cancel when nothing is in flight or for other work', () => {
    const idle = investigatedState()
    assert.equal(
      workspaceReducer(idle, {
        type: 'search-cancel',
        investigationId: 'inv-1',
        requestId: 99,
        endedAt: 11_000,
      }),
      idle,
    )
    let loading = createInitialState('inv-1')
    loading = workspaceReducer(loading, {
      type: 'search-start',
      question: 'q',
      requestId: 1,
      startedAt: 1000,
    })
    assert.equal(
      workspaceReducer(loading, {
        type: 'search-cancel',
        investigationId: 'inv-other',
        requestId: 2,
        endedAt: 2000,
      }),
      loading,
    )
  })
})

describe('clear selection and new investigation', () => {
  it('clear preserves the question, results, and chat; undo restores', () => {
    let state = investigatedState()
    state = workspaceReducer(state, {
      type: 'push-message',
      message: { id: 'm-1', role: 'user', text: 'hello', at: 9500 },
    })
    state = workspaceReducer(state, { type: 'clear-selection' })
    assert.deepEqual(state.liveSelected, [])
    assert.equal(state.liveQuestion, 'flood risk?')
    assert.equal(state.aiSearch.result?.question, 'flood risk?')
    assert.equal(state.assistant.messages.length, 1)
    assert.equal(state.recipe.status, 'ready')
    assert.equal(isRecipeStale(state), true)
    assert.notEqual(state.lastCleared, null)
    state = workspaceReducer(state, { type: 'undo-clear-selection' })
    assert.deepEqual(selectedIds(state), ['a-1'])
    assert.equal(isRecipeStale(state), false)
    assert.equal(state.lastCleared, null)
  })

  it('new investigation clears the work but keeps theme-adjacent prefs', () => {
    let state = investigatedState()
    state = workspaceReducer(state, { type: 'set-assistant-open', open: false })
    state = workspaceReducer(state, { type: 'set-assistant-width', width: 400 })
    state = workspaceReducer(state, { type: 'catalog-set-size', size: 25 })
    state = workspaceReducer(state, {
      type: 'push-message',
      message: { id: 'm-1', role: 'user', text: 'hello', at: 9500 },
    })
    state = workspaceReducer(state, {
      type: 'new-investigation',
      investigationId: 'inv-2',
    })
    assert.equal(state.investigationId, 'inv-2')
    assert.equal(state.draftQuestion, '')
    assert.equal(state.submittedQuestion, null)
    assert.equal(state.liveQuestion, null)
    assert.equal(state.aiSearch.status, 'idle')
    assert.equal(state.aiSearch.result, null)
    assert.deepEqual(state.liveSelected, [])
    assert.equal(state.recipe.status, 'idle')
    assert.equal(state.recipe.data, null)
    assert.deepEqual(state.assistant.messages, [])
    assert.equal(state.assistant.open, false)
    assert.equal(state.assistant.width, 400)
    assert.equal(state.catalog.pageSize, 25)
    assert.equal(state.catalog.pageNum, 1)
    // Old responses keyed to the previous investigation cannot repopulate it.
    state = workspaceReducer(state, {
      type: 'search-success',
      investigationId: 'inv-1',
      requestId: 1,
      result: makeDiscovery('flood risk?', makeRecord('a-1', 'x')),
      endedAt: 9999,
    })
    assert.equal(state.aiSearch.status, 'idle')
    assert.equal(recipeInputsValid(state), false)
  })
})

describe('catalog UI and assistant prefs', () => {
  it('keeps expanded details and per-view scroll across navigation', () => {
    let state = createInitialState('inv-1')
    state = workspaceReducer(state, {
      type: 'catalog-toggle-expanded',
      key: 'a-1',
    })
    state = workspaceReducer(state, {
      type: 'save-scroll',
      view: 'catalog',
      y: 320,
    })
    state = workspaceReducer(state, { type: 'set-view', view: 'recipe' })
    state = workspaceReducer(state, { type: 'set-view', view: 'catalog' })
    assert.deepEqual(state.catalog.expanded, ['a-1'])
    assert.equal(state.scroll.catalog, 320)
    state = workspaceReducer(state, {
      type: 'catalog-toggle-expanded',
      key: 'a-1',
    })
    assert.deepEqual(state.catalog.expanded, [])
  })

  it('clamps the assistant panel width', () => {
    let state = createInitialState('inv-1')
    state = workspaceReducer(state, { type: 'set-assistant-width', width: 10 })
    assert.equal(state.assistant.width, ASSISTANT_MIN_WIDTH)
    state = workspaceReducer(state, {
      type: 'set-assistant-width',
      width: 9999,
    })
    assert.equal(state.assistant.width, ASSISTANT_MAX_WIDTH)
  })

  it('caches catalog pages so navigation never refetches', () => {
    let state = createInitialState('inv-1')
    state = workspaceReducer(state, { type: 'catalog-start', requestId: 1 })
    state = workspaceReducer(state, {
      type: 'catalog-success',
      requestId: 1,
      status: null,
      page: makePreview(),
      targetPage: 1,
      targetOffset: 0,
      size: 10,
    })
    state = workspaceReducer(state, { type: 'set-view', view: 'recipe' })
    state = workspaceReducer(state, { type: 'set-view', view: 'catalog' })
    assert.equal(state.catalog.page?.records.length, 1)
    assert.equal(state.catalog.loading, false)
  })
})

describe('versioned persistence', () => {
  it('round-trips the investigation through storage', () => {
    const storage = new MemoryStorage()
    const before = investigatedState()
    assert.equal(saveWorkspace(storage, before), 'saved')
    const raw = storage.raw()
    assert.ok(raw !== null && raw.length < MAX_PERSIST_BYTES)
    assert.equal(
      (JSON.parse(raw) as { version: number }).version,
      WORKSPACE_STORAGE_VERSION,
    )
    const loaded = loadWorkspace(storage)
    assert.equal(loaded.ok, true)
    if (!loaded.ok) return
    const after = workspaceReducer(before, {
      type: 'hydrate',
      persisted: loaded.value,
    })
    assert.equal(after.draftQuestion, 'test draft')
    assert.equal(after.liveQuestion, 'flood risk?')
    assert.equal(after.aiSearch.durationMs, 3500)
    assert.equal(after.recipe.durationMs, 4000)
    assert.deepEqual(selectedIds(after), ['a-1'])
  })

  it('reload during a request restores an interrupted retry state', () => {
    const storage = new MemoryStorage()
    let state = investigatedState()
    state = workspaceReducer(state, {
      type: 'search-start',
      question: 'second try',
      requestId: 2,
      startedAt: 10_000,
    })
    state = workspaceReducer(state, {
      type: 'recipe-start',
      requestId: 2,
      startedAt: 10_000,
    })
    assert.equal(saveWorkspace(storage, state), 'saved')
    const loaded = loadWorkspace(storage)
    assert.equal(loaded.ok, true)
    if (!loaded.ok) return
    assert.equal(loaded.value.aiSearch.status, 'error')
    assert.equal(loaded.value.aiSearch.interrupted, true)
    assert.equal(loaded.value.aiSearch.error, SEARCH_INTERRUPTED_MESSAGE)
    assert.equal(loaded.value.aiSearch.result?.question, 'flood risk?')
    assert.equal(loaded.value.recipe.status, 'error')
    assert.equal(loaded.value.recipe.interrupted, true)
    assert.equal(loaded.value.recipe.error, RECIPE_INTERRUPTED_MESSAGE)
  })

  it('discards invalid and version-mismatched payloads', () => {
    const storage = new MemoryStorage()
    assert.deepEqual(loadWorkspace(storage), { ok: false, reason: 'missing' })
    storage.setItem(WORKSPACE_STORAGE_KEY, 'not json')
    assert.deepEqual(loadWorkspace(storage), { ok: false, reason: 'invalid' })
    storage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: 999, savedAt: 1 }),
    )
    assert.deepEqual(loadWorkspace(storage), {
      ok: false,
      reason: 'version-mismatch',
    })
    storage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: WORKSPACE_STORAGE_VERSION, savedAt: 1 }),
    )
    assert.deepEqual(loadWorkspace(storage), { ok: false, reason: 'invalid' })
  })

  it('trims oversized payloads, then reports when still too large', () => {
    const storage = new MemoryStorage()
    const big = investigatedState()
    const heavy: LiveRecord = {
      ...makeRecord('heavy', 'heavy record'),
      raw: { blob: 'x'.repeat(MAX_PERSIST_BYTES) },
    }
    const withHeavy = workspaceReducer(big, {
      type: 'select-page',
      records: [heavy],
      source: 'catalog',
      at: 9600,
    })
    assert.equal(saveWorkspace(storage, withHeavy), 'trimmed')
    const loaded = loadWorkspace(storage)
    assert.equal(loaded.ok, true)
    if (!loaded.ok) return
    const restored = loaded.value.liveSelected.find(
      (record) => record.assigned_id === 'heavy',
    )
    assert.deepEqual(restored?.raw, {})
    assert.equal(restored?.title, 'heavy record')

    // Untrimmable bulk (long prose, not raw metadata) refuses to save.
    let huge = createInitialState('inv-1')
    const record = makeRecord('a-1', 'record one')
    const discovery = makeDiscovery('q', record)
    discovery.recommendations = Array.from({ length: 400 }, (_, index) => ({
      record: makeRecord(`r-${index}`, `record ${index}`),
      relevance: 'direct',
      relevance_score: 90,
      why: 'y'.repeat(5000),
      limitations: [],
    }))
    huge = workspaceReducer(huge, {
      type: 'search-start',
      question: 'q',
      requestId: 1,
      startedAt: 1,
    })
    huge = workspaceReducer(huge, {
      type: 'search-success',
      investigationId: 'inv-1',
      requestId: 1,
      result: discovery,
      endedAt: 2,
    })
    assert.equal(saveWorkspace(storage, huge), 'too-large')
  })

  it('reports storage failures instead of throwing', () => {
    const storage = new QuotaStorage()
    assert.equal(saveWorkspace(storage, investigatedState()), 'unavailable')
  })
})

function makeScored(
  id: string,
  title: string,
  score: number,
): DiscoveryRecommendation {
  return {
    record: makeRecord(id, title),
    relevance: score >= 85 ? 'direct' : 'supporting',
    relevance_score: score,
    why: `why ${id}`,
    limitations: [],
  }
}

/** Full filter view with overrides over the store defaults. */
function viewWith(overrides: Partial<DiscoveryView>): DiscoveryView {
  return { ...defaultDiscoveryUI(), ...overrides }
}

describe('relevance filtering and sorting', () => {
  const items = [
    makeScored('a', 'Beta', 90),
    makeScored('b', 'Alpha', 85),
    makeScored('c', 'Gamma', 84),
    makeScored('d', 'Delta', 99),
  ]

  it('defaults to the full returned set, highest score first', () => {
    assert.deepEqual(defaultDiscoveryUI(), {
      minScore: 85,
      sort: 'score-desc',
      showAll: true,
      tag: '',
      publisher: '',
      itemType: '',
      text: '',
    })
    assert.equal(DEFAULT_MIN_RELEVANCE, 85)
    assert.deepEqual(
      visibleRecommendations(items, defaultDiscoveryUI()).map(
        (item) => item.record.assigned_id,
      ),
      ['d', 'a', 'b', 'c'],
    )
  })

  it('85+ preset keeps the boundary row: the threshold is inclusive', () => {
    assert.deepEqual(
      visibleRecommendations(
        items,
        viewWith({ minScore: 85, sort: 'score-desc', showAll: false }),
      ).map((item) => item.record.assigned_id),
      ['d', 'a', 'b'],
    )
  })

  it('show-all keeps the full returned set in the chosen order', () => {
    assert.deepEqual(
      visibleRecommendations(items, viewWith({ sort: 'score-asc' })).map(
        (item) => item.record.assigned_id,
      ),
      ['c', 'b', 'a', 'd'],
    )
    assert.deepEqual(
      visibleRecommendations(
        items,
        viewWith({ minScore: 100, sort: 'title' }),
      ).map((item) => item.record.assigned_id),
      ['b', 'a', 'd', 'c'],
    )
  })

  it('filters by the backend score without inventing numbers', () => {
    assert.deepEqual(
      filterRecommendations(
        items,
        viewWith({ minScore: 90, showAll: false }),
      ).map((item) => item.record.assigned_id),
      ['a', 'd'],
    )
    assert.equal(
      filterRecommendations(items, viewWith({ minScore: 100, showAll: false }))
        .length,
      0,
    )
    assert.equal(highestScore(items), 99)
    assert.equal(highestScore([]), null)
  })

  it('narrows by tag, publisher, type, and title or exact ID', () => {
    const tagged: DiscoveryRecommendation = {
      ...makeScored('t-1', 'Flood maps', 70),
      record: {
        ...makeRecord('t-1', 'Flood maps'),
        tags: ['Flooding', 'parcels'],
        organization_name: 'DC Water',
        portal_name: 'DC Portal',
        item_type: 'Feature Layer',
      },
    }
    const other = makeScored('o-2', 'Bird counts', 95)
    const set = [tagged, other]
    assert.deepEqual(
      filterRecommendations(set, viewWith({ tag: 'flood' })).map(
        (item) => item.record.assigned_id,
      ),
      ['t-1'],
    )
    assert.deepEqual(
      filterRecommendations(set, viewWith({ publisher: 'dc water' })).map(
        (item) => item.record.assigned_id,
      ),
      ['t-1'],
    )
    assert.deepEqual(
      filterRecommendations(set, viewWith({ publisher: 'dc portal' })).map(
        (item) => item.record.assigned_id,
      ),
      ['t-1'],
    )
    assert.deepEqual(
      filterRecommendations(set, viewWith({ itemType: 'feature' })).map(
        (item) => item.record.assigned_id,
      ),
      ['t-1'],
    )
    assert.deepEqual(
      filterRecommendations(set, viewWith({ text: 'bird' })).map(
        (item) => item.record.assigned_id,
      ),
      ['o-2'],
    )
    // An exact dataset ID matches even when the title does not contain it.
    assert.deepEqual(
      filterRecommendations(set, viewWith({ text: 't-1' })).map(
        (item) => item.record.assigned_id,
      ),
      ['t-1'],
    )
    // Predicates combine: tag plus a threshold neither satisfies alone.
    assert.deepEqual(
      filterRecommendations(
        set,
        viewWith({ tag: 'flood', minScore: 90, showAll: false }),
      ),
      [],
    )
  })

  it('leaves unscored rows out of thresholds but shows them when unfiltered', () => {
    const unscored: DiscoveryRecommendation = {
      ...makeScored('u', 'Mystery', 0),
      relevance_score: Number.NaN,
    }
    const set = [unscored, ...items]
    assert.equal(countUnscored(set), 1)
    assert.equal(countUnscored(items), 0)
    const filtered = visibleRecommendations(
      set,
      viewWith({ minScore: 0, showAll: false }),
    ).map((item) => item.record.assigned_id)
    assert.ok(!filtered.includes('u'))
    const all = visibleRecommendations(set, viewWith({})).map(
      (item) => item.record.assigned_id,
    )
    // Unscored rows sink below every scored row in score order.
    assert.deepEqual(all, ['d', 'a', 'b', 'c', 'u'])
  })

  it('breaks score ties by title, then ID', () => {
    const tied = [
      makeScored('z-2', 'Same', 90),
      makeScored('z-1', 'Same', 90),
      makeScored('y', 'Earlier', 90),
    ]
    assert.deepEqual(
      sortRecommendations(tied, 'score-desc').map(
        (item) => item.record.assigned_id,
      ),
      ['y', 'z-1', 'z-2'],
    )
  })

  it('clamps the minimum score instead of accepting garbage', () => {
    assert.equal(clampMinScore(150), 100)
    assert.equal(clampMinScore(-5), 0)
    assert.equal(clampMinScore(84.6), 85)
    assert.equal(clampMinScore(Number.NaN), DEFAULT_MIN_RELEVANCE)
  })
})

describe('discovery filter prefs in the store', () => {
  it('filter changes preserve results and selection', () => {
    let state = investigatedState()
    const before = state.aiSearch.result?.recommendations.length
    state = workspaceReducer(state, { type: 'set-min-score', minScore: 99 })
    state = workspaceReducer(state, {
      type: 'set-discovery-sort',
      sort: 'title',
    })
    state = workspaceReducer(state, {
      type: 'set-discovery-show-all',
      showAll: true,
    })
    state = workspaceReducer(state, { type: 'set-discovery-tag', tag: 'x' })
    state = workspaceReducer(state, {
      type: 'set-discovery-publisher',
      publisher: 'y',
    })
    state = workspaceReducer(state, {
      type: 'set-discovery-item-type',
      itemType: 'z',
    })
    state = workspaceReducer(state, { type: 'set-discovery-text', text: 'w' })
    assert.equal(state.discoveryUI.minScore, 99)
    assert.equal(state.discoveryUI.sort, 'title')
    assert.equal(state.discoveryUI.showAll, true)
    assert.equal(state.discoveryUI.tag, 'x')
    assert.equal(state.discoveryUI.publisher, 'y')
    assert.equal(state.discoveryUI.itemType, 'z')
    assert.equal(state.discoveryUI.text, 'w')
    // The returned set and the collection are untouched by presentation prefs.
    assert.equal(state.aiSearch.result?.recommendations.length, before)
    assert.deepEqual(selectedIds(state), ['a-1'])
  })

  it('moving the threshold lifts show-all; clear restores the defaults', () => {
    let state = investigatedState()
    assert.equal(state.discoveryUI.showAll, true)
    state = workspaceReducer(state, { type: 'set-min-score', minScore: 90 })
    assert.equal(state.discoveryUI.minScore, 90)
    assert.equal(state.discoveryUI.showAll, false)
    state = workspaceReducer(state, { type: 'set-discovery-tag', tag: 'x' })
    state = workspaceReducer(state, { type: 'clear-discovery-filters' })
    assert.deepEqual(state.discoveryUI, defaultDiscoveryUI())
    // Clearing filters never touches the returned set or the collection.
    assert.equal(state.aiSearch.result?.recommendations.length, 1)
    assert.deepEqual(selectedIds(state), ['a-1'])
  })

  it('new searches keep the threshold; nothing changes it silently', () => {
    let state = investigatedState()
    state = workspaceReducer(state, { type: 'set-min-score', minScore: 70 })
    state = workspaceReducer(state, {
      type: 'search-start',
      question: 'second?',
      requestId: 2,
      startedAt: 10_000,
    })
    state = workspaceReducer(state, {
      type: 'search-success',
      investigationId: 'inv-1',
      requestId: 2,
      result: makeDiscovery('second?', makeRecord('a-2', 'record two')),
      endedAt: 11_000,
    })
    assert.equal(state.discoveryUI.minScore, 70)
    assert.equal(state.aiSearch.result?.question, 'second?')
  })

  it('persists filter prefs across a save/load round-trip', () => {
    const storage = new MemoryStorage()
    let state = investigatedState()
    state = workspaceReducer(state, { type: 'set-min-score', minScore: 70 })
    state = workspaceReducer(state, {
      type: 'set-discovery-sort',
      sort: 'score-asc',
    })
    state = workspaceReducer(state, {
      type: 'set-discovery-show-all',
      showAll: true,
    })
    state = workspaceReducer(state, { type: 'set-discovery-tag', tag: 't' })
    state = workspaceReducer(state, {
      type: 'set-discovery-publisher',
      publisher: 'p',
    })
    state = workspaceReducer(state, {
      type: 'set-discovery-item-type',
      itemType: 'y',
    })
    state = workspaceReducer(state, { type: 'set-discovery-text', text: 'q' })
    assert.equal(saveWorkspace(storage, state), 'saved')
    const loaded = loadWorkspace(storage)
    assert.equal(loaded.ok, true)
    if (!loaded.ok) return
    const after = workspaceReducer(state, {
      type: 'hydrate',
      persisted: loaded.value,
    })
    assert.deepEqual(after.discoveryUI, {
      minScore: 70,
      sort: 'score-asc',
      showAll: true,
      tag: 't',
      publisher: 'p',
      itemType: 'y',
      text: 'q',
    })
  })

  it('hydrates saves that predate the text filters', () => {
    const storage = new MemoryStorage()
    assert.equal(saveWorkspace(storage, investigatedState()), 'saved')
    const raw = storage.raw()
    assert.ok(raw !== null)
    const parsed = JSON.parse(raw as string) as {
      discoveryUI: Record<string, unknown>
    }
    delete parsed.discoveryUI.tag
    delete parsed.discoveryUI.publisher
    delete parsed.discoveryUI.itemType
    delete parsed.discoveryUI.text
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(parsed))
    const loaded = loadWorkspace(storage)
    assert.equal(loaded.ok, true)
    if (!loaded.ok) return
    const after = workspaceReducer(createInitialState('inv-9'), {
      type: 'hydrate',
      persisted: loaded.value,
    })
    assert.equal(after.discoveryUI.tag, '')
    assert.equal(after.discoveryUI.publisher, '')
    assert.equal(after.discoveryUI.itemType, '')
    assert.equal(after.discoveryUI.text, '')
    assert.equal(after.liveQuestion, 'flood risk?')
  })

  it('migrates saves stored under the pre-rename key', () => {
    const source = new MemoryStorage()
    assert.equal(saveWorkspace(source, investigatedState()), 'saved')
    const raw = source.raw()
    assert.ok(raw !== null)
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_WORKSPACE_STORAGE_KEY, raw as string)
    const loaded = loadWorkspace(storage)
    assert.equal(loaded.ok, true)
    if (!loaded.ok) return
    assert.equal(loaded.value.liveQuestion, 'flood risk?')
    // The next save lands on the new key.
    const after = workspaceReducer(createInitialState('inv-9'), {
      type: 'hydrate',
      persisted: loaded.value,
    })
    assert.equal(saveWorkspace(storage, after), 'saved')
    assert.ok(storage.raw() !== null)
  })
})

function makeMultiDiscovery(
  question: string,
  items: DiscoveryRecommendation[],
): DiscoveryResponse {
  const base = makeDiscovery(question, makeRecord('unused', 'unused'))
  return { ...base, recommendations: items }
}

function chatAction(partial: Partial<ChatAction> & { op: ChatAction['op'] }): ChatAction {
  return {
    assigned_ids: [],
    count: null,
    min_score: null,
    sort: null,
    ...partial,
  }
}

/** A searched state with four scored recommendations and no selection. */
function chattedState(): WorkspaceState {
  let state = createInitialState('inv-1')
  state = workspaceReducer(state, {
    type: 'search-start',
    question: 'flood risk?',
    requestId: 1,
    startedAt: 1000,
  })
  const items = [
    makeScored('a', 'Beta', 90),
    makeScored('b', 'Alpha', 85),
    makeScored('c', 'Gamma', 84),
    makeScored('d', 'Delta', 99),
  ]
  state = workspaceReducer(state, {
    type: 'search-success',
    investigationId: 'inv-1',
    requestId: 1,
    result: makeMultiDiscovery('flood risk?', items),
    endedAt: 2000,
  })
  return state
}

function startChat(state: WorkspaceState, requestId: number): WorkspaceState {
  return workspaceReducer(state, {
    type: 'chat-start',
    requestId,
    message: { id: `u-${requestId}`, role: 'user', text: 'hi', at: 3000 },
  })
}

function succeedChat(
  state: WorkspaceState,
  options: {
    requestId: number
    actions: ChatAction[]
    investigationId?: string
    suggestedQuestion?: string | null
  },
): WorkspaceState {
  return workspaceReducer(state, {
    type: 'chat-success',
    investigationId: options.investigationId ?? 'inv-1',
    requestId: options.requestId,
    reply: {
      id: `a-${options.requestId}`,
      role: 'assistant',
      text: 'done',
      at: 3100,
    },
    actions: options.actions,
    suggestedQuestion: options.suggestedQuestion ?? null,
    changeSummary: null,
    at: 3100,
  })
}

describe('assistant chat turns', () => {
  it('select-top applies immediately with a summary and undo', () => {
    let state = startChat(chattedState(), 1)
    assert.equal(state.assistant.chatStatus, 'loading')
    assert.equal(state.assistant.messages.length, 1)
    state = succeedChat(state, {
      requestId: 1,
      actions: [chatAction({ op: 'select_top', count: 2 })],
    })
    assert.equal(state.assistant.chatStatus, 'idle')
    assert.equal(state.assistant.messages.length, 2)
    // Visible order is score-desc over the full set by default: d, a, b, c.
    assert.deepEqual(selectedIds(state), ['d', 'a'])
    assert.ok(state.assistant.lastChangeSummary?.includes('2 datasets'))
    assert.notEqual(state.chatApplied, null)
    state = workspaceReducer(state, { type: 'chat-undo-applied' })
    assert.deepEqual(selectedIds(state), [])
    assert.equal(state.chatApplied, null)
    assert.ok(state.assistant.lastChangeSummary?.startsWith('Undid:'))
  })

  it('ignores stale chat responses from other investigations and requests', () => {
    const state = startChat(chattedState(), 2)
    const stale = succeedChat(state, {
      requestId: 1,
      actions: [chatAction({ op: 'select_top', count: 2 })],
    })
    assert.equal(stale.assistant.messages.length, 1)
    assert.deepEqual(selectedIds(stale), [])
    const foreign = succeedChat(state, {
      requestId: 2,
      investigationId: 'inv-other',
      actions: [chatAction({ op: 'select_top', count: 2 })],
    })
    assert.equal(foreign.assistant.messages.length, 1)
    assert.deepEqual(selectedIds(foreign), [])
    // A new investigation also drops a late response keyed to the old one.
    let fresh = workspaceReducer(state, {
      type: 'new-investigation',
      investigationId: 'inv-2',
    })
    fresh = succeedChat(fresh, {
      requestId: 2,
      investigationId: 'inv-1',
      actions: [chatAction({ op: 'select_top', count: 2 })],
    })
    assert.equal(fresh.assistant.messages.length, 0)
    assert.equal(fresh.assistant.chatStatus, 'idle')
  })

  it('explanations and malformed actions never mutate state', () => {
    let state = startChat(chattedState(), 1)
    state = succeedChat(state, {
      requestId: 1,
      actions: [
        chatAction({ op: 'explain', assigned_ids: ['d'] }),
        chatAction({ op: 'compare', assigned_ids: ['d', 'a'] }),
      ],
    })
    assert.deepEqual(selectedIds(state), [])
    assert.deepEqual(state.discoveryUI, defaultDiscoveryUI())
    assert.equal(state.chatApplied, null)
    assert.equal(state.assistant.messages.length, 2)

    state = startChat(state, 2)
    state = succeedChat(state, {
      requestId: 2,
      actions: [
        chatAction({ op: 'add', assigned_ids: ['ghost-id'] }),
        { op: 'teleport', assigned_ids: [], count: null, min_score: null, sort: null } as unknown as ChatAction,
      ],
    })
    // Unknown IDs resolve to nothing; unknown ops are skipped entirely.
    assert.deepEqual(selectedIds(state), [])
    assert.equal(state.chatApplied, null)
  })

  it('refinements compose and never restore filtered results', () => {
    let state = startChat(chattedState(), 1)
    state = succeedChat(state, {
      requestId: 1,
      actions: [chatAction({ op: 'refine', min_score: 90 })],
    })
    assert.equal(state.discoveryUI.minScore, 90)
    state = startChat(state, 2)
    state = succeedChat(state, {
      requestId: 2,
      // A lower request must not reopen results the first filter removed.
      actions: [chatAction({ op: 'refine', min_score: 70 })],
    })
    assert.equal(state.discoveryUI.minScore, 90)
    const result = state.aiSearch.result?.recommendations ?? []
    assert.deepEqual(
      visibleRecommendations(result, state.discoveryUI).map(
        (item) => item.record.assigned_id,
      ),
      ['d', 'a'],
    )
  })

  it('filtering stays separate from collection membership', () => {
    let state = startChat(chattedState(), 1)
    state = succeedChat(state, {
      requestId: 1,
      actions: [chatAction({ op: 'add', assigned_ids: ['c'] })],
    })
    // Adding a low-scoring recommendation works (it is still returned)
    // and leaves the visible filter prefs untouched.
    assert.deepEqual(selectedIds(state), ['c'])
    assert.deepEqual(state.discoveryUI, defaultDiscoveryUI())
    state = startChat(state, 2)
    state = succeedChat(state, {
      requestId: 2,
      actions: [chatAction({ op: 'refine', min_score: 95 })],
    })
    assert.equal(state.discoveryUI.minScore, 95)
    assert.deepEqual(selectedIds(state), ['c'])
    state = startChat(state, 3)
    state = succeedChat(state, {
      requestId: 3,
      actions: [chatAction({ op: 'reset_filters' })],
    })
    assert.deepEqual(state.discoveryUI, defaultDiscoveryUI())
    assert.deepEqual(selectedIds(state), ['c'])
  })

  it('chat failures preserve the selection, filters, and recipe', () => {
    let state = investigatedState()
    state = workspaceReducer(state, { type: 'set-min-score', minScore: 90 })
    state = startChat(state, 1)
    const before = {
      selected: selectedIds(state),
      filters: { ...state.discoveryUI },
      recipe: state.recipe,
    }
    state = workspaceReducer(state, {
      type: 'chat-error',
      investigationId: 'inv-1',
      requestId: 1,
      error: 'model timed out',
    })
    assert.equal(state.assistant.chatStatus, 'error')
    assert.equal(state.assistant.chatError, 'model timed out')
    assert.deepEqual(selectedIds(state), before.selected)
    assert.deepEqual(state.discoveryUI, before.filters)
    assert.equal(state.recipe, before.recipe)
  })

  it('chat turns never create, overwrite, or clear the recipe', () => {
    let state = investigatedState()
    const recipe = state.recipe
    state = startChat(state, 1)
    state = succeedChat(state, {
      requestId: 1,
      actions: [chatAction({ op: 'select_top', count: 1 })],
    })
    assert.equal(state.recipe, recipe)
    assert.equal(state.recipe.data?.objective, 'test objective')
    state = startChat(state, 2)
    state = succeedChat(state, {
      requestId: 2,
      actions: [chatAction({ op: 'remove', assigned_ids: ['a-1'] })],
    })
    // Removing the recipe's dataset marks it stale via the derived check,
    // but the stored recipe payload itself is untouched.
    assert.equal(state.recipe, recipe)
    assert.equal(isRecipeStale(state), true)
  })

  it('manual edits supersede the chat undo snapshot', () => {
    let state = startChat(chattedState(), 1)
    state = succeedChat(state, {
      requestId: 1,
      actions: [chatAction({ op: 'select_top', count: 1 })],
    })
    assert.notEqual(state.chatApplied, null)
    state = workspaceReducer(state, { type: 'set-min-score', minScore: 95 })
    assert.equal(state.chatApplied, null)
  })

  it('suggested questions persist until used or dismissed', () => {
    let state = startChat(chattedState(), 1)
    state = succeedChat(state, {
      requestId: 1,
      actions: [chatAction({ op: 'suggest_question' })],
      suggestedQuestion: 'Which facilities flood most often?',
    })
    assert.equal(
      state.assistant.suggestedQuestion,
      'Which facilities flood most often?',
    )
    state = startChat(state, 2)
    state = succeedChat(state, {
      requestId: 2,
      actions: [chatAction({ op: 'explain', assigned_ids: ['d'] })],
    })
    assert.equal(
      state.assistant.suggestedQuestion,
      'Which facilities flood most often?',
    )
    state = workspaceReducer(state, { type: 'chat-dismiss-suggestion' })
    assert.equal(state.assistant.suggestedQuestion, null)
  })
})

describe('assistant panel sizing and chat retry', () => {
  it('defaults to a desktop width in the 340-360px range', () => {
    assert.ok(
      ASSISTANT_DEFAULT_WIDTH >= 340 && ASSISTANT_DEFAULT_WIDTH <= 360,
    )
    assert.equal(
      createInitialState('inv-1').assistant.width,
      ASSISTANT_DEFAULT_WIDTH,
    )
  })

  it('caps the panel below the full app width on desktop viewports', () => {
    // Wide screens allow the full 640px expansion.
    assert.equal(maxAssistantWidth(1920), ASSISTANT_MAX_WIDTH)
    // Mid-size screens cap at 65% of the viewport (640px binds here).
    assert.equal(maxAssistantWidth(1280), ASSISTANT_MAX_WIDTH)
    // Tight desktops shrink the cap so nav + workspace stay readable.
    assert.equal(maxAssistantWidth(1100), 1100 - 232 - 360)
    for (const viewport of [1100, 1200, 1366, 1440, 1600, 1920]) {
      const max = maxAssistantWidth(viewport)
      assert.ok(max + 232 + 360 <= viewport)
      assert.ok(max >= ASSISTANT_MIN_WIDTH)
      assert.ok(max <= ASSISTANT_MAX_WIDTH)
    }
  })

  it('clamps the rendered width without changing the stored width', () => {
    assert.equal(effectiveAssistantWidth(9999, 1920), ASSISTANT_MAX_WIDTH)
    assert.equal(effectiveAssistantWidth(9999, 1100), 1100 - 232 - 360)
    assert.equal(effectiveAssistantWidth(10, 1920), ASSISTANT_MIN_WIDTH)
    assert.equal(effectiveAssistantWidth(351.6, 1920), 352)
    assert.equal(
      effectiveAssistantWidth(Number.NaN, 1920),
      ASSISTANT_DEFAULT_WIDTH,
    )
  })

  it('persists a resized width across a save/load round-trip', () => {
    const storage = new MemoryStorage()
    let state = investigatedState()
    state = workspaceReducer(state, {
      type: 'set-assistant-width',
      width: 480,
    })
    assert.equal(saveWorkspace(storage, state), 'saved')
    const loaded = loadWorkspace(storage)
    assert.equal(loaded.ok, true)
    if (!loaded.ok) return
    const after = workspaceReducer(state, {
      type: 'hydrate',
      persisted: loaded.value,
    })
    assert.equal(after.assistant.width, 480)
  })

  it('retries a failed turn without duplicating the user message', () => {
    let state = startChat(chattedState(), 1)
    state = workspaceReducer(state, {
      type: 'chat-error',
      investigationId: 'inv-1',
      requestId: 1,
      error: 'model timed out',
    })
    assert.equal(state.assistant.messages.length, 1)
    state = workspaceReducer(state, { type: 'chat-retry', requestId: 2 })
    assert.equal(state.assistant.chatStatus, 'loading')
    assert.equal(state.assistant.chatError, null)
    assert.equal(state.assistant.chatRequestId, 2)
    assert.equal(state.assistant.messages.length, 1)
    // The late original response is stale once the retry is in flight.
    const stale = succeedChat(state, {
      requestId: 1,
      actions: [chatAction({ op: 'select_top', count: 2 })],
    })
    assert.equal(stale.assistant.messages.length, 1)
    assert.deepEqual(selectedIds(stale), [])
  })

  it('ignores retry outside the error state or without a user message', () => {
    const idle = chattedState()
    assert.equal(
      workspaceReducer(idle, { type: 'chat-retry', requestId: 1 }),
      idle,
    )
    const loading = startChat(chattedState(), 1)
    assert.equal(
      workspaceReducer(loading, { type: 'chat-retry', requestId: 2 }),
      loading,
    )
    // An error with no user message to resend (defensive: cannot retry).
    let failed = workspaceReducer(createInitialState('inv-1'), {
      type: 'chat-error',
      investigationId: 'inv-1',
      requestId: 0,
      error: 'boom',
    })
    assert.equal(failed.assistant.chatStatus, 'error')
    failed = workspaceReducer(failed, { type: 'chat-retry', requestId: 1 })
    assert.equal(failed.assistant.chatStatus, 'error')
    assert.equal(failed.assistant.chatRequestId, 0)
  })
})

function guidanceWith(
  overrides: Partial<GuidanceInput>,
): GuidanceInput {
  return {
    investigation: 'q',
    selectionCount: 1,
    aiStatus: 'ready',
    recipeStatus: 'idle',
    recipeStale: false,
    ...overrides,
  }
}

describe('shared next-action guidance', () => {
  it('asks for a question before anything else exists', () => {
    assert.equal(
      nextAction(guidanceWith({ investigation: null })),
      'Ask a question in AI Discovery to begin.',
    )
    assert.equal(
      nextActionView(guidanceWith({ investigation: null })),
      'discover',
    )
  })

  it('points at the recipe once a collection exists', () => {
    const input = guidanceWith({})
    assert.equal(
      nextAction(input),
      'Review your dataset collection, then generate a data recipe.',
    )
    assert.equal(nextActionView(input), 'recipe')
  })

  it('flags a stale recipe and routes to the recipe view', () => {
    const input = guidanceWith({ recipeStatus: 'ready', recipeStale: true })
    assert.equal(
      nextAction(input),
      'Your recipe is out of date — regenerate it.',
    )
    assert.equal(nextActionView(input), 'recipe')
  })

  it('reports a failed recipe with its retry location', () => {
    assert.equal(
      nextAction(guidanceWith({ recipeStatus: 'error' })),
      'Recipe generation failed — retry from Data Recipe.',
    )
  })

  it('reports a canceled search as resumable, not failed', () => {
    assert.equal(
      nextAction(guidanceWith({ aiStatus: 'canceled' })),
      'The last search was canceled — run a new search when ready.',
    )
    assert.equal(
      nextActionView(guidanceWith({ aiStatus: 'canceled' })),
      'discover',
    )
  })
})

describe('recipe relationship graph', () => {
  it('links only datasets that share a workflow step', () => {
    const recipe = makeRecipe('q', ['a', 'b', 'c'])
    recipe.workflow = [
      { step: 1, title: 'Compare', detail: 'd', dataset_ids: ['a', 'b'] },
      { step: 2, title: 'Solo', detail: 'd', dataset_ids: ['c'] },
    ]
    const graph = buildRecipeGraph(recipe)
    assert.equal(graph.nodes.length, 3)
    assert.deepEqual(graph.links, [
      { a: 'a', b: 'b', kind: 'workflow', source: 'Step 1 · Compare' },
    ])
    assert.deepEqual(
      graph.nodes.find((node) => node.assignedId === 'a')?.steps,
      [1],
    )
    assert.deepEqual(
      graph.nodes.find((node) => node.assignedId === 'c')?.steps,
      [2],
    )
  })

  it('marks combination links proposed and skips unknown ids', () => {
    const recipe = makeRecipe('q', ['a', 'b'])
    recipe.combinations = [
      {
        dataset_ids: ['a', 'b', 'ghost'],
        approach: 'join',
        prerequisites: 'p',
        uncertainty: 'u',
      },
    ]
    const graph = buildRecipeGraph(recipe)
    assert.deepEqual(graph.links, [
      {
        a: 'a',
        b: 'b',
        kind: 'proposed',
        source: 'Proposed combination 1',
      },
    ])
  })

  it('emits no invented links for standalone datasets', () => {
    const recipe = makeRecipe('q', ['a', 'b'])
    const graph = buildRecipeGraph(recipe)
    assert.equal(graph.links.length, 0)
    assert.equal(graph.nodes.length, 2)
  })

  it('dedupes repeated pairs and truncates long labels', () => {
    const recipe = makeRecipe('q', ['a', 'b'])
    recipe.workflow = [
      { step: 1, title: 'First', detail: 'd', dataset_ids: ['a', 'b', 'a'] },
      { step: 2, title: 'First', detail: 'd', dataset_ids: ['b', 'a'] },
    ]
    const graph = buildRecipeGraph(recipe)
    assert.equal(graph.links.length, 2)
    assert.equal(shortNodeLabel('short title'), 'short title')
    assert.equal(shortNodeLabel('x'.repeat(40), 10), 'xxxxxxxxx…')
  })
})

describe('authoritative dataset links', () => {
  it('keeps http(s) links and rejects anything else', () => {
    const links = authoritativeLinks({
      access_url: 'https://example.test/page',
      service_endpoint_url: 'http://example.test/service',
      download_url: 'javascript:alert(1)',
    })
    assert.equal(links.sourcePage, 'https://example.test/page')
    assert.equal(links.serviceEndpoint, 'http://example.test/service')
    assert.equal(links.download, null)
  })

  it('treats blank and missing URLs as unavailable', () => {
    const links = authoritativeLinks({
      access_url: '   ',
      service_endpoint_url: null,
      download_url: null,
    })
    assert.deepEqual(links, {
      sourcePage: null,
      serviceEndpoint: null,
      download: null,
    })
    assert.equal(hasAnyLink(links), false)
    assert.equal(preferredShareLink(links), null)
  })

  it('prefers the source page, then endpoint, then download', () => {
    const onlyDownload = authoritativeLinks({
      access_url: null,
      service_endpoint_url: null,
      download_url: 'https://example.test/file.zip',
    })
    assert.equal(
      preferredShareLink(onlyDownload),
      'https://example.test/file.zip',
    )
    assert.equal(hasAnyLink(onlyDownload), true)
    const full = authoritativeLinks({
      access_url: 'https://example.test/page',
      service_endpoint_url: 'https://example.test/service',
      download_url: 'https://example.test/file.zip',
    })
    assert.equal(preferredShareLink(full), 'https://example.test/page')
  })

  it('accepts recipe refs without endpoint or download URLs', () => {
    const links = authoritativeLinks({
      access_url: 'https://example.test/page',
    })
    assert.equal(links.sourcePage, 'https://example.test/page')
    assert.equal(links.serviceEndpoint, null)
    assert.equal(links.download, null)
  })
})
