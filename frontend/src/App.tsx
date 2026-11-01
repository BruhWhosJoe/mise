import { useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import type { SampleDataset, ScenarioFixture, View } from './types'
import {
  SCENARIOS,
  matchScenario,
  normalizeQuestion,
} from './data/fixtures'
import AssistantPanel from './components/AssistantPanel'
import DiscoverView from './components/DiscoverView'
import RecipeView from './components/RecipeView'

const EXAMPLES = SCENARIOS.map((scenario) => scenario.exampleQuestion)

function App() {
  const [view, setView] = useState<View>('discover')
  const [question, setQuestion] = useState('')
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(
    null,
  )
  const [activeScenario, setActiveScenario] =
    useState<ScenarioFixture | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [assistantOpen, setAssistantOpen] = useState(true)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (question.trim() === '') {
      setError('Enter a question before discovering datasets.')
      return
    }
    setError(null)
    if (
      submittedQuestion !== null &&
      normalizeQuestion(submittedQuestion) !== normalizeQuestion(question)
    ) {
      setSelectedIds([])
    }
    setSubmittedQuestion(question.trim())
    setActiveScenario(matchScenario(question))
    setHasSearched(true)
  }

  function handleSelectExample(example: string) {
    setQuestion(example)
    setError(null)
  }

  function handleToggleDataset(id: string) {
    setSelectedIds((previous) =>
      previous.includes(id)
        ? previous.filter((selected) => selected !== id)
        : [...previous, id],
    )
  }

  const selectedDatasets: SampleDataset[] =
    activeScenario?.groups
      .flatMap((group) => group.datasets)
      .filter((dataset) => selectedIds.includes(dataset.id)) ?? []

  return (
    <div className={assistantOpen ? 'shell' : 'shell shell-collapsed'}>
      <nav className="side-nav" aria-label="Primary">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            MF
          </span>
          <span className="brand-name">MetaFabric</span>
        </div>
        <p className="brand-tag">Government open data discovery</p>
        <ul>
          <li>
            <button
              type="button"
              className={view === 'discover' ? 'nav-active' : undefined}
              aria-current={view === 'discover' ? 'page' : undefined}
              onClick={() => setView('discover')}
            >
              Discover
            </button>
          </li>
          <li>
            <button
              type="button"
              className={view === 'recipe' ? 'nav-active' : undefined}
              aria-current={view === 'recipe' ? 'page' : undefined}
              onClick={() => setView('recipe')}
            >
              Data Recipe
              {selectedIds.length > 0 && (
                <span className="count-badge" aria-label={`${selectedIds.length} selected`}>
                  {selectedIds.length}
                </span>
              )}
            </button>
          </li>
        </ul>
      </nav>

      <main className="workspace">
        <div className="workspace-top">
          <p className="demo-badge">Demo mode — sample datasets</p>
          {!assistantOpen && (
            <button
              type="button"
              className="secondary small"
              onClick={() => setAssistantOpen(true)}
            >
              Show assistant
            </button>
          )}
        </div>

        {view === 'discover' ? (
          <DiscoverView
            question={question}
            onQuestionChange={setQuestion}
            onSubmit={handleSubmit}
            onSelectExample={handleSelectExample}
            error={error}
            examples={EXAMPLES}
            hasSearched={hasSearched}
            submittedQuestion={submittedQuestion}
            activeScenario={activeScenario}
            selectedIds={selectedIds}
            onToggleDataset={handleToggleDataset}
            onViewSelection={() => setView('recipe')}
          />
        ) : (
          <RecipeView
            submittedQuestion={submittedQuestion}
            selectedDatasets={selectedDatasets}
            onRemoveDataset={handleToggleDataset}
            onBackToDiscover={() => setView('discover')}
          />
        )}
      </main>

      {assistantOpen && (
        <aside className="assistant" aria-label="Assistant">
          <AssistantPanel onCollapse={() => setAssistantOpen(false)} />
        </aside>
      )}
    </div>
  )
}

export default App
