import { RECIPE_MAX_DATASETS } from '../services/api'
import type { ChatAction, LiveRecord } from '../services/api'
import type { AISearchState, RecipeState } from '../types'
import {
  DEFAULT_MIN_RELEVANCE,
  clampMinScore,
  isDiscoverySort,
  scoredValue,
  sortRecommendations,
} from '../utils/discoveryFilter'
import type {
  CatalogUIState,
  ChatAppliedChange,
  ChatMessage,
  DiscoveryUIState,
  SelectionMeta,
  WorkspaceAction,
  WorkspaceState,
} from './workspaceTypes'

export const DEFAULT_PAGE_SIZE = 10
export const ASSISTANT_DEFAULT_WIDTH = 350
export const ASSISTANT_MIN_WIDTH = 240
export const ASSISTANT_MAX_WIDTH = 640
/** Left-nav column width on desktop; keep in sync with App.css `.shell`. */
export const NAV_WIDTH = 232
/** Minimum readable main-workspace width on desktop. */
export const MIN_WORKSPACE_WIDTH = 360
/** Viewport widths below this stack instead of showing side columns. */
export const STACKING_BREAKPOINT = 1100
export const MAX_EXPANDED_KEYS = 200
export const MAX_CHAT_MESSAGES = 200

/**
 * Widest the assistant may render at for a viewport: at most 640px and at
 * most 65% of the viewport, while the nav and a readable workspace always
 * keep their space. Below the stacking breakpoint the panel stacks
 * full-width, so the stored width is irrelevant there; this still returns
 * a sane bound for clamping.
 */
export function maxAssistantWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth < STACKING_BREAKPOINT) {
    return ASSISTANT_MAX_WIDTH
  }
  const available = Math.floor(viewportWidth - NAV_WIDTH - MIN_WORKSPACE_WIDTH)
  const share = Math.floor(viewportWidth * 0.65)
  return Math.min(
    ASSISTANT_MAX_WIDTH,
    Math.max(ASSISTANT_MIN_WIDTH, Math.min(available, share)),
  )
}

/** Stored width clamped to what the viewport can actually show. */
export function effectiveAssistantWidth(
  storedWidth: number,
  viewportWidth: number,
): number {
  const max = maxAssistantWidth(viewportWidth)
  const rounded = Math.round(storedWidth)
  if (!Number.isFinite(rounded)) return ASSISTANT_DEFAULT_WIDTH
  return Math.min(max, Math.max(ASSISTANT_MIN_WIDTH, rounded))
}

