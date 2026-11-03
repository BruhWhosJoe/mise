import { useEffect, useState } from 'react'
import type {
  LiveRecord,
  RecipeDatasetRef,
  RecipeResponse,
} from '../services/api'
import {
  RECIPE_MAX_DATASETS,
  errorMessage,
  fetchDatasetDetailCached,
  isHttpUrl,
} from '../services/api'
import { useWorkspace } from '../state/useWorkspace'
import {
  isRecipeStale,
  recipeInputsValid,
  selectedIds,
} from '../state/workspaceReducer'
import {
  authoritativeLinks,
  preferredShareLink,
} from '../utils/datasetLinks'
import { downloadTextFile } from '../utils/download'
import CopyLinkButton from './CopyLinkButton'
import { DatasetDetailSections, ExternalLink } from './DatasetDetails'
import RecipeDiagram from './RecipeDiagram'

function buildRecipeMarkdown(recipe: RecipeResponse): string {
  const lines: string[] = [
    '# Data recipe',
    '',
    `Proposed analysis plan — not executed analysis. Generated ${recipe.generated_at}.`,
    '',
    `Question: ${recipe.question}`,
    '',
    '## Objective',
    '',
    recipe.objective,
    '',
    '## Datasets',
    '',
  ]
  for (const dataset of recipe.datasets) {
    const link = isHttpUrl(dataset.access_url)
      ? ` ([source](${dataset.access_url}))`
      : ''
    const publisher =
      dataset.organization_name ?? dataset.portal_name ?? 'Publisher not given'
    lines.push(
      `- **${dataset.title ?? 'Untitled record'}** — ${publisher} (ID: ${dataset.assigned_id})${link}`,
    )
  }
  lines.push('', '## Contributions', '')
  for (const item of recipe.contributions) {
    lines.push(`- **${item.assigned_id}**: ${item.contribution}`)
  }
  lines.push('', '## Workflow', '')
  for (const step of recipe.workflow) {
    const refs =
      step.dataset_ids.length > 0 ? ` [${step.dataset_ids.join(', ')}]` : ''
    lines.push(`1. **${step.title}**${refs}`, `   ${step.detail}`)
  }
  const bulleted = (heading: string, items: string[]) => {
    lines.push('', heading, '')
    if (items.length === 0) {
      lines.push('- None noted.')
      return
    }
    for (const item of items) lines.push(`- ${item}`)
  }
  lines.push('', '## Combinations', '')
  if (recipe.combinations.length === 0) {
    lines.push('- None proposed.')
  }
  for (const combo of recipe.combinations) {
    lines.push(
      `- Datasets: ${combo.dataset_ids.join(', ') || 'none specified'}`,
      `  - Approach: ${combo.approach}`,
      `  - Prerequisites: ${combo.prerequisites}`,
      `  - Uncertainty: ${combo.uncertainty}`,
    )
  }
  bulleted('## Gaps', recipe.gaps)
  bulleted('## Limitations and checks', recipe.limitations)
  bulleted('## Proposed outputs', recipe.outputs)
  return lines.join('\n') + '\n'
}

