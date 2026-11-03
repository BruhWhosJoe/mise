import { useState } from 'react'
import type { LiveRecord } from '../services/api'
import { errorMessage, fetchDatasetDetailCached } from '../services/api'
import { useWorkspace } from '../state/useWorkspace'
import {
  authoritativeLinks,
  preferredShareLink,
} from '../utils/datasetLinks'
import { formatRecordDate } from '../utils/dates'
import CopyLinkButton from './CopyLinkButton'
import { DatasetDetailSections, ExternalLink } from './DatasetDetails'

const OVERVIEW_CLAMP_CHARS = 160
const SHOWN_TAGS = 4

export interface RecommendationNote {
  relevance: string
  /** AI-assessed score 0-100. Absent on unscored rows, which show no number. */
  relevance_score?: number
  why: string
  limitations: string[]
}

interface LiveRecordCardProps {
  record: LiveRecord
  selected: boolean
  onToggle: (record: LiveRecord) => void
  /** Stable key for the persisted expanded-details state. */
  expandedKey: string
  annotation?: RecommendationNote
}

/**
 * Card-level actions shared by discovery and catalog cards: open the source
 * page in a new tab and copy the best available link. Uses only the URLs the
 * record already carries — rendering cards never fires detail requests.
 */
export function DatasetCardLinks({ record }: { record: LiveRecord }) {
  const links = authoritativeLinks(record)
  const title = record.title ?? 'this dataset'
  return (
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
  )
}

function LiveRecordCard({
  record,
  selected,
  onToggle,
  expandedKey,
  annotation,
}: LiveRecordCardProps) {
  const { state, toggleExpanded } = useWorkspace()
  const open = state.catalog.expanded.includes(expandedKey)
  const [detail, setDetail] = useState<LiveRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [overviewExpanded, setOverviewExpanded] = useState(false)

  const cardId = record.assigned_id ?? `record-${record.title ?? 'untitled'}`
  const safeId = cardId.replace(/[^a-zA-Z0-9_-]/g, '-')
  const detailId = `live-detail-${safeId}`
  const overviewId = `live-overview-${safeId}`
  const selectable = record.assigned_id !== null

  async function loadDetail() {
    if (record.assigned_id === null) return
    setLoading(true)
    setLoadError(null)
    try {
      setDetail(await fetchDatasetDetailCached(record.assigned_id))
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  function handleToggleOpen() {
    const next = !open
    toggleExpanded(expandedKey)
    if (next && detail === null && !loading) {
      void loadDetail()
    }
  }

  const overview = record.summary ?? record.description
  const overviewClamped =
    overview !== null && overview.length > OVERVIEW_CLAMP_CHARS
  const dateLabel = record.modified_date
    ? 'Record modified'
    : record.update_date
      ? 'Record updated'
      : null
  const dateExact = record.modified_date ?? record.update_date
  const dateShown = formatRecordDate(dateExact)
  const score =
    annotation !== undefined &&
    typeof annotation.relevance_score === 'number' &&
    Number.isFinite(annotation.relevance_score)
      ? Math.round(annotation.relevance_score)
      : null
  const shownTags = record.tags?.slice(0, SHOWN_TAGS) ?? []
  const hiddenTagCount = (record.tags?.length ?? 0) - shownTags.length
  const shown = detail ?? record

  return (
    <li className={selected ? 'dataset-card is-selected' : 'dataset-card'}>
      <article aria-labelledby={`${safeId}-title`}>
        <div className="card-header">
          <h4 id={`${safeId}-title`}>{record.title ?? 'Untitled record'}</h4>
          {annotation && (
            <div className="card-badges">
              <span
                className={
                  annotation.relevance === 'direct'
                    ? 'relevance-chip'
                    : 'relevance-chip supporting'
                }
              >
                {annotation.relevance === 'direct'
                  ? 'Direct match'
                  : annotation.relevance === 'supporting'
                    ? 'Supporting'
                    : annotation.relevance}
              </span>
              {score !== null ? (
                <span className="score-badge">
                  <span className="score-badge-number">{score}</span>
                  <span className="score-badge-label">
                    AI relevance /100
                  </span>
                </span>
              ) : (
                <span className="score-badge unscored">Unscored</span>
              )}
            </div>
          )}
        </div>
        <dl className="card-facts">
          {record.organization_name && (
            <div>
              <dt>Publisher</dt>
              <dd>{record.organization_name}</dd>
            </div>
          )}
          {record.portal_name && (
            <div>
              <dt>Portal</dt>
              <dd>{record.portal_name}</dd>
            </div>
          )}
          {record.item_type && (
            <div>
              <dt>Type</dt>
              <dd>{record.item_type}</dd>
            </div>
          )}
          {dateLabel && (
            <div>
              <dt>{dateLabel}</dt>
              <dd title={dateShown !== dateExact ? (dateExact ?? undefined) : undefined}>
                {dateShown ?? dateExact}
              </dd>
            </div>
          )}
        </dl>
        {overview && (
          <div className="overview-block">
            <p
              id={overviewId}
              className={
                overviewClamped && !overviewExpanded
                  ? 'overview overview-clamped'
                  : 'overview'
              }
            >
              {overview}
            </p>
            {overviewClamped && (
              <button
                type="button"
                className="link-button"
                aria-expanded={overviewExpanded}
                aria-controls={overviewId}
                onClick={() => setOverviewExpanded((value) => !value)}
              >
                {overviewExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
        {shownTags.length > 0 && (
          <ul className="tag-list" aria-label="Topics">
            {shownTags.map((tag) => (
              <li key={tag} className="tag-chip">
                {tag}
              </li>
            ))}
            {hiddenTagCount > 0 && (
              <li className="tag-more" aria-label={`${hiddenTagCount} more topics`}>
                +{hiddenTagCount} more
              </li>
            )}
          </ul>
        )}
        <p className="dataset-meta">
          {record.assigned_id
            ? `ID: ${record.assigned_id}`
            : 'ID not provided'}
        </p>

        {annotation && (
          <div className="recommendation-note">
            <h5>Why this dataset</h5>
            {annotation.why.trim() !== '' ? (
              <p>{annotation.why}</p>
            ) : (
              <p className="not-provided">
                The model did not provide an explanation.
              </p>
            )}
            {annotation.limitations.length > 0 && (
              <>
                <h5 className="limitations-heading">Limitations</h5>
                <ul>
                  {annotation.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="dataset-actions">
          <button
            type="button"
            className={selected ? 'secondary small' : 'small'}
            aria-pressed={selected}
            disabled={!selectable}
            title={
              selectable
                ? undefined
                : 'A dataset ID is needed to add it to the recipe'
            }
            onClick={() => onToggle(record)}
          >
            {!selectable
              ? 'Not selectable (no ID)'
              : selected
                ? 'Added to recipe'
                : 'Add to recipe'}
          </button>
          <DatasetCardLinks record={record} />
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
            {!loading && !loadError && (
              <DatasetDetailSections record={shown} />
            )}
          </div>
        )}
      </article>
    </li>
  )
}

export default LiveRecordCard
