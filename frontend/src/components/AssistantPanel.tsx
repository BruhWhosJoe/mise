import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { SCENARIOS } from '../data/fixtures'
import { useWorkspace } from '../state/useWorkspace'
import {
  ASSISTANT_DEFAULT_WIDTH,
  ASSISTANT_MIN_WIDTH,
  isRecipeStale,
} from '../state/workspaceReducer'
import { nextAction } from '../utils/guidance'

/** Starter questions: prefill the central box, never submit or chat. */
const PRESETS = [
  { label: 'School safety', match: 'pedestrian-safety' },
  { label: 'Flood exposure', match: 'flood-exposure' },
  { label: 'Healthcare access', match: 'healthcare-access' },
].map((preset) => ({
  label: preset.label,
  question:
    SCENARIOS.find((scenario) => scenario.id === preset.match)
      ?.exampleQuestion ?? '',
}))

function AssistantPanel({ maxWidth }: { maxWidth: number }) {
  const {
    state,
    setView,
    setDraft,
    setAssistantOpen,
    setAssistantWidth,
    sendChat,
    retryChat,
    undoChatApplied,
    dismissChatSuggestion,
    clearChatError,
  } = useWorkspace()
  const assistant = state.assistant
  // Width to return to when leaving the expanded size (the pre-expand width
  // when it was a deliberate choice, else the default).
  const restoreWidthRef = useRef<number>(ASSISTANT_DEFAULT_WIDTH)
  const expanded = assistant.width >= maxWidth - 1
  const selectionCount = state.liveSelected.length
  const hasResults = state.aiSearch.result !== null
  const guidance = nextAction({
    investigation: state.liveQuestion,
    selectionCount,
    aiStatus: state.aiSearch.status,
    recipeStatus: state.recipe.status,
    recipeStale: isRecipeStale(state),
  })
  const [draft, setDraftMessage] = useState('')
  const [contextOpen, setContextOpen] = useState(true)
  const loading = assistant.chatStatus === 'loading'

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.trim() === '' || loading) return
    sendChat(draft)
    setDraftMessage('')
  }

  function prefillQuestion(question: string) {
    // Fill the central question box without submitting: the user reviews
    // and runs the search themselves from AI Discovery.
    setDraft(question)
    setView('discover')
  }

  function toggleExpanded() {
    if (expanded) {
      const restore = restoreWidthRef.current
      setAssistantWidth(
        restore >= ASSISTANT_MIN_WIDTH && restore < maxWidth
          ? restore
          : ASSISTANT_DEFAULT_WIDTH,
      )
    } else {
      if (
        assistant.width >= ASSISTANT_MIN_WIDTH &&
        assistant.width < maxWidth
      ) {
        restoreWidthRef.current = assistant.width
      }
      setAssistantWidth(maxWidth)
    }
  }

  return (
    <div className="assistant-inner">
      <div className="assistant-header">
        <h2>Assistant</h2>
        <button
          type="button"
          className="secondary small"
          aria-expanded="true"
          aria-controls="assistant-panel"
          onClick={() => setAssistantOpen(false)}
        >
          Hide assistant
        </button>
      </div>
      <div className="assistant-width">
        <button
          type="button"
          className="secondary small"
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          {expanded ? 'Restore panel size' : 'Expand panel'}
        </button>
        <p className="assistant-resize-hint">
          Drag the panel edge, or focus it and use the arrow keys.
        </p>
      </div>

      <section className="context-card" aria-label="Current investigation">
        <button
          type="button"
          className="context-card-toggle"
          aria-expanded={contextOpen}
          onClick={() => setContextOpen((value) => !value)}
        >
          <span>Current investigation</span>
          <span aria-hidden="true">{contextOpen ? '▾' : '▸'}</span>
        </button>
        {contextOpen && (
          <dl className="assistant-context">
            <div>
              <dt>Question</dt>
              <dd>{state.liveQuestion ?? 'None yet'}</dd>
            </div>
            <div>
              <dt>Selected</dt>
              <dd>
                {selectionCount} dataset{selectionCount === 1 ? '' : 's'}
              </dd>
            </div>
            <div>
              <dt>Next action</dt>
              <dd>{guidance}</dd>
            </div>
          </dl>
        )}
      </section>

      <section aria-label="Conversation" className="conversation">
        <h3>Conversation</h3>
        {assistant.messages.length === 0 ? (
          hasResults ? (
            <p className="assistant-hint">
              Ask about your recommendations — for example, “Why was this
              dataset recommended?” or “Select the top 3.”
            </p>
          ) : (
            <p className="assistant-hint">
              Run an AI Discovery search first. Then I can explain
              recommendations, compare datasets, or add them to your
              collection when you ask.
            </p>
          )
        ) : (
          <ol className="assistant-messages">
            {assistant.messages.map((message) => (
              <li key={message.id} className={`chat-${message.role}`}>
                <span className="chat-role">
                  {message.role === 'user' ? 'You' : 'Assistant'}
                </span>
                <p>{message.text}</p>
              </li>
            ))}
          </ol>
        )}
        {loading && <p aria-live="polite">Thinking…</p>}
        {assistant.chatStatus === 'error' && (
          <div className="notice" role="alert">
            <p>{assistant.chatError ?? 'The assistant failed.'}</p>
            <div className="choice-actions">
              <button
                type="button"
                className="secondary small"
                onClick={retryChat}
              >
                Retry
              </button>
              <button
                type="button"
                className="link-button"
                onClick={clearChatError}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {assistant.lastChangeSummary !== null && (
          <div className="notice notice-inline" role="status">
            <p>{assistant.lastChangeSummary}</p>
            {state.chatApplied !== null && (
              <button
                type="button"
                className="secondary small"
                onClick={undoChatApplied}
              >
                Undo
              </button>
            )}
          </div>
        )}
        {assistant.suggestedQuestion !== null && (
          <div className="notice">
            <p>
              Suggested question: <q>{assistant.suggestedQuestion}</q>
            </p>
            <div className="choice-actions">
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  prefillQuestion(assistant.suggestedQuestion as string)
                  dismissChatSuggestion()
                }}
              >
                Use this question
              </button>
              <button
                type="button"
                className="link-button"
                onClick={dismissChatSuggestion}
              >
                Dismiss
              </button>
            </div>
            <p className="sample-note">
              Fills the question box without searching.
            </p>
          </div>
        )}
        <form className="chat-form" onSubmit={handleSubmit}>
          <label htmlFor="assistant-chat-input">Ask the assistant</label>
          <div className="chat-row">
            <input
              id="assistant-chat-input"
              type="text"
              value={draft}
              onChange={(event) => setDraftMessage(event.target.value)}
              placeholder={
                hasResults
                  ? 'Ask about these recommendations…'
                  : 'Ask how to start…'
              }
              autoComplete="off"
              disabled={loading}
            />
            <button type="submit" disabled={loading || draft.trim() === ''}>
              {loading ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="assistant-presets-heading">
        <h3 id="assistant-presets-heading">Try a starter question</h3>
        <div className="choice-actions">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="secondary small"
              aria-label={`${preset.label}: ${preset.question}`}
              onClick={() => prefillQuestion(preset.question)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="sample-note">
          These fill the AI Discovery question box — they don&apos;t send a
          chat message or start a search.
        </p>
      </section>

      <details className="assistant-help">
        <summary>How the assistant works</summary>
        <ul>
          <li>
            Explanations and comparisons never change your results or
            collection.
          </li>
          <li>
            I apply only explicit requests — selecting the top results,
            adding or removing datasets, narrowing filters — with an Undo
            for each change.
          </li>
          <li>
            Refinements only narrow what is shown. Recipes are generated
            only when you ask on the Data Recipe view.
          </li>
        </ul>
      </details>
    </div>
  )
}

export default AssistantPanel
