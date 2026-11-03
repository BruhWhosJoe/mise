import type { LiveRecord } from '../services/api'
import type { AISearchState, RecipeState, View } from '../types'
import { isDiscoverySort } from '../utils/discoveryFilter'
import type {
  ChatMessage,
  DiscoveryUIState,
  SelectionMeta,
  WorkspaceState,
} from './workspaceTypes'

export const WORKSPACE_STORAGE_KEY = 'mf-workspace-v1'
// Version 2: discovery recommendations carry AI relevance scores and the
// results filter prefs are persisted. Older payloads are discarded (fresh
// start) rather than shown without scores.
export const WORKSPACE_STORAGE_VERSION = 2
/** Approximate serialized size cap; payloads above it are trimmed first. */
export const MAX_PERSIST_BYTES = 750_000
export const MAX_PERSIST_EXPANDED = 100
export const MAX_PERSIST_MESSAGES = 100

export const SEARCH_INTERRUPTED_MESSAGE =
  'The search was interrupted before it finished. Retry to continue.'
export const RECIPE_INTERRUPTED_MESSAGE =
  'Recipe generation was interrupted before it finished. Retry to continue.'

/** Only the catalog UI slice is persisted; page data is refetched fresh. */
export interface PersistedCatalogUI {
  pageNum: number
  pageSize: number
  expanded: string[]
}

export interface PersistedAssistant {
  open: boolean
  width: number
  messages: ChatMessage[]
}

export interface PersistedWorkspace {
  version: number
  savedAt: number
  investigationId: string
  view: View
  draftQuestion: string
  submittedQuestion: string | null
  aiSearch: AISearchState
  discoveryUI: DiscoveryUIState
  liveQuestion: string | null
  liveSelected: LiveRecord[]
  selectionMeta: Record<string, SelectionMeta>
  recipe: RecipeState
  catalogUI: PersistedCatalogUI
  scroll: Record<View, number>
  assistant: PersistedAssistant
}

/** localStorage subset, injected so saves/loads are testable. */
export interface MinimalStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type SaveResult = 'saved' | 'trimmed' | 'too-large' | 'unavailable'

export type LoadResult =
  | { ok: true; value: PersistedWorkspace }
  | { ok: false; reason: 'missing' | 'invalid' | 'version-mismatch' }

function stripRecord(record: LiveRecord): LiveRecord {
  return { ...record, raw: {} }
}

function serializeFull(state: WorkspaceState): PersistedWorkspace {
  return {
    version: WORKSPACE_STORAGE_VERSION,
    savedAt: Date.now(),
    investigationId: state.investigationId,
    view: state.view,
    draftQuestion: state.draftQuestion,
    submittedQuestion: state.submittedQuestion,
    aiSearch: state.aiSearch,
    discoveryUI: { ...state.discoveryUI },
    liveQuestion: state.liveQuestion,
    liveSelected: state.liveSelected,
    selectionMeta: state.selectionMeta,
    recipe: state.recipe,
    catalogUI: {
      pageNum: state.catalog.pageNum,
      pageSize: state.catalog.pageSize,
      expanded: state.catalog.expanded.slice(0, MAX_PERSIST_EXPANDED),
    },
    scroll: state.scroll,
    assistant: {
      open: state.assistant.open,
      width: state.assistant.width,
      messages: state.assistant.messages.slice(-MAX_PERSIST_MESSAGES),
    },
  }
}

/**
 * Trimmed copy: drops verbose per-record `raw` technical metadata (refetched
 * on demand from the detail endpoint) while keeping every result, selection,
 * and message intact.
 */
function serializeTrimmed(state: WorkspaceState): PersistedWorkspace {
  const full = serializeFull(state)
  const result = full.aiSearch.result
  return {
    ...full,
    draftQuestion: full.draftQuestion.slice(0, 20_000),
    aiSearch:
      result === null
        ? full.aiSearch
        : {
            ...full.aiSearch,
            result: {
              ...result,
              recommendations: result.recommendations.map((item) => ({
                ...item,
                record: stripRecord(item.record),
              })),
            },
          },
    liveSelected: full.liveSelected.map(stripRecord),
  }
}

