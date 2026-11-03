import type { Dispatch } from 'react'
import type {
  CatalogPreview,
  CatalogStatus,
  ChatAction,
  DiscoveryResponse,
  LiveRecord,
  RecipeResponse,
} from '../services/api'
import type { AISearchState, RecipeState, View } from '../types'
import type { DiscoverySort } from '../utils/discoveryFilter'
import type { PersistedWorkspace } from './persistence'

/** Where a selected record came from, plus when it was added. */
export interface SelectionMeta {
  addedAt: number
  source: 'ai' | 'catalog'
}

/** One assistant conversation message (rendered when present). */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: number
}

/**
 * Catalog browse state. Page data lives here (above the view lifecycle) so
 * navigating away and back never refetches or loses the user's place.
 */
export interface CatalogUIState {
  pageNum: number
  pageSize: number
  offsets: Record<number, number>
  capped: boolean
  page: CatalogPreview | null
  status: CatalogStatus | null
  loading: boolean
  error: string | null
  requestId: number
  interrupted: boolean
  /** Keys of record cards with expanded details (record IDs when known). */
  expanded: string[]
}

export interface AssistantUIState {
  open: boolean
  width: number
  messages: ChatMessage[]
  /** Transient chat turn state (never persisted). */
  chatStatus: 'idle' | 'loading' | 'error'
  chatError: string | null
  chatRequestId: number
  suggestedQuestion: string | null
  lastChangeSummary: string | null
}

/** Snapshot for "Undo" after a chat-applied selection/filter change. */
export interface ChatAppliedChange {
  id: string
  summary: string
  previousSelection: LiveRecord[]
  previousMeta: Record<string, SelectionMeta>
  previousDiscoveryUI: DiscoveryUIState
  at: number
}

/**
 * Discovery results presentation prefs. These only choose which of the
 * returned recommendations are shown (never what was returned or selected),
 * so filtering can never lose results or clear the collection.
 */
export interface DiscoveryUIState {
  minScore: number
  sort: DiscoverySort
  showAll: boolean
  tag: string
  publisher: string
  itemType: string
  text: string
}

/**
 * The whole investigation, held above page lifecycles. Navigation only
 * changes `view`; everything else survives until the user clears it or
 * starts a new investigation.
 */
export interface WorkspaceState {
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
  catalog: CatalogUIState
  scroll: Record<View, number>
  assistant: AssistantUIState
  /** Snapshot for "Undo" after Clear selection; null when nothing to undo. */
  lastCleared: LiveRecord[] | null
  lastClearedMeta: Record<string, SelectionMeta> | null
  /** Snapshot for "Undo" after a chat-applied change; transient. */
  chatApplied: ChatAppliedChange | null
  storageNotice: string | null
}

export type WorkspaceAction =
  | { type: 'set-view'; view: View }
  | { type: 'set-draft'; draft: string }
  | { type: 'search-start'; question: string; requestId: number; startedAt: number }
  | {
      type: 'search-success'
      investigationId: string
      requestId: number
      result: DiscoveryResponse
      endedAt: number
    }
  | {
      type: 'search-error'
      investigationId: string
      requestId: number
      error: string
      endedAt: number
      interrupted: boolean
    }
  | { type: 'set-min-score'; minScore: number }
  | { type: 'set-discovery-sort'; sort: DiscoverySort }
  | { type: 'set-discovery-show-all'; showAll: boolean }
  | { type: 'set-discovery-tag'; tag: string }
  | { type: 'set-discovery-publisher'; publisher: string }
  | { type: 'set-discovery-item-type'; itemType: string }
  | { type: 'set-discovery-text'; text: string }
  | { type: 'clear-discovery-filters' }
  | {
      type: 'search-cancel'
      investigationId: string
      requestId: number
      endedAt: number
    }
  | { type: 'toggle-live'; record: LiveRecord; source: 'ai' | 'catalog'; at: number }
  | { type: 'select-page'; records: LiveRecord[]; source: 'ai' | 'catalog'; at: number }
  | { type: 'clear-selection' }
  | { type: 'undo-clear-selection' }
  | { type: 'recipe-start'; requestId: number; startedAt: number }
  | {
      type: 'recipe-success'
      investigationId: string
      requestId: number
      data: RecipeResponse
      question: string
      ids: string[]
      endedAt: number
    }
  | {
      type: 'recipe-error'
      investigationId: string
      requestId: number
      error: string
      endedAt: number
      interrupted: boolean
    }
  | { type: 'catalog-start'; requestId: number }
  | {
      type: 'catalog-success'
      requestId: number
      status: CatalogStatus | null
      page: CatalogPreview
      targetPage: number
      targetOffset: number
      size: number
    }
  | { type: 'catalog-error'; requestId: number; error: string; interrupted: boolean }
  | { type: 'catalog-set-size'; size: number }
  | { type: 'catalog-toggle-expanded'; key: string }
  | { type: 'save-scroll'; view: View; y: number }
  | { type: 'set-assistant-open'; open: boolean }
  | { type: 'set-assistant-width'; width: number }
  | { type: 'push-message'; message: ChatMessage }
  | { type: 'chat-start'; requestId: number; message: ChatMessage }
  | {
      type: 'chat-success'
      investigationId: string
      requestId: number
      reply: ChatMessage
      actions: ChatAction[]
      suggestedQuestion: string | null
      changeSummary: string | null
      at: number
    }
  | {
      type: 'chat-error'
      investigationId: string
      requestId: number
      error: string
    }
  | { type: 'chat-clear-error' }
  | { type: 'chat-retry'; requestId: number }
  | { type: 'chat-undo-applied' }
  | { type: 'chat-dismiss-suggestion' }
  | { type: 'new-investigation'; investigationId: string }
  | { type: 'hydrate'; persisted: PersistedWorkspace }
  | { type: 'set-storage-notice'; notice: string | null }

/** Actions the provider exposes to views (state lives above them all). */
export interface WorkspaceApi {
  state: WorkspaceState
  dispatch: Dispatch<WorkspaceAction>
  setView: (view: View) => void
  setDraft: (draft: string) => void
  runAISearch: (question: string) => void
  cancelAISearch: () => void
  setMinScore: (minScore: number) => void
  setDiscoverySort: (sort: DiscoverySort) => void
  setDiscoveryShowAll: (showAll: boolean) => void
  setDiscoveryTag: (tag: string) => void
  setDiscoveryPublisher: (publisher: string) => void
  setDiscoveryItemType: (itemType: string) => void
  setDiscoveryText: (text: string) => void
  clearDiscoveryFilters: () => void
  toggleLive: (record: LiveRecord, source: 'ai' | 'catalog') => void
  selectPage: (records: LiveRecord[], source: 'ai' | 'catalog') => void
  clearSelection: () => void
  undoClearSelection: () => void
  generateRecipe: () => void
  loadCatalogPage: (
    target: number,
    size?: number,
    knownOffsets?: Record<number, number>,
    refreshStatus?: boolean,
  ) => void
  setCatalogSize: (size: number) => void
  toggleExpanded: (key: string) => void
  setAssistantOpen: (open: boolean) => void
  setAssistantWidth: (width: number) => void
  pushMessage: (role: ChatMessage['role'], text: string) => void
  sendChat: (message: string) => void
  retryChat: () => void
  undoChatApplied: () => void
  dismissChatSuggestion: () => void
  clearChatError: () => void
  newInvestigation: () => void
  dismissStorageNotice: () => void
}
