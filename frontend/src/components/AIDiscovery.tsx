import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { SCENARIOS, normalizeQuestion } from '../data/fixtures'
import { useWorkspace } from '../state/useWorkspace'
import { expandedKeyForRecord } from '../state/workspaceReducer'
import {
  DEFAULT_MIN_RELEVANCE,
  DISCOVERY_SORT_OPTIONS,
  MAX_RELEVANCE,
  MIN_RELEVANCE,
  countUnscored,
  highestScore,
  isDiscoverySort,
  visibleRecommendations,
} from '../utils/discoveryFilter'
import LiveRecordCard from './LiveRecordCard'

const EXAMPLES = SCENARIOS.map((scenario) => scenario.exampleQuestion)

interface FilterChip {
  key: string
  label: string
  onRemove: () => void
}

function AIDiscovery() {
  const {
    state,
    setDraft,
    setView,
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
    clearSelection,
  } = useWorkspace()
  const search = state.aiSearch
  const draft = state.draftQuestion
  const discoveryUI = state.discoveryUI
  const liveQuestion = state.liveQuestion
  const liveSelected = state.liveSelected

  const [draftError, setDraftError] = useState<string | null>(null)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [coverageOpen, setCoverageOpen] = useState(false)
  const [examplesOpen, setExamplesOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const loading = search.status === 'loading'
  const result = search.result
  const compact = result !== null
  const completedSeconds =
    search.durationMs === null
      ? null
      : Math.max(0, Math.round(search.durationMs / 1000))

  // Filtering only chooses what is shown: the full returned set stays in the
  // store (loosening the filters brings rows back) and selection is untouched.
  const allRecommendations = useMemo(
    () => result?.recommendations ?? [],
    [result],
  )
  const visible = useMemo(
    () => visibleRecommendations(allRecommendations, discoveryUI),
    [allRecommendations, discoveryUI],
  )
  const topScore = highestScore(allRecommendations)
  const unscoredCount = countUnscored(allRecommendations)
  // Old results stay labeled with their question until a new search succeeds:
  // either a different search is in flight, or the draft moved on.
  const resultsStale =
    result !== null &&
    ((search.question !== null &&
      normalizeQuestion(search.question) !==
        normalizeQuestion(result.question)) ||
      (draft.trim() !== '' &&
        normalizeQuestion(draft) !== normalizeQuestion(result.question)))

  // Datalist suggestions come only from the returned set — never invented.
  const tagOptions = useMemo(() => {
    const values = new Set<string>()
    for (const item of allRecommendations) {
      for (const tag of item.record.tags ?? []) values.add(tag)
    }
    return [...values].sort((a, b) => a.localeCompare(b))
  }, [allRecommendations])
  const publisherOptions = useMemo(() => {
    const values = new Set<string>()
    for (const item of allRecommendations) {
      if (item.record.organization_name) {
        values.add(item.record.organization_name)
      }
      if (
        item.record.portal_name &&
        item.record.portal_name !== item.record.organization_name
      ) {
        values.add(item.record.portal_name)
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b))
  }, [allRecommendations])
  const typeOptions = useMemo(() => {
    const values = new Set<string>()
    for (const item of allRecommendations) {
      if (item.record.item_type) values.add(item.record.item_type)
    }
    return [...values].sort((a, b) => a.localeCompare(b))
  }, [allRecommendations])

  const chips: FilterChip[] = []
  if (!discoveryUI.showAll) {
    chips.push({
      key: 'threshold',
      label: `Relevance ${discoveryUI.minScore}+`,
      onRemove: () => setDiscoveryShowAll(true),
    })
  }
  if (discoveryUI.tag.trim() !== '') {
    chips.push({
      key: 'tag',
      label: `Tag: ${discoveryUI.tag.trim()}`,
      onRemove: () => setDiscoveryTag(''),
    })
  }
  if (discoveryUI.publisher.trim() !== '') {
    chips.push({
      key: 'publisher',
      label: `Publisher: ${discoveryUI.publisher.trim()}`,
      onRemove: () => setDiscoveryPublisher(''),
    })
  }
  if (discoveryUI.itemType.trim() !== '') {
    chips.push({
      key: 'type',
      label: `Type: ${discoveryUI.itemType.trim()}`,
      onRemove: () => setDiscoveryItemType(''),
    })
  }
  if (discoveryUI.text.trim() !== '') {
    chips.push({
      key: 'text',
      label: `Title or ID: ${discoveryUI.text.trim()}`,
      onRemove: () => setDiscoveryText(''),
    })
  }
  const filtersActive =
    chips.length > 0 || discoveryUI.sort !== 'score-desc'

  useEffect(() => {
    if (!loading) return
    const timer = window.setInterval(
      () => setTick((value) => value + 1),
      500,
    )
    return () => window.clearInterval(timer)
  }, [loading])

  useEffect(() => {
    if (draftError === null) return
    const timer = window.setTimeout(() => setDraftError(null), 4000)
    return () => window.clearTimeout(timer)
  }, [draftError])

  function handleExampleClick(example: string) {
    setDraft(example)
    setDraftError(null)
    textareaRef.current?.focus()
  }

  function startSearch(question: string) {
    setPendingQuestion(null)
    setTick(0)
    runAISearch(question)
  }

  function handleSortChange(value: string) {
    if (isDiscoverySort(value)) setDiscoverySort(value)
  }

  function handleMinNumberChange(value: string) {
    if (value.trim() === '') return
    const parsed = Number(value)
    if (Number.isFinite(parsed)) setMinScore(parsed)
  }

  function handleDraftChange(value: string) {
    setDraft(value)
    if (draftError !== null && value.trim() !== '') setDraftError(null)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed) {
      setDraftError('Type a question first.')
      textareaRef.current?.focus()
      return
    }
    setDraftError(null)
    if (
      liveSelected.length > 0 &&
      liveQuestion !== null &&
      normalizeQuestion(trimmed) !== normalizeQuestion(liveQuestion)
    ) {
      setPendingQuestion(trimmed)
      return
    }
    startSearch(trimmed)
  }

  return (
    <div className={compact ? 'ai-compact' : undefined}>
      <h1>What would you like to investigate?</h1>
      {!compact && (
        <p className="lede">
          Ask about your community in your own words. AI evaluates real
          catalog datasets against your question and explains each
          recommendation.
        </p>
      )}

      <form className="question-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor="ai-question">Your question</label>
        <div className="question-row">
          <textarea
            id="ai-question"
            ref={textareaRef}
            value={draft}
            onChange={(event) => handleDraftChange(event.target.value)}
            placeholder="Which neighborhoods face the greatest flood risk?"
            rows={compact ? 2 : 3}
            aria-invalid={draftError !== null}
            aria-describedby={draftError ? 'ai-question-error' : undefined}
          />
          <div className="question-actions">
            <button type="submit" disabled={loading}>
              {loading ? 'Searching…' : 'Search with AI'}
            </button>
            {loading && (
              <button
                type="button"
                className="secondary button-danger"
                onClick={cancelAISearch}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
        {draftError && (
          <p id="ai-question-error" className="question-toast" role="alert">
            {draftError}
          </p>
        )}
      </form>

      {loading && (
        <>
          <p aria-live="polite">Searching the catalog…</p>
          <p className="sample-note" aria-hidden="true">
            {Math.floor(tick / 2)}s elapsed.
          </p>
          <p className="sample-note">
            Evaluating candidate datasets against your question. Canceling
            stops this wait here; a request already sent to the model
            service may still finish.
          </p>
        </>
      )}
      {search.status === 'ready' && result && completedSeconds !== null && (
        <p role="status">
          Search completed in about {completedSeconds}s.
        </p>
      )}

      {!compact && (
        <section aria-labelledby="ai-examples-heading">
          <h2 id="ai-examples-heading">Try an example</h2>
          <ul className="example-list">
            {EXAMPLES.map((example) => (
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
      )}

      {compact && (
        <section aria-label="Example questions" className="examples-disclosure">
          <button
            type="button"
            className="secondary small"
            aria-expanded={examplesOpen}
            aria-controls="ai-example-list"
            onClick={() => setExamplesOpen((value) => !value)}
          >
            {examplesOpen ? 'Hide examples' : 'Try another example'}
          </button>
          {examplesOpen && (
            <div id="ai-example-list">
              <ul className="example-list">
                {EXAMPLES.map((example) => (
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
            </div>
          )}
        </section>
      )}

      {pendingQuestion && (
        <div className="notice" role="alert">
          <p>
            You have {liveSelected.length} dataset
            {liveSelected.length === 1 ? '' : 's'} selected for a different
            question. What should happen to that selection?
          </p>
          <div className="choice-actions">
            <button
              type="button"
              className="secondary small"
              onClick={() => startSearch(pendingQuestion)}
            >
              Keep selection and search
            </button>
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                clearSelection()
                startSearch(pendingQuestion)
              }}
            >
              Clear selection and search
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => setPendingQuestion(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {search.status === 'error' && (
        <div className="notice" role="alert">
          <p>{search.error ?? 'The search failed.'}</p>
          {search.question && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setTick(0)
                if (search.question) runAISearch(search.question)
              }}
            >
              Retry search
            </button>
          )}
        </div>
      )}

      {search.status === 'canceled' && (
        <div className="notice" role="status">
          <p>
            Search canceled.{' '}
            {result
              ? 'Your previous results and collection are unchanged below.'
              : 'No results yet — run a search when ready.'}
          </p>
        </div>
      )}

      {result && (
        <div aria-live="polite" aria-busy={loading}>
          {search.status === 'error' && (
            <div className="notice" role="status">
              <p>
                The latest search failed. Showing previous results for:{' '}
                <q>{result.question}</q>
              </p>
            </div>
          )}
          {loading && (
            <p className="sample-note">Updating results…</p>
          )}
          {resultsStale && (
            <div className="notice" role="status">
              <p>
                These recommendations belong to your previous question:{' '}
                <q>{result.question}</q> Run a new search to refresh
                them.
              </p>
            </div>
          )}
          {unscoredCount > 0 && (
            <div className="notice" role="status">
              <p>
                {unscoredCount} of {allRecommendations.length}{' '}
                recommendations arrived without an AI relevance score, so{' '}
                {unscoredCount === 1 ? 'it is' : 'they are'} listed as
                unscored and cannot be threshold-filtered. Rerun the
                search for fresh scores.
              </p>
              <button
                type="button"
                className="secondary small"
                onClick={() => startSearch(result.question)}
              >
                Rerun search
              </button>
            </div>
          )}
          {result.partial && (
            <div className="notice" role="status">
              <p>
                Partial search
                {result.partial_reason
                  ? `: ${result.partial_reason}`
                  : '. These results cover only part of the catalog.'}
              </p>
            </div>
          )}

          <section aria-labelledby="ai-goal-heading">
            <h2 id="ai-goal-heading">What we understood</h2>
            <p>{result.interpretation.goal}</p>
            {result.interpretation.assumptions.length > 0 && (
              <>
                <h3>Assumptions</h3>
                <ul>
                  {result.interpretation.assumptions.map((assumption) => (
                    <li key={assumption}>{assumption}</li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section aria-labelledby="ai-results-heading">
            <h2 id="ai-results-heading">Recommended datasets</h2>
            {allRecommendations.length === 0 ? (
              <div className="notice">
                <p>
                  The search completed, but nothing in the retrieved
                  catalog closely matches this question. Try rephrasing it
                  or browsing the catalog directly.
                </p>
              </div>
            ) : (
              <>
                <p className="sample-note">
                  Direct match: measures what you asked about. Supporting:
                  useful context for your question. AI relevance scores
                  are the model&apos;s own assessment of fit, not
                  calibrated probabilities.
                </p>
                <div
                  className="filter-toolbar"
                  role="group"
                  aria-label="Filter and sort these recommendations"
                >
                  <div
                    className="filter-presets"
                    role="group"
                    aria-label="Relevance presets"
                  >
                    <button
                      type="button"
                      className={
                        discoveryUI.showAll
                          ? 'secondary small preset-active'
                          : 'secondary small'
                      }
                      aria-pressed={discoveryUI.showAll}
                      onClick={() => setDiscoveryShowAll(true)}
                    >
                      Show all {allRecommendations.length}
                    </button>
                    <button
                      type="button"
                      className={
                        !discoveryUI.showAll &&
                        discoveryUI.minScore === DEFAULT_MIN_RELEVANCE
                          ? 'secondary small preset-active'
                          : 'secondary small'
                      }
                      aria-pressed={
                        !discoveryUI.showAll &&
                        discoveryUI.minScore === DEFAULT_MIN_RELEVANCE
                      }
                      onClick={() => setMinScore(DEFAULT_MIN_RELEVANCE)}
                    >
                      Strong matches: {DEFAULT_MIN_RELEVANCE}+
                    </button>
                  </div>
                  <div className="filter-field">
                    <label htmlFor="ai-min-score">Minimum relevance</label>
                    <div className="range-row">
                      <input
                        id="ai-min-score"
                        type="range"
                        min={MIN_RELEVANCE}
                        max={MAX_RELEVANCE}
                        step={1}
                        value={discoveryUI.minScore}
                        onChange={(event) =>
                          setMinScore(Number(event.target.value))
                        }
                      />
                      <input
                        id="ai-min-score-number"
                        type="number"
                        min={MIN_RELEVANCE}
                        max={MAX_RELEVANCE}
                        step={1}
                        value={discoveryUI.minScore}
                        aria-label="Minimum relevance score"
                        onChange={(event) =>
                          handleMinNumberChange(event.target.value)
                        }
                      />
                    </div>
                  </div>
                  <div className="filter-field">
                    <label htmlFor="ai-sort">Sort by</label>
                    <select
                      id="ai-sort"
                      value={discoveryUI.sort}
                      onChange={(event) =>
                        handleSortChange(event.target.value)
                      }
                    >
                      {DISCOVERY_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="filter-field">
                    <label htmlFor="ai-tag">Tag</label>
                    <input
                      id="ai-tag"
                      type="text"
                      list="ai-tag-options"
                      value={discoveryUI.tag}
                      onChange={(event) =>
                        setDiscoveryTag(event.target.value)
                      }
                      placeholder="Search tags"
                      autoComplete="off"
                    />
                    <datalist id="ai-tag-options">
                      {tagOptions.map((tag) => (
                        <option key={tag} value={tag} />
                      ))}
                    </datalist>
                  </div>
                  <div className="filter-field">
                    <label htmlFor="ai-publisher">Publisher</label>
                    <input
                      id="ai-publisher"
                      type="text"
                      list="ai-publisher-options"
                      value={discoveryUI.publisher}
                      onChange={(event) =>
                        setDiscoveryPublisher(event.target.value)
                      }
                      placeholder="Publisher or portal"
                      autoComplete="off"
                    />
                    <datalist id="ai-publisher-options">
                      {publisherOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                  <div className="filter-field">
                    <label htmlFor="ai-type">Dataset type</label>
                    <input
                      id="ai-type"
                      type="text"
                      list="ai-type-options"
                      value={discoveryUI.itemType}
                      onChange={(event) =>
                        setDiscoveryItemType(event.target.value)
                      }
                      placeholder="Dataset type"
                      autoComplete="off"
                    />
                    <datalist id="ai-type-options">
                      {typeOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                  <div className="filter-field filter-field-wide">
                    <label htmlFor="ai-text">Title or dataset ID</label>
                    <input
                      id="ai-text"
                      type="text"
                      value={discoveryUI.text}
                      onChange={(event) =>
                        setDiscoveryText(event.target.value)
                      }
                      placeholder="Title words or an exact ID"
                      autoComplete="off"
                    />
                  </div>
                  <div className="filter-field filter-actions">
                    <button
                      type="button"
                      className="secondary small"
                      disabled={!filtersActive}
                      onClick={clearDiscoveryFilters}
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
                {chips.length > 0 && (
                  <ul className="filter-chips" aria-label="Active filters">
                    {chips.map((chip) => (
                      <li key={chip.key}>
                        <button
                          type="button"
                          className="filter-chip"
                          onClick={chip.onRemove}
                          aria-label={`Remove ${chip.label} filter`}
                        >
                          {chip.label}
                          <span aria-hidden="true"> ×</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p role="status">
                  Showing {visible.length} of {allRecommendations.length}{' '}
                  evaluated recommendations
                  {discoveryUI.showAll
                    ? '.'
                    : ` (minimum relevance ${discoveryUI.minScore}).`}
                </p>
                <p className="sample-note">
                  Filters narrow these {allRecommendations.length} returned
                  recommendations only — they do not search the catalog.
                </p>
                <p className="sample-note">
                  The model evaluated{' '}
                  {result.coverage.candidates_evaluated} candidates from{' '}
                  {result.coverage.records_retrieved} retrieved catalog
                  records
                  {result.coverage.catalog_total !== null &&
                    ` (catalog total ${result.coverage.catalog_total})`}
                  ; recommendations are capped at{' '}
                  {result.coverage.result_cap}.
                </p>
                {visible.length === 0 ? (
                  <div className="notice" role="status">
                    <p>
                      No returned recommendations match the current filters.
                      Loosen or clear them; your dataset collection is
                      unchanged.
                    </p>
                    <div className="choice-actions">
                      {!discoveryUI.showAll &&
                        topScore !== null &&
                        topScore < discoveryUI.minScore && (
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() => setMinScore(topScore)}
                          >
                            Lower minimum to {topScore}
                          </button>
                        )}
                      <button
                        type="button"
                        className="secondary small"
                        onClick={clearDiscoveryFilters}
                      >
                        Clear filters
                      </button>
                    </div>
                  </div>
                ) : (
                  <ul className="dataset-list">
                    {visible.map((item, index) => {
                      const key = expandedKeyForRecord(
                        item.record,
                        `ai-result-${index}`,
                      )
                      return (
                        <LiveRecordCard
                          key={
                            item.record.assigned_id ??
                            item.record.title ??
                            `unknown-${index}`
                          }
                          record={item.record}
                          selected={
                            item.record.assigned_id !== null &&
                            liveSelected.some(
                              (selected) =>
                                selected.assigned_id ===
                                item.record.assigned_id,
                            )
                          }
                          onToggle={(record) => toggleLive(record, 'ai')}
                          expandedKey={key}
                          annotation={{
                            relevance: item.relevance,
                            relevance_score: item.relevance_score,
                            why: item.why,
                            limitations: item.limitations,
                          }}
                        />
                      )
                    })}
                  </ul>
                )}
              </>
            )}
          </section>

          {result.gaps.length > 0 && (
            <section aria-labelledby="ai-gaps-heading">
              <h2 id="ai-gaps-heading">Evidence gaps</h2>
              <ul>
                {result.gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </section>
          )}

          <section
            aria-label="Search coverage details"
            className="examples-disclosure"
          >
            <button
              type="button"
              className="secondary small"
              aria-expanded={coverageOpen}
              aria-controls="ai-coverage-details"
              onClick={() => setCoverageOpen((value) => !value)}
            >
              {coverageOpen
                ? 'Hide search coverage'
                : 'How this search worked'}
            </button>
            {coverageOpen && (
              <div id="ai-coverage-details" className="notice">
                <ul>
                  <li>
                    Catalog records retrieved:{' '}
                    {result.coverage.records_retrieved}
                    {result.coverage.catalog_total !== null &&
                      ` of ${result.coverage.catalog_total}`}
                    {result.coverage.retrieval_complete
                      ? ' (complete)'
                      : ' (partial)'}
                  </li>
                  <li>
                    Candidates evaluated by the model:{' '}
                    {result.coverage.candidates_evaluated}
                  </li>
                  {result.coverage.top_candidates.length > 0 && (
                    <li>
                      Top candidates considered:
                      <ul>
                        {result.coverage.top_candidates.map((title) => (
                          <li key={title}>{title}</li>
                        ))}
                      </ul>
                    </li>
                  )}
                  {result.coverage.candidates_excluded_no_id > 0 && (
                    <li>
                      Excluded for missing IDs:{' '}
                      {result.coverage.candidates_excluded_no_id}
                    </li>
                  )}
                  {result.coverage.model_dropped_unknown_ids > 0 && (
                    <li>
                      Dropped unknown model-returned IDs:{' '}
                      {result.coverage.model_dropped_unknown_ids}
                    </li>
                  )}
                  {result.coverage.model_duplicates_removed > 0 && (
                    <li>
                      Duplicates removed:{' '}
                      {result.coverage.model_duplicates_removed}
                    </li>
                  )}
                  {result.coverage.cap_applied && (
                    <li>
                      Result cap applied (showing{' '}
                      {result.coverage.result_cap} of more matches).
                    </li>
                  )}
                  <li>
                    Retrieval:{' '}
                    {result.coverage.retrieval_method} —{' '}
                    {result.coverage.retrieval_note}
                  </li>
                  {result.coverage.retrieval_notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {liveSelected.length > 0 && (
            <div className="notice">
              <p>
                Your dataset collection: {liveSelected.length} dataset
                {liveSelected.length === 1 ? '' : 's'}
                {liveQuestion ? (
                  <>
                    {' '}
                    for: <q>{liveQuestion}</q>
                  </>
                ) : (
                  '.'
                )}
              </p>
              <div className="choice-actions">
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => setView('recipe')}
                >
                  Review your dataset collection
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setView('catalog')}
                >
                  Browse the catalog instead
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AIDiscovery
