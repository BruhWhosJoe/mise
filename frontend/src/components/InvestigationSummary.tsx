import { useMemo } from 'react'
import { useWorkspace } from '../state/useWorkspace'
import { isRecipeStale } from '../state/workspaceReducer'
import { visibleRecommendations } from '../utils/discoveryFilter'
import { nextAction, nextActionView } from '../utils/guidance'

function recipePhrase(
  status: 'idle' | 'loading' | 'ready' | 'error',
  stale: boolean,
): string {
  if (status === 'loading') return 'recipe generating'
  if (status === 'error') return 'recipe failed'
  if (status === 'ready') return stale ? 'recipe out of date' : 'recipe ready'
  return 'no recipe yet'
}

/**
 * Compact assisted-workspace summary: the actual question, result and
 * selection counts, recipe state, and the next useful action. Static text
 * (no live region) so it never re-announces on unrelated updates.
 */
function InvestigationSummary() {
  const { state, setView } = useWorkspace()
  const result = state.aiSearch.result
  const visible = useMemo(
    () =>
      result
        ? visibleRecommendations(result.recommendations, state.discoveryUI)
        : [],
    [result, state.discoveryUI],
  )
  const stale = isRecipeStale(state)
  const guidanceInput = {
    investigation: state.liveQuestion,
    selectionCount: state.liveSelected.length,
    aiStatus: state.aiSearch.status,
    recipeStatus: state.recipe.status,
    recipeStale: stale,
  }
  const action = nextAction(guidanceInput)
  const target = nextActionView(guidanceInput)
  const targetLabel =
    target === 'discover' ? 'Go to AI Discovery' : 'Go to Data Recipe'

  const started =
    state.liveQuestion !== null ||
    result !== null ||
    state.liveSelected.length > 0 ||
    state.recipe.data !== null ||
    state.recipe.status !== 'idle' ||
    state.aiSearch.status !== 'idle'
  if (!started) return null

  const total = result?.recommendations.length ?? 0
  // During a search the in-flight question is the useful progress signal —
  // never a "no question yet" line. On the discovery view itself the
  // question box is right below, so a missing question needs no callout.
  const searching =
    state.aiSearch.status === 'loading' && state.aiSearch.question !== null
  const showQuestionLine =
    state.liveQuestion !== null || searching || state.view !== 'discover'

  return (
    <section className="investigation-summary" aria-label="Investigation summary">
      <div className="investigation-summary-main">
        {showQuestionLine && (
          <p className="investigation-question">
            {state.liveQuestion ? (
              <>
                Investigating: <q>{state.liveQuestion}</q>
              </>
            ) : searching ? (
              <>
                Searching for: <q>{state.aiSearch.question}</q>
              </>
            ) : (
              'No investigation question yet'
            )}
          </p>
        )}
        <p className="investigation-counts">
          {result
            ? `${visible.length} of ${total} recommendations shown · `
            : null}
          {state.liveSelected.length} dataset
          {state.liveSelected.length === 1 ? '' : 's'} in your collection ·{' '}
          {recipePhrase(state.recipe.status, stale)}
        </p>
        <p className="investigation-next">
          Next: {action}{' '}
          {target !== state.view && (
            <button
              type="button"
              className="secondary small"
              onClick={() => setView(target)}
            >
              {targetLabel}
            </button>
          )}
        </p>
      </div>
    </section>
  )
}

export default InvestigationSummary
