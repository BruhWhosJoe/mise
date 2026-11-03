import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import {
  errorMessage,
  fetchCatalogPreview,
  fetchCatalogStatus,
  fetchChatMessage,
  fetchDiscoverySearch,
  fetchRecipeGenerate,
} from '../services/api'
import type { ChatContextRecommendation, LiveRecord } from '../services/api'
import type { View } from '../types'
import type { DiscoverySort } from '../utils/discoveryFilter'
import { scoredValue, visibleRecommendations } from '../utils/discoveryFilter'
import { loadWorkspace, saveWorkspace } from './persistence'
import { WorkspaceContext } from './useWorkspace'
import {
  STACKING_BREAKPOINT,
  createInitialState,
  createInvestigationId,
  maxAssistantWidth,
  recipeInputsValid,
  selectedIds,
  workspaceReducer,
} from './workspaceReducer'
import type { ChatMessage, WorkspaceApi, WorkspaceState } from './workspaceTypes'

// Narrow screens start with the assistant collapsed; keep in sync with the
// stacking breakpoint in App.css.
const DESKTOP_QUERY = `(min-width: ${STACKING_BREAKPOINT}px)`

const STORAGE_TRIMMED_NOTICE =
  'Your investigation is large, so technical metadata details were trimmed ' +
  'from the saved copy. Results and selections are preserved.'
const STORAGE_TOO_LARGE_NOTICE =
  'Your investigation is too large to save in this browser. ' +
  'It will be kept for this session only.'
const STORAGE_FAILED_NOTICE =
  'Workspace saving failed, so this investigation will be kept for this ' +
  'session only.'
const STORAGE_UNAVAILABLE_NOTICE =
  'Workspace persistence is unavailable in this browser session, so this ' +
  'investigation will not survive a reload.'

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function readLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readScrollY(): number {
  try {
    return window.scrollY
  } catch {
    return 0
  }
}

function readViewportWidth(): number | null {
  try {
    return window.innerWidth
  } catch {
    return null
  }
}

/** Snapshot the chat service reasons over: visible rank order + membership. */
function buildChatBody(
  snapshot: WorkspaceState,
  message: string,
  investigationId: string,
  requestId: number,
) {
  // The chat service reasons over this snapshot only (the exact visible
  // ranked order plus collection membership); it never refetches the
  // catalog per message.
  const result = snapshot.aiSearch.result
  const visible = result
    ? visibleRecommendations(result.recommendations, snapshot.discoveryUI)
    : []
  const recommendations: ChatContextRecommendation[] = []
  for (const item of visible) {
    const id = item.record.assigned_id
    if (id === null || id.trim() === '') continue
    // Unscored rows are left out of the chat context: a missing score is a
    // model-output gap, and sending 0 would fabricate a ranking signal.
    const score = scoredValue(item)
    if (score === null) continue
    if (recommendations.length >= 20) break
    recommendations.push({
      assigned_id: id,
      title: item.record.title,
      relevance: item.relevance,
      relevance_score: Math.round(score),
      why: item.why,
      limitations: item.limitations,
      organization_name: item.record.organization_name,
      portal_name: item.record.portal_name,
      modified_date: item.record.modified_date,
      update_date: item.record.update_date,
      temporal_range: item.record.temporal_range,
    })
  }
  return {
    message,
    investigation_id: investigationId,
    request_id: requestId,
    question: snapshot.liveQuestion,
    recommendations,
    selected_ids: selectedIds(snapshot),
    filters: {
      min_score: snapshot.discoveryUI.minScore,
      sort: snapshot.discoveryUI.sort,
      show_all: snapshot.discoveryUI.showAll,
    },
    history: snapshot.assistant.messages.slice(-10).map((entry) => ({
      role: entry.role,
      text: entry.text.slice(0, 1000),
    })),
  }
}

