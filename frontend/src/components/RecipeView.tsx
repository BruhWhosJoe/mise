import type { SampleDataset } from '../types'

interface RecipeViewProps {
  submittedQuestion: string | null
  selectedDatasets: SampleDataset[]
  onRemoveDataset: (id: string) => void
  onBackToDiscover: () => void
}

function RecipeView({
  submittedQuestion,
  selectedDatasets,
  onRemoveDataset,
  onBackToDiscover,
}: RecipeViewProps) {
  return (
    <div>
      <h1>Data Recipe</h1>
      <p className="lede">
        Your selected datasets, gathered in one place so you can explain how
        each one supports your question.
      </p>

      {submittedQuestion && (
        <section aria-labelledby="recipe-question-heading">
          <h2 id="recipe-question-heading">Question</h2>
          <p className="submitted-question">
            <q>{submittedQuestion}</q>
          </p>
        </section>
      )}

      <section aria-labelledby="recipe-selection-heading">
        <h2 id="recipe-selection-heading">
          Selected datasets ({selectedDatasets.length})
        </h2>

        {selectedDatasets.length === 0 ? (
          <div className="notice">
            <p>
              Nothing selected yet. Go to Discover, run one of the example
              questions, and tick the datasets you want to keep.
            </p>
            <button
              type="button"
              className="secondary"
              onClick={onBackToDiscover}
            >
              Back to Discover
            </button>
          </div>
        ) : (
          <ul className="recipe-list">
            {selectedDatasets.map((dataset) => (
              <li key={dataset.id} className="recipe-item">
                <div>
                  <h3>{dataset.title}</h3>
                  <p className="dataset-meta">
                    <span>{dataset.source}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{dataset.purpose}</span>
                  </p>
                  <p>{dataset.usefulness}</p>
                </div>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => onRemoveDataset(dataset.id)}
                  aria-label={`Remove ${dataset.title} from selection`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recipe-next-heading">
        <h2 id="recipe-next-heading">What happens next</h2>
        <p>
          Live recipe generation will be connected in the next stage. It will
          turn your question and selection into a step-by-step plan. This demo
          does not generate a recipe or analysis yet.
        </p>
      </section>
    </div>
  )
}

export default RecipeView