function tryWrite(
  storage: MinimalStorage,
  payload: PersistedWorkspace,
): boolean {
  try {
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function saveWorkspace(
  storage: MinimalStorage,
  state: WorkspaceState,
): SaveResult {
  let payload: PersistedWorkspace
  try {
    payload = serializeFull(state)
  } catch {
    return 'unavailable'
  }
  let trimmed = false
  try {
    if (JSON.stringify(payload).length > MAX_PERSIST_BYTES) {
      payload = serializeTrimmed(state)
      trimmed = true
      if (JSON.stringify(payload).length > MAX_PERSIST_BYTES) {
        return 'too-large'
      }
    }
  } catch {
    return 'unavailable'
  }
  if (tryWrite(storage, payload)) {
    return trimmed ? 'trimmed' : 'saved'
  }
  if (!trimmed) {
    try {
      payload = serializeTrimmed(state)
    } catch {
      return 'unavailable'
    }
    if (tryWrite(storage, payload)) {
      return 'trimmed'
    }
  }
  return 'unavailable'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isView(value: unknown): value is View {
  return value === 'discover' || value === 'catalog' || value === 'recipe'
}

function isStatus(
  value: unknown,
): value is 'idle' | 'loading' | 'ready' | 'error' | 'canceled' {
  // 'canceled' is terminal (never rewritten to interrupted on load): the
  // user chose to stop, and the previous result stays as it was.
  return (
    value === 'idle' ||
    value === 'loading' ||
    value === 'ready' ||
    value === 'error' ||
    value === 'canceled'
  )
}

function isLiveRecord(value: unknown): value is LiveRecord {
  if (!isRecord(value)) return false
  const id = value.assigned_id
  return (
    (typeof id === 'string' || id === null) &&
    (typeof value.title === 'string' || value.title === null)
  )
}

function isAiSearch(value: unknown): value is AISearchState {
  if (!isRecord(value)) return false
  return (
    isStatus(value.status) &&
    (typeof value.question === 'string' || value.question === null) &&
    (typeof value.error === 'string' || value.error === null) &&
    (typeof value.startedAt === 'number' || value.startedAt === null) &&
    (typeof value.endedAt === 'number' || value.endedAt === null) &&
    (typeof value.durationMs === 'number' || value.durationMs === null) &&
    typeof value.requestId === 'number' &&
    typeof value.interrupted === 'boolean' &&
    (value.result === null || isRecord(value.result))
  )
}

function isRecipe(value: unknown): value is RecipeState {
  if (!isRecord(value)) return false
  return (
    isStatus(value.status) &&
    (value.data === null || isRecord(value.data)) &&
    (typeof value.question === 'string' || value.question === null) &&
    Array.isArray(value.ids) &&
    value.ids.every((id): id is string => typeof id === 'string') &&
    (typeof value.error === 'string' || value.error === null) &&
    (typeof value.startedAt === 'number' || value.startedAt === null) &&
    (typeof value.endedAt === 'number' || value.endedAt === null) &&
    (typeof value.durationMs === 'number' || value.durationMs === null) &&
    typeof value.requestId === 'number' &&
    typeof value.interrupted === 'boolean'
  )
}

function isSelectionMeta(value: unknown): value is SelectionMeta {
  if (!isRecord(value)) return false
  return (
    typeof value.addedAt === 'number' &&
    (value.source === 'ai' || value.source === 'catalog')
  )
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.text === 'string' &&
    typeof value.at === 'number'
  )
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((entry): entry is string => typeof entry === 'string')) {
    return null
  }
  return [...value]
}

function isPersistedWorkspace(value: unknown): value is PersistedWorkspace {
  if (!isRecord(value)) return false
  if (value.version !== WORKSPACE_STORAGE_VERSION) return false
  if (typeof value.savedAt !== 'number') return false
  if (typeof value.investigationId !== 'string' || value.investigationId === '') {
    return false
  }
  if (!isView(value.view)) return false
  if (typeof value.draftQuestion !== 'string') return false
  if (
    typeof value.submittedQuestion !== 'string' &&
    value.submittedQuestion !== null
  ) {
    return false
  }
  if (!isAiSearch(value.aiSearch)) return false
  if (!isRecord(value.discoveryUI)) return false
  if (
    typeof value.discoveryUI.minScore !== 'number' ||
    !isDiscoverySort(value.discoveryUI.sort) ||
    typeof value.discoveryUI.showAll !== 'boolean'
  ) {
    return false
  }
  if (typeof value.liveQuestion !== 'string' && value.liveQuestion !== null) {
    return false
  }
  if (!Array.isArray(value.liveSelected)) return false
  if (!value.liveSelected.every(isLiveRecord)) return false
  if (!isRecord(value.selectionMeta)) return false
  if (
    !Object.values(value.selectionMeta).every(isSelectionMeta)
  ) {
    return false
  }
  if (!isRecipe(value.recipe)) return false
  if (!isRecord(value.catalogUI)) return false
  if (
    typeof value.catalogUI.pageNum !== 'number' ||
    typeof value.catalogUI.pageSize !== 'number' ||
    asStringArray(value.catalogUI.expanded) === null
  ) {
    return false
  }
  if (!isRecord(value.scroll)) return false
  if (
    typeof value.scroll.discover !== 'number' ||
    typeof value.scroll.catalog !== 'number' ||
    typeof value.scroll.recipe !== 'number'
  ) {
    return false
  }
  if (!isRecord(value.assistant)) return false
  if (
    typeof value.assistant.open !== 'boolean' ||
    typeof value.assistant.width !== 'number' ||
    !Array.isArray(value.assistant.messages) ||
    !value.assistant.messages.every(isChatMessage)
  ) {
    return false
  }
  return true
}

/**
 * A reload during a request must never restore a permanent spinner or fake
 * completion: in-flight operations come back as interrupted with retry.
 */
export function toInterruptedSearch(previous: AISearchState): AISearchState {
  if (previous.status !== 'loading') return previous
  return {
    ...previous,
    status: 'error',
    error: SEARCH_INTERRUPTED_MESSAGE,
    endedAt: Date.now(),
    interrupted: true,
  }
}

export function toInterruptedRecipe(previous: RecipeState): RecipeState {
  if (previous.status !== 'loading') return previous
  return {
    ...previous,
    status: 'error',
    error: RECIPE_INTERRUPTED_MESSAGE,
    endedAt: Date.now(),
    interrupted: true,
  }
}

export function loadWorkspace(storage: MinimalStorage): LoadResult {
  let stored: string | null
  try {
    stored = storage.getItem(WORKSPACE_STORAGE_KEY)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  if (stored === null) return { ok: false, reason: 'missing' }
  let parsed: unknown
  try {
    parsed = JSON.parse(stored) as unknown
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (isRecord(parsed) && parsed.version !== WORKSPACE_STORAGE_VERSION) {
    return { ok: false, reason: 'version-mismatch' }
  }
  if (!isPersistedWorkspace(parsed)) {
    return { ok: false, reason: 'invalid' }
  }
  return {
    ok: true,
    value: {
      ...parsed,
      aiSearch: toInterruptedSearch(parsed.aiSearch),
      recipe: toInterruptedRecipe(parsed.recipe),
    },
  }
}