function DatasetChip({
  datasetId,
  refs,
}: {
  datasetId: string
  refs: Map<string, RecipeDatasetRef>
}) {
  const dataset = refs.get(datasetId)
  const label = dataset?.title ?? datasetId
  return (
    <span className="dataset-chip">
      {dataset && isHttpUrl(dataset.access_url) ? (
        <a href={dataset.access_url} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : (
        label
      )}
    </span>
  )
}

/**
 * One dataset in a generated recipe: the same Open / Copy / View-details
 * actions as elsewhere. Full metadata loads only when the reader opens
 * details (cached per dataset). No remove control here — the recipe is
 * generated output; membership changes happen in the dataset collection.
 */
function RecipeDatasetItem({ dataset }: { dataset: RecipeDatasetRef }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<LiveRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const links = authoritativeLinks(dataset)
  const title = dataset.title ?? 'Untitled record'
  const safeId = dataset.assigned_id.replace(/[^a-zA-Z0-9_-]/g, '-')
  const detailId = `recipe-detail-${safeId}`

  async function loadDetail() {
    setLoading(true)
    setLoadError(null)
    try {
      setDetail(await fetchDatasetDetailCached(dataset.assigned_id))
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  function handleToggleOpen() {
    const next = !open
    setOpen(next)
    if (next && detail === null && !loading) {
      void loadDetail()
    }
  }

  return (
    <li className="recipe-item">
      <div>
        <h4>{title}</h4>
        <p className="dataset-meta">
          {dataset.organization_name ??
            dataset.portal_name ??
            'Source not provided'}
          <span aria-hidden="true"> · </span>
          <span>ID: {dataset.assigned_id}</span>
        </p>
        <div className="dataset-links">
          {links.sourcePage ? (
            <ExternalLink href={links.sourcePage}>
              Open source page
            </ExternalLink>
          ) : (
            <span className="not-provided">Source link not provided</span>
          )}
          <CopyLinkButton
            url={preferredShareLink(links)}
            itemLabel={title}
          />
        </div>
        {open && (
          <div id={detailId} className="dataset-details">
            {loading && <p aria-live="polite">Loading full metadata…</p>}
            {loadError && (
              <div className="notice">
                <p>{loadError}</p>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => void loadDetail()}
                >
                  Retry
                </button>
              </div>
            )}
            {!loading && !loadError && detail && (
              <DatasetDetailSections record={detail} />
            )}
          </div>
        )}
      </div>
      <div className="item-actions">
        <button
          type="button"
          className="secondary small"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={handleToggleOpen}
        >
          {open ? 'Hide details' : 'View details'}
        </button>
      </div>
    </li>
  )
}

function LiveRecipe() {
  const { state, setView, generateRecipe } = useWorkspace()
  const recipe = state.recipe
  const liveQuestion = state.liveQuestion
  const liveSelected = state.liveSelected
  const stale = isRecipeStale(state)
  const inputsValid = recipeInputsValid(state)
  const [tick, setTick] = useState(0)
  const data = recipe.data
  const completedSeconds =
    recipe.durationMs === null
      ? null
      : Math.max(0, Math.round(recipe.durationMs / 1000))
  const refById = new Map(
    (data?.datasets ?? []).map((dataset) => [dataset.assigned_id, dataset]),
  )

  useEffect(() => {
    if (recipe.status !== 'loading') return
    const timer = window.setInterval(
      () => setTick((value) => value + 1),
      500,
    )
    return () => window.clearInterval(timer)
  }, [recipe.status])

  function handleGenerate() {
    setTick(0)
    generateRecipe()
  }

  return (
    <section aria-labelledby="live-recipe-heading">
      <h2 id="live-recipe-heading">Your data recipe</h2>
      {liveQuestion ? (
        <p className="submitted-question">
          Question: <q>{liveQuestion}</q>
        </p>
      ) : (
        <p>
          Ask a question in AI Discovery first, then add the datasets you want
          to build on to your dataset collection.
        </p>
      )}
      <p className="sample-note">
        Your dataset collection: {selectedIds(state).length} of up to{' '}
        {RECIPE_MAX_DATASETS} datasets selected.
      </p>
      {liveSelected.length > RECIPE_MAX_DATASETS && (
        <div className="notice" role="alert">
          <p>
            Deselect down to {RECIPE_MAX_DATASETS} datasets to generate a
            recipe.
          </p>
        </div>
      )}

      <button
        type="button"
        disabled={!inputsValid || recipe.status === 'loading'}
        onClick={handleGenerate}
      >
        {data ? 'Regenerate recipe' : 'Generate recipe'}
      </button>

      {recipe.status === 'loading' && (
        <>
          <p aria-live="polite">Generating your recipe…</p>
          <p className="sample-note" aria-hidden="true">
            {Math.floor(tick / 2)}s elapsed.
          </p>
        </>
      )}
      {recipe.status === 'ready' && data && completedSeconds !== null && (
        <p role="status">
          Recipe ready — generated in about {completedSeconds}s.
        </p>
      )}

      {recipe.status === 'error' && (
        <div className="notice" role="alert">
          <p>{recipe.error ?? 'Recipe generation failed.'}</p>
          <button
            type="button"
            className="secondary"
            disabled={!inputsValid}
            onClick={handleGenerate}
          >
            Retry
          </button>
        </div>
      )}

      {stale && data && (
        <div className="notice" role="status">
          <p>
            Your question or selection changed since this recipe was
            generated, so it may be out of date.
          </p>
          <button
            type="button"
            className="secondary small"
            disabled={!inputsValid || recipe.status === 'loading'}
            onClick={handleGenerate}
          >
            Regenerate
          </button>
        </div>
      )}

      {data && (
        <div aria-live="polite" className="recipe-content">
          <h3>Objective</h3>
          <p>{data.objective}</p>

          <h3>Datasets ({data.datasets.length})</h3>
          <ul className="recipe-list">
            {data.datasets.map((dataset) => (
              <RecipeDatasetItem
                key={dataset.assigned_id}
                dataset={dataset}
              />
            ))}
          </ul>

          <h3>Contributions</h3>
          <ul>
            {data.contributions.map((item) => (
              <li key={item.assigned_id}>
                <DatasetChip datasetId={item.assigned_id} refs={refById} />
                {': '}
                {item.contribution}
              </li>
            ))}
          </ul>

          <h3>Analysis workflow</h3>
          {data.workflow.length === 0 ? (
            <p className="empty-section">
              No workflow steps were provided.
            </p>
          ) : (
            <ol>
              {data.workflow.map((step) => (
                <li key={step.step}>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                  {step.dataset_ids.length > 0 && (
                    <p>
                      {step.dataset_ids.map((id) => (
                        <DatasetChip key={id} datasetId={id} refs={refById} />
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}

          <h3>Ways to combine</h3>
          {data.combinations.length === 0 ? (
            <p className="empty-section">
              No dataset combinations were proposed.
            </p>
          ) : (
            <ul>
              {data.combinations.map((combo, index) => (
                <li key={`${combo.approach}-${index}`}>
                  <p>
                    {combo.dataset_ids.map((id) => (
                      <DatasetChip
                        key={id}
                        datasetId={id}
                        refs={refById}
                      />
                    ))}
                  </p>
                  <p>Approach: {combo.approach}</p>
                  <p>Prerequisites: {combo.prerequisites}</p>
                  <p>Uncertainty: {combo.uncertainty}</p>
                </li>
              ))}
            </ul>
          )}

          <RecipeDiagram recipe={data} />

          <h3>Data gaps</h3>
          {data.gaps.length === 0 ? (
            <p className="empty-section">
              No data gaps were noted in this recipe.
            </p>
          ) : (
            <ul>
              {data.gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          )}

          <h3>Limitations and checks</h3>
          {data.limitations.length === 0 ? (
            <p className="empty-section">
              No limitations were listed. This does not mean none exist —
              verify methods, coverage, and licensing before analysis.
            </p>
          ) : (
            <ul>
              {data.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          )}

          <h3>Proposed outputs</h3>
          {data.outputs.length === 0 ? (
            <p className="empty-section">
              No proposed outputs were listed.
            </p>
          ) : (
            <ul>
              {data.outputs.map((output) => (
                <li key={output}>{output}</li>
              ))}
            </ul>
          )}

          <p className="sample-note">
            Generated {new Date(data.generated_at).toLocaleString()}.
          </p>
          <div className="review-actions">
            <button
              type="button"
              className="secondary small"
              onClick={() =>
                downloadTextFile(
                  'mise-data-recipe.md',
                  buildRecipeMarkdown(data),
                  'text/markdown',
                )
              }
            >
              Download Markdown
            </button>
            <button
              type="button"
              className="secondary small"
              onClick={() =>
                downloadTextFile(
                  'mise-data-recipe.json',
                  JSON.stringify(data, null, 2),
                  'application/json',
                )
              }
            >
              Download JSON
            </button>
          </div>
        </div>
      )}

      {!data && recipe.status !== 'loading' && (
        <div className="notice">
          <p>
            No recipe yet. Ask a question in AI Discovery, add up to{' '}
            {RECIPE_MAX_DATASETS} datasets to your dataset collection, then
            come back here.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => setView('discover')}
          >
            Back to AI Discovery
          </button>
        </div>
      )}
    </section>
  )
}

export default LiveRecipe
