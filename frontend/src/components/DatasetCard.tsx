import { useState } from 'react'
import type { SampleDataset } from '../types'

interface DatasetCardProps {
  dataset: SampleDataset
  selected: boolean
  onToggle: (id: string) => void
}

function DatasetCard({ dataset, selected, onToggle }: DatasetCardProps) {
  const [expanded, setExpanded] = useState(false)
  const checkboxId = `select-${dataset.id}`
  const detailsId = `details-${dataset.id}`

  return (
    <li className="dataset-card">
      <article aria-labelledby={`${dataset.id}-title`}>
        <h4 id={`${dataset.id}-title`}>{dataset.title}</h4>
        <p className="dataset-meta">
          <span>{dataset.source}</span>
          <span aria-hidden="true"> · </span>
          <span>{dataset.purpose}</span>
        </p>
        <p>{dataset.usefulness}</p>

        <div className="dataset-actions">
          <div className="checkbox-row">
            <input
              type="checkbox"
              id={checkboxId}
              checked={selected}
              onChange={() => onToggle(dataset.id)}
            />
            <label htmlFor={checkboxId}>Add to selection</label>
          </div>
          <button
            type="button"
            className="secondary small"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
        </div>

        {expanded && (
          <div id={detailsId} className="dataset-details">
            <ul>
              {dataset.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </div>
        )}
      </article>
    </li>
  )
}

export default DatasetCard