function initState(): WorkspaceState {
  const initial = createInitialState()
  try {
    if (typeof window === 'undefined') return initial
    const loaded = loadWorkspace(window.localStorage)
    if (!loaded.ok) {
      // Fresh start: match the assistant default to the screen size.
      return {
        ...initial,
        assistant: {
          ...initial.assistant,
          open: window.matchMedia(DESKTOP_QUERY).matches,
        },
      }
    }
    return workspaceReducer(initial, {
      type: 'hydrate',
      persisted: loaded.value,
    })
  } catch {
    return initial
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(initState)
  const [state, dispatch] = useReducer(workspaceReducer, initial)
  const stateRef = useRef(state)
  const aiAbortRef = useRef<AbortController | null>(null)
  const recipeAbortRef = useRef<AbortController | null>(null)
  const catalogAbortRef = useRef<AbortController | null>(null)
  const chatAbortRef = useRef<AbortController | null>(null)
  const catalogFlightRef = useRef<string | null>(null)

  // Published to callbacks after each render; callbacks only run from events
  // and async continuations, so they always see committed state.
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Persist every investigation change. Only the notice outcome can dispatch,
  // and only when it differs, so this effect cannot loop.
  useEffect(() => {
    const storage = readLocalStorage()
    if (storage === null) {
      if (state.storageNotice !== STORAGE_UNAVAILABLE_NOTICE) {
        dispatch({
          type: 'set-storage-notice',
          notice: STORAGE_UNAVAILABLE_NOTICE,
        })
      }
      return
    }
    const result = saveWorkspace(storage, state)
    const notice =
      result === 'trimmed'
        ? STORAGE_TRIMMED_NOTICE
        : result === 'too-large'
          ? STORAGE_TOO_LARGE_NOTICE
          : result === 'unavailable'
            ? STORAGE_FAILED_NOTICE
            : null
    if (notice !== state.storageNotice) {
      dispatch({ type: 'set-storage-notice', notice })
    }
  }, [state])

  const setView = useCallback((view: View) => {
    const current = stateRef.current
    if (current.view === view) return
    dispatch({ type: 'save-scroll', view: current.view, y: readScrollY() })
    dispatch({ type: 'set-view', view })
  }, [])

  const setDraft = useCallback((draft: string) => {
    dispatch({ type: 'set-draft', draft })
  }, [])

  const runAISearch = useCallback((question: string) => {
    const trimmed = question.trim()
    if (trimmed === '') return
    const snapshot = stateRef.current
    aiAbortRef.current?.abort()
    const controller = new AbortController()
    aiAbortRef.current = controller
    const requestId = snapshot.aiSearch.requestId + 1
    const startedAt = Date.now()
    const investigationId = snapshot.investigationId
    dispatch({ type: 'search-start', question: trimmed, requestId, startedAt })
    void (async () => {
      try {
        const result = await fetchDiscoverySearch(trimmed, {
          signal: controller.signal,
        })
        dispatch({
          type: 'search-success',
          investigationId,
          requestId,
          result,
          endedAt: Date.now(),
        })
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return
        dispatch({
          type: 'search-error',
          investigationId,
          requestId,
          error: errorMessage(error),
          endedAt: Date.now(),
          interrupted: false,
        })
      } finally {
        if (aiAbortRef.current === controller) aiAbortRef.current = null
      }
    })()
  }, [])

  const cancelAISearch = useCallback(() => {
    // Aborting drops the HTTP wait and any late response is fenced off by
    // the rotated request identity. It is never retried here. Note this
    // only stops waiting: a model call already issued server-side may still
    // complete and count toward usage.
    const snapshot = stateRef.current
    if (snapshot.aiSearch.status !== 'loading') return
    aiAbortRef.current?.abort()
    aiAbortRef.current = null
    dispatch({
      type: 'search-cancel',
      investigationId: snapshot.investigationId,
      requestId: snapshot.aiSearch.requestId + 1,
      endedAt: Date.now(),
    })
  }, [])

  const setMinScore = useCallback((minScore: number) => {
    dispatch({ type: 'set-min-score', minScore })
  }, [])

  const setDiscoverySort = useCallback((sort: DiscoverySort) => {
    dispatch({ type: 'set-discovery-sort', sort })
  }, [])

  const setDiscoveryShowAll = useCallback((showAll: boolean) => {
    dispatch({ type: 'set-discovery-show-all', showAll })
  }, [])

  const setDiscoveryTag = useCallback((tag: string) => {
    dispatch({ type: 'set-discovery-tag', tag })
  }, [])

  const setDiscoveryPublisher = useCallback((publisher: string) => {
    dispatch({ type: 'set-discovery-publisher', publisher })
  }, [])

  const setDiscoveryItemType = useCallback((itemType: string) => {
    dispatch({ type: 'set-discovery-item-type', itemType })
  }, [])

  const setDiscoveryText = useCallback((text: string) => {
    dispatch({ type: 'set-discovery-text', text })
  }, [])

  const clearDiscoveryFilters = useCallback(() => {
    dispatch({ type: 'clear-discovery-filters' })
  }, [])

  const toggleLive = useCallback(
    (record: LiveRecord, source: 'ai' | 'catalog') => {
      dispatch({ type: 'toggle-live', record, source, at: Date.now() })
    },
    [],
  )

  const selectPage = useCallback(
    (records: LiveRecord[], source: 'ai' | 'catalog') => {
      dispatch({ type: 'select-page', records, source, at: Date.now() })
    },
    [],
  )

  const clearSelection = useCallback(() => {
    dispatch({ type: 'clear-selection' })
  }, [])

  const undoClearSelection = useCallback(() => {
    dispatch({ type: 'undo-clear-selection' })
  }, [])

  const generateRecipe = useCallback(() => {
    const snapshot = stateRef.current
    if (!recipeInputsValid(snapshot)) return
    const question = snapshot.liveQuestion as string
    const ids = selectedIds(snapshot)
    recipeAbortRef.current?.abort()
    const controller = new AbortController()
    recipeAbortRef.current = controller
    const requestId = snapshot.recipe.requestId + 1
    const startedAt = Date.now()
    const investigationId = snapshot.investigationId
    dispatch({ type: 'recipe-start', requestId, startedAt })
    void (async () => {
      try {
        const data = await fetchRecipeGenerate(question, ids, {
          signal: controller.signal,
        })
        dispatch({
          type: 'recipe-success',
          investigationId,
          requestId,
          data,
          question,
          ids,
          endedAt: Date.now(),
        })
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return
        dispatch({
          type: 'recipe-error',
          investigationId,
          requestId,
          error: errorMessage(error),
          endedAt: Date.now(),
          interrupted: false,
        })
      } finally {
        if (recipeAbortRef.current === controller) {
          recipeAbortRef.current = null
        }
      }
    })()
  }, [])

  const loadCatalogPage = useCallback(
    (
      target: number,
      size?: number,
      knownOffsets?: Record<number, number>,
      refreshStatus: boolean = false,
    ) => {
      const snapshot = stateRef.current.catalog
      const effectiveSize = size ?? snapshot.pageSize
      if (target < 1 || effectiveSize < 1) return
      const known = knownOffsets ?? snapshot.offsets
      const targetOffset = known[target] ?? (target - 1) * effectiveSize
      const flightKey = `${target}:${effectiveSize}:${targetOffset}`
      if (catalogFlightRef.current === flightKey && snapshot.loading) return
      catalogAbortRef.current?.abort()
      const controller = new AbortController()
      catalogAbortRef.current = controller
      catalogFlightRef.current = flightKey
      const requestId = snapshot.requestId + 1
      const carriedStatus = snapshot.status
      const shouldRefresh = refreshStatus || carriedStatus === null
      dispatch({ type: 'catalog-start', requestId })
      void (async () => {
        try {
          const [loadedStatus, loadedPage] = await Promise.all([
            shouldRefresh
              ? fetchCatalogStatus({ signal: controller.signal })
              : Promise.resolve(carriedStatus),
            fetchCatalogPreview(targetOffset, effectiveSize, {
              signal: controller.signal,
            }),
          ])
          dispatch({
            type: 'catalog-success',
            requestId,
            status: loadedStatus,
            page: loadedPage,
            targetPage: target,
            targetOffset,
            size: effectiveSize,
          })
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) return
          dispatch({
            type: 'catalog-error',
            requestId,
            error: errorMessage(error),
            interrupted: false,
          })
        } finally {
          if (catalogFlightRef.current === flightKey) {
            catalogFlightRef.current = null
          }
          if (catalogAbortRef.current === controller) {
            catalogAbortRef.current = null
          }
        }
      })()
    },
    [],
  )

  const setCatalogSize = useCallback(
    (size: number) => {
      if (size === stateRef.current.catalog.pageSize) return
      dispatch({ type: 'catalog-set-size', size })
      loadCatalogPage(1, size, { 1: 0 }, false)
    },
    [loadCatalogPage],
  )

  const toggleExpanded = useCallback((key: string) => {
    dispatch({ type: 'catalog-toggle-expanded', key })
  }, [])

  const setAssistantOpen = useCallback((open: boolean) => {
    dispatch({ type: 'set-assistant-open', open })
  }, [])

  const setAssistantWidth = useCallback((width: number) => {
    // The persisted width never exceeds what the viewport can show, so an
    // expansion on a wide monitor cannot cover the app after a resize.
    const viewport = readViewportWidth()
    const clamped =
      viewport === null ? width : Math.min(width, maxAssistantWidth(viewport))
    dispatch({ type: 'set-assistant-width', width: clamped })
  }, [])

  const pushMessage = useCallback(
    (role: ChatMessage['role'], text: string) => {
      const trimmed = text.trim()
      if (trimmed === '') return
      dispatch({
        type: 'push-message',
        message: {
          id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          role,
          text: trimmed,
          at: Date.now(),
        },
      })
    },
    [],
  )

  const executeChat = useCallback(
    (
      controller: AbortController,
      body: ReturnType<typeof buildChatBody>,
      investigationId: string,
      requestId: number,
    ) => {
      void (async () => {
        try {
          const data = await fetchChatMessage(body, {
            signal: controller.signal,
          })
          dispatch({
            type: 'chat-success',
            investigationId,
            requestId,
            reply: {
              id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
              role: 'assistant',
              text: data.reply,
              at: Date.now(),
            },
            actions: data.actions,
            suggestedQuestion: data.suggested_question,
            changeSummary: data.change_summary,
            at: Date.now(),
          })
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) return
          dispatch({
            type: 'chat-error',
            investigationId,
            requestId,
            error: errorMessage(error),
          })
        } finally {
          if (chatAbortRef.current === controller) chatAbortRef.current = null
        }
      })()
    },
    [],
  )

  const sendChat = useCallback(
    (message: string) => {
      const trimmed = message.trim()
      if (trimmed === '') return
      const snapshot = stateRef.current
      if (snapshot.assistant.chatStatus === 'loading') return
      chatAbortRef.current?.abort()
      const controller = new AbortController()
      chatAbortRef.current = controller
      const requestId = snapshot.assistant.chatRequestId + 1
      const investigationId = snapshot.investigationId
      const at = Date.now()
      dispatch({
        type: 'chat-start',
        requestId,
        message: {
          id: `msg-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'user',
          text: trimmed,
          at,
        },
      })
      executeChat(
        controller,
        buildChatBody(snapshot, trimmed, investigationId, requestId),
        investigationId,
        requestId,
      )
    },
    [executeChat],
  )

  const retryChat = useCallback(() => {
    const snapshot = stateRef.current
    // Only error states retry: idle has nothing to resend and loading
    // already has a request in flight (duplicate sends stay blocked).
    if (snapshot.assistant.chatStatus !== 'error') return
    const lastUser = [...snapshot.assistant.messages]
      .reverse()
      .find((entry) => entry.role === 'user')
    if (lastUser === undefined) return
    chatAbortRef.current?.abort()
    const controller = new AbortController()
    chatAbortRef.current = controller
    const requestId = snapshot.assistant.chatRequestId + 1
    const investigationId = snapshot.investigationId
    dispatch({ type: 'chat-retry', requestId })
    executeChat(
      controller,
      buildChatBody(snapshot, lastUser.text, investigationId, requestId),
      investigationId,
      requestId,
    )
  }, [executeChat])

  const undoChatApplied = useCallback(() => {
    dispatch({ type: 'chat-undo-applied' })
  }, [])

  const dismissChatSuggestion = useCallback(() => {
    dispatch({ type: 'chat-dismiss-suggestion' })
  }, [])

  const clearChatError = useCallback(() => {
    dispatch({ type: 'chat-clear-error' })
  }, [])

  const newInvestigation = useCallback(() => {
    // Old responses must never repopulate the fresh investigation: abort the
    // question-scoped requests and rotate the id the guards are keyed on.
    aiAbortRef.current?.abort()
    recipeAbortRef.current?.abort()
    chatAbortRef.current?.abort()
    aiAbortRef.current = null
    recipeAbortRef.current = null
    chatAbortRef.current = null
    dispatch({ type: 'new-investigation', investigationId: createInvestigationId() })
    window.setTimeout(() => window.scrollTo(0, 0), 0)
  }, [])

  const dismissStorageNotice = useCallback(() => {
    dispatch({ type: 'set-storage-notice', notice: null })
  }, [])

  const api = useMemo<WorkspaceApi>(
    () => ({
      state,
      dispatch,
      setView,
      setDraft,
      runAISearch,
      cancelAISearch,
      setMinScore,
      setDiscoverySort,
      setDiscoveryShowAll,
      setDiscoveryTag,
      setDiscoveryPublisher,
      setDiscoveryItemType,
      setDiscoveryText,
      clearDiscoveryFilters,
      toggleLive,
      selectPage,
      clearSelection,
      undoClearSelection,
      generateRecipe,
      loadCatalogPage,
      setCatalogSize,
      toggleExpanded,
      setAssistantOpen,
      setAssistantWidth,
      pushMessage,
      sendChat,
      retryChat,
      undoChatApplied,
      dismissChatSuggestion,
      clearChatError,
      newInvestigation,
      dismissStorageNotice,
    }),
    [
      state,
      setView,
      setDraft,
      runAISearch,
      cancelAISearch,
      setMinScore,
      setDiscoverySort,
      setDiscoveryShowAll,
      setDiscoveryTag,
      setDiscoveryPublisher,
      setDiscoveryItemType,
      setDiscoveryText,
      clearDiscoveryFilters,
      toggleLive,
      selectPage,
      clearSelection,
      undoClearSelection,
      generateRecipe,
      loadCatalogPage,
      setCatalogSize,
      toggleExpanded,
      setAssistantOpen,
      setAssistantWidth,
      pushMessage,
      sendChat,
      retryChat,
      undoChatApplied,
      dismissChatSuggestion,
      clearChatError,
      newInvestigation,
      dismissStorageNotice,
    ],
  )

  return (
    <WorkspaceContext.Provider value={api}>
      {children}
    </WorkspaceContext.Provider>
  )
}
