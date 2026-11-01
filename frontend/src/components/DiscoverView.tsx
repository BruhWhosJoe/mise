import { useRef } from 'react'
import type { FormEvent } from 'react'
import type { SampleDataset, ScenarioFixture } from '../types'
import DatasetCard from './DatasetCard'

interface DiscoverViewProps {
  question: string
  onQuestionChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSelectExample: (example: string) => void
  error: string | null
  examples: string[]
  hasSearched: boolean
  submittedQuestion: string | null
  activeScenario: ScenarioFixture | null
  selectedIds: string[]
  onToggleDataset: (id: string) => void
  onViewSelection: () => void
}

function DiscoverView({
  question,
  onQuestionChange,
  onSubmit,
  onSelectExample,
  error,
  examples,
  hasSearched,
  submittedQuestion,
  activeScenario,
  selectedIds,
  onToggleDataset,
  onViewSelection,
}: DiscoverViewProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleExampleClick(example: string) {
    onSelectExample(example)
    textareaRef.current?.focus()
  }

  const resultDatasets: SampleDataset[] =
    activeScenario?.groups.flatMap((group) => group.datasets) ?? []
  const selectedCount = resultDatasets.filter((dataset) =>
    selectedIds.includes(dataset.id),
  ).length

  return (
    <div>
      <h1>What would you like to investigate?</h1>
      <p className="lede">
        Ask a question about your community. This demo matches it against
        sample datasets — no live search runs yet.
      </p>

      <form className="question-form" onSubmit={onSubmit} noValidate>
        <label htmlFor="question">Your question</label>
        <textarea
          id="question"
          ref={textareaRef}
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder="Which datasets could help me study pedestrian safety near schools?"
          rows={4}
          aria-invalid={error !== null}
          aria-describedby={error ? 'question-error' : undefined}
        />
        {error && (
          <p id="question-error" className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit">Discover datasets</button>
      </form>

      <section aria-labelledby="examples-heading">
        <h2 id="examples-heading">Try an example</h2>
        <ul className="example-list">
          {examples.map((example) => (
            <li key={example}>
              <button
                type="button"
                className="example-card"
                onClick={() => handleExampleClick(example)}
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {hasSearched && submittedQuestion && (
        <section aria-labelledby="results-heading" aria-live="polite">
          <h2 id="results-heading">Sample datasets</h2>
          <p className="submitted-question">
            Results for: <q>{submittedQuestion}</q>
          </p>

          {activeScenario ? (
            <>
              <div className="selection-bar">
                <p>
                  {selectedCount} of {resultDatasets.length} datasets selected
                </p>
                <button
                  type="button"
                  className="secondary"
                  disabled={selectedCount === 0}
                  onClick={onViewSelection}
                >
                  View selection
                </button>
              </div>

              {activeScenario.groups.map((group) => (
                <section
                  key={group.purpose}
                  aria-label={`${group.purpose} datasets`}
                  className="result-group"
                >
                  <h3>{group.purpose}</h3>
                  <ul className="dataset-list">
                    {group.datasets.map((dataset) => (
                      <DatasetCard
                        key={dataset.id}
                        dataset={dataset}
                        selected={selectedIds.includes(dataset.id)}
                        onToggle={onToggleDataset}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          ) : (
            <div className="notice">
              <p>
                This demo currently supports the three example questions
                above. Your question did not match one of them, so no sample
                datasets are shown. Try selecting an example to see how
                discovery works.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

export default DiscoverView
