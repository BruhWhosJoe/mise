import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import './App.css'
import type { View } from './types'
import AIDiscovery from './components/AIDiscovery'
import AssistantPanel from './components/AssistantPanel'
import AssistantResizeHandle from './components/AssistantResizeHandle'
import BrandMark from './components/BrandMark'
import InvestigationSummary from './components/InvestigationSummary'
import LiveCatalog from './components/LiveCatalog'
import NavIcon from './components/NavIcon'
import RecipeView from './components/RecipeView'
import ThemeControl from './components/ThemeControl'
import { useTheme } from './hooks/useTheme'
import { useViewportWidth } from './hooks/useViewportWidth'
import { WorkspaceProvider } from './state/WorkspaceContext'
import { useWorkspace } from './state/useWorkspace'
import {
  effectiveAssistantWidth,
  maxAssistantWidth,
} from './state/workspaceReducer'

const NAV_ITEMS: { id: View; label: string }[] = [
  { id: 'discover', label: 'AI Discovery' },
  { id: 'catalog', label: 'Browse Catalog' },
  { id: 'recipe', label: 'Data Recipe' },
]

function Shell() {
  const {
    state,
    setView,
    clearSelection,
    undoClearSelection,
    newInvestigation,
    dismissStorageNotice,
    setAssistantOpen,
    setAssistantWidth,
  } = useWorkspace()
  const [confirmNew, setConfirmNew] = useState(false)
  const { theme, setTheme } = useTheme()
  const assistantOpen = state.assistant.open

  // Each view keeps its own scroll position in the store; restore it after
  // the view renders.
  const view = state.view
  const savedScroll = state.scroll[view] ?? 0
  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      window.scrollTo(0, savedScroll),
    )
    return () => window.cancelAnimationFrame(frame)
  }, [view, savedScroll])

  const selectionCount = state.liveSelected.length
  const viewportWidth = useViewportWidth()
  // The rendered width never exceeds what the viewport can show: the nav and
  // a readable workspace always keep their space, so the panel can never
  // cover the app. The stored width is clamped the same way on dispatch.
  const renderedWidth = effectiveAssistantWidth(
    state.assistant.width,
    viewportWidth,
  )
  const shellStyle = {
    '--assistant-width': `${renderedWidth}px`,
  } as CSSProperties

  function handleNavigate(next: View) {
    setConfirmNew(false)
    setView(next)
  }

  return (
    <div
      className={assistantOpen ? 'shell' : 'shell shell-collapsed'}
      style={shellStyle}
    >
      <nav className="side-nav" aria-label="Primary">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">Mise</span>
        </div>
        <p className="brand-tag">Get your data ready before you analyze.</p>
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={view === item.id ? 'nav-active' : undefined}
                aria-current={view === item.id ? 'page' : undefined}
                title={item.label}
                onClick={() => handleNavigate(item.id)}
              >
                <span className="nav-label">
                  <NavIcon view={item.id} />
                  {item.label}
                </span>
                {item.id === 'recipe' && selectionCount > 0 && (
                  <span
                    className="count-badge"
                    aria-label={`${selectionCount} selected`}
                  >
                    {selectionCount}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="nav-footer">
          <button
            type="button"
            className="nav-utility"
            disabled={selectionCount === 0}
            onClick={clearSelection}
          >
            Clear selection
          </button>
          {confirmNew ? (
            <div
              className="nav-confirm"
              role="group"
              aria-label="Confirm new investigation"
            >
              <p>
                Start a new investigation? This clears the question, results,
                selection, and recipe.
              </p>
              <div className="nav-confirm-actions">
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => {
                    setConfirmNew(false)
                    newInvestigation()
                  }}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => setConfirmNew(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="nav-utility"
              onClick={() => setConfirmNew(true)}
            >
              New investigation
            </button>
          )}
        </div>
      </nav>

      <main className="workspace">
        <div className="workspace-top">
          <div className="workspace-controls">
            <ThemeControl theme={theme} onChange={setTheme} />
            {!assistantOpen && (
              <button
                type="button"
                className="secondary small"
                aria-expanded={assistantOpen}
                aria-controls="assistant-panel"
                onClick={() => setAssistantOpen(true)}
              >
                Show assistant
              </button>
            )}
          </div>
        </div>

        {state.lastCleared !== null && (
          <div className="notice notice-inline" role="status">
            <p>
              Selection cleared. The question, results, and conversation are
              preserved; the recipe is marked out of date.
            </p>
            <button
              type="button"
              className="secondary small"
              onClick={undoClearSelection}
            >
              Undo
            </button>
          </div>
        )}

        {state.storageNotice !== null && (
          <div className="notice notice-inline" role="status">
            <p>{state.storageNotice}</p>
            <button
              type="button"
              className="secondary small"
              onClick={dismissStorageNotice}
            >
              Dismiss
            </button>
          </div>
        )}

        {!assistantOpen && <InvestigationSummary />}

        {view === 'discover' && <AIDiscovery />}
        {view === 'catalog' && <LiveCatalog />}
        {view === 'recipe' && <RecipeView />}
      </main>

      {assistantOpen && (
        <aside id="assistant-panel" className="assistant" aria-label="Assistant">
          <AssistantResizeHandle
            width={renderedWidth}
            maxWidth={maxAssistantWidth(viewportWidth)}
            onChange={setAssistantWidth}
          />
          <AssistantPanel />
        </aside>
      )}
    </div>
  )
}

function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  )
}

export default App