export function createInvestigationId(): string {
  return `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function idleAiSearch(): AISearchState {
  return {
    status: 'idle',
    question: null,
    result: null,
    error: null,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    requestId: 0,
    interrupted: false,
  }
}

export function idleRecipe(): RecipeState {
  return {
    status: 'idle',
    data: null,
    question: null,
    ids: [],
    error: null,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    requestId: 0,
    interrupted: false,
  }
}

export function defaultDiscoveryUI(): DiscoveryUIState {
  // New results show the full returned set, highest score first; the 85+
  // "Strong matches" preset and the custom threshold narrow from there.
  return {
    minScore: DEFAULT_MIN_RELEVANCE,
    sort: 'score-desc',
    showAll: true,
    tag: '',
    publisher: '',
    itemType: '',
    text: '',
  }
}

export function initialCatalogUI(pageSize: number = DEFAULT_PAGE_SIZE): CatalogUIState {
  return {
    pageNum: 1,
    pageSize,
    offsets: { 1: 0 },
    capped: false,
    page: null,
    status: null,
    loading: false,
    error: null,
    requestId: 0,
    interrupted: false,
    expanded: [],
  }
}

export function createInitialState(
  investigationId: string = createInvestigationId(),
): WorkspaceState {
  return {
    investigationId,
    view: 'discover',
    draftQuestion: '',
    submittedQuestion: null,
    aiSearch: idleAiSearch(),
    discoveryUI: defaultDiscoveryUI(),
    liveQuestion: null,
    liveSelected: [],
    selectionMeta: {},
    recipe: idleRecipe(),
    catalog: initialCatalogUI(),
    scroll: { discover: 0, catalog: 0, recipe: 0 },
    assistant: {
      open: true,
      width: ASSISTANT_DEFAULT_WIDTH,
      messages: [],
      chatStatus: 'idle',
      chatError: null,
      chatRequestId: 0,
      suggestedQuestion: null,
      lastChangeSummary: null,
      clearedChat: null,
    },
    lastCleared: null,
    lastClearedMeta: null,
    chatApplied: null,
    storageNotice: null,
  }
}

export function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const lookup = new Set(a)
  return b.every((id) => lookup.has(id))
}

export function selectedIds(state: WorkspaceState): string[] {
  return state.liveSelected
    .map((record) => record.assigned_id)
    .filter((id): id is string => id !== null)
}

/** A ready recipe is stale when the question or selection moved on. */
export function isRecipeStale(state: WorkspaceState): boolean {
  return (
    state.recipe.status === 'ready' &&
    state.recipe.data !== null &&
    (state.recipe.question !== state.liveQuestion ||
      !sameIdSet(state.recipe.ids, selectedIds(state)))
  )
}

export function recipeInputsValid(state: WorkspaceState): boolean {
  const ids = selectedIds(state)
  return (
    state.liveQuestion !== null &&
    state.liveQuestion.trim() !== '' &&
    ids.length >= 1 &&
    ids.length <= RECIPE_MAX_DATASETS
  )
}

/**
 * Stable key for a record card's expanded-details state. Assigned IDs persist
 * across reloads; the fallback only lasts for the session.
 */
export function expandedKeyForRecord(
  record: LiveRecord,
  fallback: string,
): string {
  return record.assigned_id ?? record.title ?? fallback
}

function completedDuration(
  startedAt: number | null,
  endedAt: number,
): number | null {
  if (startedAt === null) return null
  return Math.max(0, endedAt - startedAt)
}

function toggleExpanded(expanded: string[], key: string): string[] {
  if (expanded.includes(key)) {
    return expanded.filter((entry) => entry !== key)
  }
  if (expanded.length >= MAX_EXPANDED_KEYS) return expanded
  return [...expanded, key]
}

function isChatOp(value: unknown): value is ChatAction['op'] {
  return (
    value === 'explain' ||
    value === 'compare' ||
    value === 'select_top' ||
    value === 'add' ||
    value === 'remove' ||
    value === 'refine' ||
    value === 'reset_filters' ||
    value === 'undo' ||
    value === 'suggest_question' ||
    value === 'clarify'
  )
}

function isMutatingChatOp(op: ChatAction['op']): boolean {
  return (
    op === 'select_top' ||
    op === 'add' ||
    op === 'remove' ||
    op === 'refine' ||
    op === 'reset_filters' ||
    op === 'undo'
  )
}

/**
 * Resolve IDs to records from the current recommendations first, then the
 * existing selection. Unknown IDs resolve to nothing and are skipped.
 */
function resolveChatRecords(
  state: WorkspaceState,
  ids: readonly string[],
): LiveRecord[] {
  const recommendations = state.aiSearch.result?.recommendations ?? []
  const byId = new Map<string, LiveRecord>()
  for (const item of recommendations) {
    const id = item.record.assigned_id
    if (id !== null && !byId.has(id)) byId.set(id, item.record)
  }
  for (const record of state.liveSelected) {
    const id = record.assigned_id
    if (id !== null && !byId.has(id)) byId.set(id, record)
  }
  const resolved: LiveRecord[] = []
  for (const id of ids) {
    const record = byId.get(id)
    if (record && !resolved.some((item) => item.assigned_id === id)) {
      resolved.push(record)
    }
  }
  return resolved
}

function snapshotChatApplied(
  state: WorkspaceState,
  summary: string,
  at: number,
  messageId: string,
): ChatAppliedChange {
  return {
    id: `chat-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    summary,
    messageId,
    previousSelection: state.liveSelected,
    previousMeta: state.selectionMeta,
    previousDiscoveryUI: { ...state.discoveryUI },
    at,
  }
}

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case 'set-view':
      return state.view === action.view ? state : { ...state, view: action.view }

    case 'set-draft':
      return state.draftQuestion === action.draft
        ? state
        : { ...state, draftQuestion: action.draft }

    case 'search-start':
      // A new search starts clean: previous recommendations, the old
      // interpretation, and the old relevance filters leave the results area
      // immediately, so stale rows can never sit under a new question. The
      // collection, the completed duration, and the chat are untouched.
      return {
        ...state,
        submittedQuestion: action.question,
        liveQuestion: null,
        discoveryUI: defaultDiscoveryUI(),
        chatApplied: null,
        aiSearch: {
          ...state.aiSearch,
          status: 'loading',
          question: action.question,
          result: null,
          error: null,
          startedAt: action.startedAt,
          endedAt: null,
          requestId: action.requestId,
          interrupted: false,
        },
      }

    case 'search-success':
      if (
        action.investigationId !== state.investigationId ||
        action.requestId !== state.aiSearch.requestId
      ) {
        return state
      }
      return {
        ...state,
        liveQuestion: action.result.question,
        aiSearch: {
          status: 'ready',
          question: state.aiSearch.question,
          result: action.result,
          error: null,
          startedAt: state.aiSearch.startedAt,
          endedAt: action.endedAt,
          durationMs: completedDuration(
            state.aiSearch.startedAt,
            action.endedAt,
          ),
          requestId: action.requestId,
          interrupted: false,
        },
      }

    case 'search-error':
      if (
        action.investigationId !== state.investigationId ||
        action.requestId !== state.aiSearch.requestId
      ) {
        return state
      }
      return {
        ...state,
        aiSearch: {
          ...state.aiSearch,
          status: 'error',
          error: action.error,
          endedAt: action.endedAt,
          interrupted: action.interrupted,
        },
      }

    case 'search-cancel': {
      // Cancellation ends the in-flight search only: the completed duration
      // and the selection stay intact (results were already cleared when the
      // search started). The request identity rotates so a late response can
      // never overwrite the workspace — including after a newer search has
      // started.
      if (
        action.investigationId !== state.investigationId ||
        state.aiSearch.status !== 'loading'
      ) {
        return state
      }
      return {
        ...state,
        aiSearch: {
          ...state.aiSearch,
          status: 'canceled',
          error: 'Search canceled',
          endedAt: action.endedAt,
          requestId: action.requestId,
          interrupted: false,
        },
      }
    }

    case 'set-min-score': {
      // Moving the threshold is an explicit choice to filter: it lifts the
      // show-all default so the new minimum takes effect immediately.
      const minScore = clampMinScore(action.minScore)
      if (
        state.discoveryUI.minScore === minScore &&
        state.discoveryUI.showAll === false
      ) {
        return state
      }
      return {
        ...state,
        discoveryUI: { ...state.discoveryUI, minScore, showAll: false },
        chatApplied: null,
      }
    }

    case 'set-discovery-sort':
      if (!isDiscoverySort(action.sort)) return state
      return state.discoveryUI.sort === action.sort
        ? state
        : {
            ...state,
            discoveryUI: { ...state.discoveryUI, sort: action.sort },
            chatApplied: null,
          }

    case 'set-discovery-show-all':
      return state.discoveryUI.showAll === action.showAll
        ? state
        : {
            ...state,
            discoveryUI: { ...state.discoveryUI, showAll: action.showAll },
            chatApplied: null,
          }

    case 'set-discovery-tag':
      return state.discoveryUI.tag === action.tag
        ? state
        : {
            ...state,
            discoveryUI: { ...state.discoveryUI, tag: action.tag },
            chatApplied: null,
          }

    case 'set-discovery-publisher':
      return state.discoveryUI.publisher === action.publisher
        ? state
        : {
            ...state,
            discoveryUI: {
              ...state.discoveryUI,
              publisher: action.publisher,
            },
            chatApplied: null,
          }

    case 'set-discovery-item-type':
      return state.discoveryUI.itemType === action.itemType
        ? state
        : {
            ...state,
            discoveryUI: { ...state.discoveryUI, itemType: action.itemType },
            chatApplied: null,
          }

    case 'set-discovery-text':
      return state.discoveryUI.text === action.text
        ? state
        : {
            ...state,
            discoveryUI: { ...state.discoveryUI, text: action.text },
            chatApplied: null,
          }

    case 'clear-discovery-filters': {
      const defaults = defaultDiscoveryUI()
      const current = state.discoveryUI
      if (
        current.minScore === defaults.minScore &&
        current.sort === defaults.sort &&
        current.showAll === defaults.showAll &&
        current.tag === defaults.tag &&
        current.publisher === defaults.publisher &&
        current.itemType === defaults.itemType &&
        current.text === defaults.text
      ) {
        return state
      }
      return { ...state, discoveryUI: defaults, chatApplied: null }
    }

    case 'toggle-live': {
      const id = action.record.assigned_id
      if (id === null) return state
      const present = state.liveSelected.some(
        (item) => item.assigned_id === id,
      )
      if (present) {
        const selectionMeta: Record<string, SelectionMeta> = {
          ...state.selectionMeta,
        }
        delete selectionMeta[id]
        return {
          ...state,
          liveSelected: state.liveSelected.filter(
            (item) => item.assigned_id !== id,
          ),
          selectionMeta,
          lastCleared: null,
          lastClearedMeta: null,
          chatApplied: null,
        }
      }
      return {
        ...state,
        liveSelected: [...state.liveSelected, action.record],
        selectionMeta: {
          ...state.selectionMeta,
          [id]: { addedAt: action.at, source: action.source },
        },
        lastCleared: null,
        lastClearedMeta: null,
        chatApplied: null,
      }
    }

    case 'select-page': {
      const known = new Set(
        state.liveSelected.map((item) => item.assigned_id),
      )
      const fresh = action.records.filter(
        (record) =>
          record.assigned_id !== null && !known.has(record.assigned_id),
      )
      if (fresh.length === 0) return state
      const selectionMeta: Record<string, SelectionMeta> = {
        ...state.selectionMeta,
      }
      for (const record of fresh) {
        if (record.assigned_id !== null) {
          selectionMeta[record.assigned_id] = {
            addedAt: action.at,
            source: action.source,
          }
        }
      }
      return {
        ...state,
        liveSelected: [...state.liveSelected, ...fresh],
        selectionMeta,
        lastCleared: null,
        lastClearedMeta: null,
        chatApplied: null,
      }
    }

    case 'clear-selection':
      if (state.liveSelected.length === 0) return state
      return {
        ...state,
        liveSelected: [],
        selectionMeta: {},
        lastCleared: state.liveSelected,
        lastClearedMeta: state.selectionMeta,
        chatApplied: null,
      }

    case 'undo-clear-selection':
      if (state.lastCleared === null || state.lastClearedMeta === null) {
        return state
      }
      return {
        ...state,
        liveSelected: state.lastCleared,
        selectionMeta: state.lastClearedMeta,
        lastCleared: null,
        lastClearedMeta: null,
        chatApplied: null,
      }

    case 'recipe-start':
      return {
        ...state,
        recipe: {
          ...state.recipe,
          status: 'loading',
          error: null,
          startedAt: action.startedAt,
          endedAt: null,
          requestId: action.requestId,
          interrupted: false,
        },
      }

    case 'recipe-success':
      if (
        action.investigationId !== state.investigationId ||
        action.requestId !== state.recipe.requestId
      ) {
        return state
      }
      return {
        ...state,
        recipe: {
          status: 'ready',
          data: action.data,
          question: action.question,
          ids: action.ids,
          error: null,
          startedAt: state.recipe.startedAt,
          endedAt: action.endedAt,
          durationMs: completedDuration(
            state.recipe.startedAt,
            action.endedAt,
          ),
          requestId: action.requestId,
          interrupted: false,
        },
      }

    case 'recipe-error':
      if (
        action.investigationId !== state.investigationId ||
        action.requestId !== state.recipe.requestId
      ) {
        return state
      }
      return {
        ...state,
        recipe: {
          ...state.recipe,
          status: 'error',
          error: action.error,
          endedAt: action.endedAt,
          interrupted: action.interrupted,
        },
      }

    case 'catalog-start':
      return {
        ...state,
        catalog: {
          ...state.catalog,
          loading: true,
          error: null,
          requestId: action.requestId,
          interrupted: false,
        },
      }

    case 'catalog-success': {
      if (action.requestId !== state.catalog.requestId) return state
      const offsets: Record<number, number> = {
        ...state.catalog.offsets,
        [action.targetPage]: action.targetOffset,
      }
      if (action.page.next_offset !== null) {
        offsets[action.targetPage + 1] = action.page.next_offset
      }
      return {
        ...state,
        catalog: {
          ...state.catalog,
          status: action.status,
          page: action.page,
          pageNum: action.targetPage,
          pageSize: action.size,
          offsets,
          capped:
            action.page.returned < action.size &&
            action.page.has_more === true,
          loading: false,
          error: null,
        },
      }
    }

    case 'catalog-error':
      if (action.requestId !== state.catalog.requestId) return state
      return {
        ...state,
        catalog: {
          ...state.catalog,
          loading: false,
          error: action.error,
          interrupted: action.interrupted,
        },
      }

    case 'catalog-set-size':
      if (action.size === state.catalog.pageSize) return state
      return {
        ...state,
        catalog: {
          ...state.catalog,
          pageNum: 1,
          pageSize: action.size,
          offsets: { 1: 0 },
          capped: false,
          page: null,
          loading: false,
          error: null,
        },
      }

    case 'catalog-toggle-expanded':
      return {
        ...state,
        catalog: {
          ...state.catalog,
          expanded: toggleExpanded(state.catalog.expanded, action.key),
        },
      }

    case 'save-scroll': {
      if (!Number.isFinite(action.y) || action.y < 0) return state
      const y = Math.round(action.y)
      if (state.scroll[action.view] === y) return state
      return { ...state, scroll: { ...state.scroll, [action.view]: y } }
    }

    case 'set-assistant-open':
      return state.assistant.open === action.open
        ? state
        : {
            ...state,
            assistant: { ...state.assistant, open: action.open },
          }

    case 'set-assistant-width': {
      const width = Math.min(
        ASSISTANT_MAX_WIDTH,
        Math.max(ASSISTANT_MIN_WIDTH, Math.round(action.width)),
      )
      return state.assistant.width === width
        ? state
        : { ...state, assistant: { ...state.assistant, width } }
    }

    case 'push-message': {
      const messages = [...state.assistant.messages, action.message]
      const trimmed =
        messages.length > MAX_CHAT_MESSAGES
          ? messages.slice(messages.length - MAX_CHAT_MESSAGES)
          : messages
      return {
        ...state,
        assistant: { ...state.assistant, messages: trimmed },
      }
    }

    case 'chat-start': {
      const messages = [...state.assistant.messages, action.message]
      const trimmed =
        messages.length > MAX_CHAT_MESSAGES
          ? messages.slice(messages.length - MAX_CHAT_MESSAGES)
          : messages
      return {
        ...state,
        assistant: {
          ...state.assistant,
          messages: trimmed,
          chatStatus: 'loading',
          chatError: null,
          chatRequestId: action.requestId,
          // A fresh turn retires any pre-clear stash: Undo must never swap
          // new messages for cleared ones.
          clearedChat: null,
        },
      }
    }

    case 'chat-success': {
      if (
        action.investigationId !== state.investigationId ||
        action.requestId !== state.assistant.chatRequestId
      ) {
        return state
      }
      const messages = [...state.assistant.messages, action.reply]
      const trimmed =
        messages.length > MAX_CHAT_MESSAGES
          ? messages.slice(messages.length - MAX_CHAT_MESSAGES)
          : messages
      // Apply at most the first mutating action; readonly ops (explain,
      // compare, suggest_question, clarify) and unknown ops never mutate.
      // Filtering (refine/reset) never touches the collection, and
      // selection ops never touch filters. The recipe is never touched.
      let liveSelected = state.liveSelected
      let selectionMeta = state.selectionMeta
      let discoveryUI = state.discoveryUI
      let lastCleared = state.lastCleared
      let lastClearedMeta = state.lastClearedMeta
      let chatApplied = state.chatApplied
      let summary: string | null = null
      let mutated = false
      for (const raw of action.actions) {
        if (!isChatOp(raw.op)) continue
        if (!isMutatingChatOp(raw.op)) continue
        if (mutated) break
        mutated = true
        if (raw.op === 'undo') {
          if (chatApplied === null) {
            summary = 'Nothing to undo.'
          } else {
            liveSelected = chatApplied.previousSelection
            selectionMeta = chatApplied.previousMeta
            discoveryUI = chatApplied.previousDiscoveryUI
            summary = `Undid: ${chatApplied.summary}`
            chatApplied = null
          }
          break
        }
        if (raw.op === 'select_top') {
          const count =
            typeof raw.count === 'number' && Number.isFinite(raw.count)
              ? Math.floor(raw.count)
              : 0
          // Rank order, never the display order: filters and sort only
          // affect what the user sees. Unscored rows cannot be ranked, so
          // they are left out (the backend never sends them as context).
          const recommendations = state.aiSearch.result?.recommendations ?? []
          const ranked = sortRecommendations(recommendations, 'score-desc')
            .filter((item) => scoredValue(item) !== null)
            .slice(0, Math.max(0, count))
          const known = new Set(
            state.liveSelected.map((item) => item.assigned_id),
          )
          const fresh = ranked.filter(
            (item) =>
              item.record.assigned_id !== null &&
              !known.has(item.record.assigned_id),
          )
          if (count < 1 || ranked.length === 0) {
            summary = 'There are no scored recommendations to select yet.'
          } else if (fresh.length === 0) {
            summary =
              'Those recommendations are already in your collection.'
          } else {
            const noun = fresh.length === 1 ? 'dataset' : 'datasets'
            summary =
              `Added ${fresh.length} ${noun} to your collection ` +
              `(top ${ranked.length} by relevance).`
            chatApplied = snapshotChatApplied(
              state,
              summary,
              action.at,
              action.reply.id,
            )
            const nextMeta: Record<string, SelectionMeta> = {
              ...selectionMeta,
            }
            for (const item of fresh) {
              const id = item.record.assigned_id
              if (id !== null) {
                nextMeta[id] = { addedAt: action.at, source: 'ai' }
              }
            }
            liveSelected = [
              ...liveSelected,
              ...fresh.map((item) => item.record),
            ]
            selectionMeta = nextMeta
            lastCleared = null
            lastClearedMeta = null
          }
          break
        }
        if (raw.op === 'add') {
          const resolved = resolveChatRecords(state, raw.assigned_ids)
          const known = new Set(
            state.liveSelected.map((item) => item.assigned_id),
          )
          const fresh = resolved.filter(
            (record) =>
              record.assigned_id !== null &&
              !known.has(record.assigned_id),
          )
          if (fresh.length === 0) {
            summary =
              resolved.length === 0
                ? 'None of those IDs match the current recommendations.'
                : 'Those datasets are already in your collection.'
          } else {
            const noun = fresh.length === 1 ? 'dataset' : 'datasets'
            summary = `Added ${fresh.length} ${noun} to your collection.`
            chatApplied = snapshotChatApplied(
              state,
              summary,
              action.at,
              action.reply.id,
            )
            const nextMeta: Record<string, SelectionMeta> = {
              ...selectionMeta,
            }
            for (const record of fresh) {
              const id = record.assigned_id
              if (id !== null) {
                nextMeta[id] = { addedAt: action.at, source: 'ai' }
              }
            }
            liveSelected = [...liveSelected, ...fresh]
            selectionMeta = nextMeta
            lastCleared = null
            lastClearedMeta = null
          }
          break
        }
        if (raw.op === 'remove') {
          const doomed = new Set(raw.assigned_ids)
          const kept = state.liveSelected.filter(
            (record) =>
              record.assigned_id === null ||
              !doomed.has(record.assigned_id),
          )
          const removedCount = state.liveSelected.length - kept.length
          if (removedCount === 0) {
            summary = 'None of those datasets are in your collection.'
          } else {
            const noun = removedCount === 1 ? 'dataset' : 'datasets'
            summary = `Removed ${removedCount} ${noun} from your collection.`
            chatApplied = snapshotChatApplied(
              state,
              summary,
              action.at,
              action.reply.id,
            )
            const nextMeta: Record<string, SelectionMeta> = {
              ...selectionMeta,
            }
            for (const id of doomed) delete nextMeta[id]
            liveSelected = kept
            selectionMeta = nextMeta
            lastCleared = null
            lastClearedMeta = null
          }
          break
        }
        if (raw.op === 'refine') {
          // Refinements compose: the threshold only moves up, so a second
          // filter can never restore results removed by the first. A
          // threshold refinement also lifts the show-all default so the new
          // minimum takes effect; a sort-only refinement keeps it.
          const requested =
            typeof raw.min_score === 'number' &&
            Number.isFinite(raw.min_score)
              ? clampMinScore(raw.min_score)
              : null
          const nextMin =
            requested === null
              ? state.discoveryUI.minScore
              : Math.max(state.discoveryUI.minScore, requested)
          const nextSort =
            typeof raw.sort === 'string' && isDiscoverySort(raw.sort)
              ? raw.sort
              : state.discoveryUI.sort
          const minChanged =
            requested !== null &&
            (nextMin !== state.discoveryUI.minScore ||
              state.discoveryUI.showAll)
          const sortChanged = nextSort !== state.discoveryUI.sort
          if (!minChanged && !sortChanged) {
            summary =
              'The recommendations are already narrowed to that level.'
          } else {
            summary = minChanged
              ? `Narrowed the recommendations to relevance ${nextMin} ` +
                'and above.'
              : 'Re-sorted the current recommendations.'
            chatApplied = snapshotChatApplied(
              state,
              summary,
              action.at,
              action.reply.id,
            )
            discoveryUI = {
              ...state.discoveryUI,
              minScore: nextMin,
              sort: nextSort,
              showAll:
                requested === null ? state.discoveryUI.showAll : false,
            }
          }
          break
        }
        if (raw.op === 'reset_filters') {
          const defaults = defaultDiscoveryUI()
          if (
            state.discoveryUI.minScore === defaults.minScore &&
            state.discoveryUI.sort === defaults.sort &&
            state.discoveryUI.showAll === defaults.showAll
          ) {
            summary = 'The recommendation filters are already at defaults.'
          } else {
            summary = 'Reset the recommendation filters to their defaults.'
            chatApplied = snapshotChatApplied(
              state,
              summary,
              action.at,
              action.reply.id,
            )
            discoveryUI = defaults
          }
          break
        }
      }
      // The change summary travels with its own reply, so it always
      // renders directly under the response that applied it.
      const withSummary =
        summary === null
          ? trimmed
          : trimmed.map((entry) =>
              entry.id === action.reply.id
                ? { ...entry, changeSummary: summary }
                : entry,
            )
      return {
        ...state,
        liveSelected,
        selectionMeta,
        discoveryUI,
        lastCleared,
        lastClearedMeta,
        chatApplied,
        assistant: {
          ...state.assistant,
          messages: withSummary,
          chatStatus: 'idle',
          chatError: null,
          suggestedQuestion:
            action.suggestedQuestion ?? state.assistant.suggestedQuestion,
          lastChangeSummary: summary ?? state.assistant.lastChangeSummary,
        },
      }
    }

    case 'chat-error': {
      if (
        action.investigationId !== state.investigationId ||
        action.requestId !== state.assistant.chatRequestId
      ) {
        return state
      }
      return {
        ...state,
        assistant: {
          ...state.assistant,
          chatStatus: 'error',
          chatError: action.error,
        },
      }
    }

    case 'chat-clear-error':
      if (state.assistant.chatStatus !== 'error') return state
      return {
        ...state,
        assistant: {
          ...state.assistant,
          chatStatus: 'idle',
          chatError: null,
        },
      }

    case 'chat-retry': {
      // Retry resends the last user message without appending a duplicate
      // bubble; only valid from the error state.
      if (state.assistant.chatStatus !== 'error') return state
      const lastUser = [...state.assistant.messages]
        .reverse()
        .find((message) => message.role === 'user')
      if (lastUser === undefined) return state
      return {
        ...state,
        assistant: {
          ...state.assistant,
          chatStatus: 'loading',
          chatError: null,
          chatRequestId: action.requestId,
        },
      }
    }

    case 'chat-undo-applied': {
      const applied = state.chatApplied
      if (applied === null) return state
      // The undo lands in the conversation as its own message: the
      // original reply keeps its summary as history, and the "Undid"
      // note makes clear the change no longer holds.
      const undone: ChatMessage = {
        id: `undo-${applied.id}`,
        role: 'assistant',
        text: `Undid: ${applied.summary}`,
        at: applied.at,
      }
      const messages = [...state.assistant.messages, undone]
      const trimmed =
        messages.length > MAX_CHAT_MESSAGES
          ? messages.slice(messages.length - MAX_CHAT_MESSAGES)
          : messages
      return {
        ...state,
        liveSelected: applied.previousSelection,
        selectionMeta: applied.previousMeta,
        discoveryUI: applied.previousDiscoveryUI,
        chatApplied: null,
        assistant: {
          ...state.assistant,
          messages: trimmed,
          lastChangeSummary: `Undid: ${applied.summary}`,
        },
      }
    }

    case 'chat-dismiss-suggestion':
      if (state.assistant.suggestedQuestion === null) return state
      return {
        ...state,
        assistant: { ...state.assistant, suggestedQuestion: null },
      }

    case 'clear-chat': {
      // Quiet clear: only the message list is stashed for one Undo, so a
      // pending change summary keeps its own Undo reachable. Never during a
      // send — the panel keeps the button disabled while a reply is in
      // flight.
      if (
        state.assistant.messages.length === 0 ||
        state.assistant.chatStatus === 'loading'
      ) {
        return state
      }
      return {
        ...state,
        assistant: {
          ...state.assistant,
          messages: [],
          clearedChat: state.assistant.messages,
        },
      }
    }

    case 'undo-clear-chat': {
      if (state.assistant.clearedChat === null) return state
      return {
        ...state,
        assistant: {
          ...state.assistant,
          messages: state.assistant.clearedChat,
          clearedChat: null,
        },
      }
    }

    case 'new-investigation':
      return {
        ...state,
        investigationId: action.investigationId,
        draftQuestion: '',
        submittedQuestion: null,
        aiSearch: idleAiSearch(),
        liveQuestion: null,
        liveSelected: [],
        selectionMeta: {},
        recipe: idleRecipe(),
        catalog: {
          ...state.catalog,
          pageNum: 1,
          offsets: { 1: 0 },
          capped: false,
          page: null,
          loading: false,
          error: null,
          interrupted: false,
          expanded: [],
        },
        scroll: { discover: 0, catalog: 0, recipe: 0 },
        assistant: {
          ...state.assistant,
          messages: [],
          chatStatus: 'idle',
          chatError: null,
          chatRequestId: 0,
          suggestedQuestion: null,
          lastChangeSummary: null,
          clearedChat: null,
        },
        lastCleared: null,
        lastClearedMeta: null,
        chatApplied: null,
        storageNotice: null,
      }

    case 'hydrate':
      return {
        ...state,
        investigationId: action.persisted.investigationId,
        view: action.persisted.view,
        draftQuestion: action.persisted.draftQuestion,
        submittedQuestion: action.persisted.submittedQuestion,
        aiSearch: action.persisted.aiSearch,
        discoveryUI: {
          minScore: clampMinScore(action.persisted.discoveryUI.minScore),
          sort: isDiscoverySort(action.persisted.discoveryUI.sort)
            ? action.persisted.discoveryUI.sort
            : 'score-desc',
          showAll: action.persisted.discoveryUI.showAll === true,
          // Older version-2 saves predate the text filters: default them
          // instead of dropping the whole investigation.
          tag:
            typeof action.persisted.discoveryUI.tag === 'string'
              ? action.persisted.discoveryUI.tag
              : '',
          publisher:
            typeof action.persisted.discoveryUI.publisher === 'string'
              ? action.persisted.discoveryUI.publisher
              : '',
          itemType:
            typeof action.persisted.discoveryUI.itemType === 'string'
              ? action.persisted.discoveryUI.itemType
              : '',
          text:
            typeof action.persisted.discoveryUI.text === 'string'
              ? action.persisted.discoveryUI.text
              : '',
        },
        liveQuestion: action.persisted.liveQuestion,
        liveSelected: action.persisted.liveSelected,
        selectionMeta: action.persisted.selectionMeta,
        recipe: action.persisted.recipe,
        catalog: {
          ...state.catalog,
          pageNum: action.persisted.catalogUI.pageNum,
          pageSize: action.persisted.catalogUI.pageSize,
          expanded: action.persisted.catalogUI.expanded,
        },
        scroll: action.persisted.scroll,
        assistant: {
          open: action.persisted.assistant.open,
          width: Math.min(
            ASSISTANT_MAX_WIDTH,
            Math.max(
              ASSISTANT_MIN_WIDTH,
              Math.round(action.persisted.assistant.width),
            ),
          ),
          messages: action.persisted.assistant.messages,
          chatStatus: 'idle',
          chatError: null,
          chatRequestId: 0,
          suggestedQuestion: null,
          lastChangeSummary: null,
          clearedChat: null,
        },
        lastCleared: null,
        lastClearedMeta: null,
        chatApplied: null,
        storageNotice: null,
      }

    case 'set-storage-notice':
      return state.storageNotice === action.notice
        ? state
        : { ...state, storageNotice: action.notice }
  }
}
