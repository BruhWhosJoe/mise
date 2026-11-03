import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { CatalogSearchResponse, LiveRecord } from '../services/api'
import {
  errorMessage,
  fetchCatalogSearch,
  fetchDatasetDetailCached,
} from '../services/api'
import { useWorkspace } from '../state/useWorkspace'
import { expandedKeyForRecord } from '../state/workspaceReducer'
import CopyLinkButton from './CopyLinkButton'
import { DatasetDetailSections, OpenSourceButton } from './DatasetDetails'
import LiveRecordCard from './LiveRecordCard'
import {
  authoritativeLinks,
  preferredShareLink,
} from '../utils/datasetLinks'

const PAGE_SIZES = [10, 25, 50] as const

function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

/** Compact window: first two, last two, and current ± 1, with ellipses. */
function pageWindow(
  current: number,
  total: number,
): (number | 'ellipsis-start' | 'ellipsis-end')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1)
  }
  const wanted = new Set(
    [1, 2, current - 1, current, current + 1, total - 1, total].filter(
      (page) => page >= 1 && page <= total,
    ),
  )
  const sorted = [...wanted].sort((a, b) => a - b)
  const windowed: (number | 'ellipsis-start' | 'ellipsis-end')[] = []
  let previous = 0
  for (const page of sorted) {
    if (page - previous > 1) {
      windowed.push(
        previous < current ? 'ellipsis-start' : 'ellipsis-end',
      )
    }
    windowed.push(page)
    previous = page
  }
  return windowed
}

function downloadReferences(selected: LiveRecord[]): void {
  const payload = {
    note: 'Dataset references exported from the Mise live catalog preview; not a generated recipe.',
    exported_at: new Date().toISOString(),
    count: selected.length,
    records: selected.map((record) => ({
      assigned_id: record.assigned_id,
      title: record.title,
      source_url: record.access_url,
      publisher:
        record.organization_name ??
        record.portal_name ??
        record.source,
    })),
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'mise-dataset-references.json'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

interface PaginationProps {
  idSuffix: string
  navLabel: string
  pageNum: number
  pageSize: number
  totalPages: number | null
  totalRecords: number | null
  rangeStart: number
  rangeEnd: number
  loading: boolean
  canNext: boolean
  capped: boolean
  knownOffsets: Record<number, number>
  onPage: (page: number) => void
  onSizeChange: (size: number) => void
}

function Pagination({
  idSuffix,
  navLabel,
  pageNum,
  pageSize,
  totalPages,
  totalRecords,
  rangeStart,
  rangeEnd,
  loading,
  canNext,
  capped,
  knownOffsets,
  onPage,
  onSizeChange,
}: PaginationProps) {
  const sizeId = `page-size-${idSuffix}`
  return (
    <div className="pagination-block">
      <p className="pagination-range">
        {totalRecords !== null
          ? `Showing ${rangeStart}–${rangeEnd} of ${formatCount(totalRecords)} datasets`
          : `Showing ${rangeStart}–${rangeEnd}`}
        {totalPages !== null ? ` — Page ${pageNum} of ${totalPages}` : ''}
      </p>
      <nav className="pagination" aria-label={navLabel}>
        <span className="page-size">
          <label htmlFor={sizeId}>Records per page</label>
          <select
            id={sizeId}
            value={pageSize}
            disabled={loading}
            onChange={(event) => onSizeChange(Number(event.target.value))}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </span>
        <button
          type="button"
          className="secondary small"
          disabled={loading || pageNum <= 1}
          onClick={() => onPage(pageNum - 1)}
        >
          Previous
        </button>
        {totalPages !== null &&
          pageWindow(pageNum, totalPages).map((entry, index) =>
            typeof entry === 'number' ? (
              <button
                key={entry}
                type="button"
                className={
                  entry === pageNum
                    ? 'secondary small page-current'
                    : 'secondary small'
                }
                aria-label={`Go to page ${entry}`}
                aria-current={entry === pageNum ? 'page' : undefined}
                disabled={
                  loading ||
                  entry === pageNum ||
                  (capped && knownOffsets[entry] === undefined)
                }
                onClick={() => onPage(entry)}
              >
                {entry}
              </button>
            ) : (
              <span
                key={`${entry}-${index}`}
                className="page-ellipsis"
                aria-hidden="true"
              >
                …
              </span>
            ),
          )}
        <button
          type="button"
          className="secondary small"
          disabled={!canNext}
          onClick={() => onPage(pageNum + 1)}
        >
          Next
        </button>
      </nav>
      {capped && (
        <p className="sample-note">
          The server returns smaller pages than requested, so only visited
          pages can be jumped to; Next and Previous always follow the
          server&apos;s exact position.
        </p>
      )}
    </div>
  )
}

/**
 * One dataset in the Review-selection collection: View details, Open, and
 * Copy like the cards, plus Remove. Full metadata loads only when the
 * reader opens details (cached per dataset), never per row.
 */
function CollectionItem({
  record,
  onRemove,
}: {
  record: LiveRecord
  onRemove: (record: LiveRecord) => void
}) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<LiveRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const links = authoritativeLinks(record)
  const title = record.title ?? 'Untitled record'
  const safeId = (record.assigned_id ?? title).replace(/[^a-zA-Z0-9_-]/g, '-')
  const detailId = `collection-detail-${safeId}`
  const canExpand = record.assigned_id !== null

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
    setOpen(next)
    if (next && detail === null && !loading) {
      void loadDetail()
    }
  }

  const shown = detail ?? record
  return (
    <li
      key={record.assigned_id ?? record.title ?? 'unknown'}
      className="recipe-item"
    >
      <div className="collection-main">
        <h3>{title}</h3>
        <p className="dataset-meta">
          {record.organization_name ??
            record.portal_name ??
            record.source ??
            'Source not provided'}
        </p>
        <div className="dataset-actions">
          <button
            type="button"
            className="secondary small"
            aria-expanded={open}
            aria-controls={detailId}
            disabled={!canExpand}
            title={canExpand ? undefined : 'Details need a dataset ID'}
            onClick={handleToggleOpen}
          >
            {open ? 'Hide details' : 'View details'}
          </button>
          {links.sourcePage ? (
            <OpenSourceButton href={links.sourcePage} />
          ) : (
            <span className="not-provided">Source link not provided</span>
          )}
          <CopyLinkButton
            url={preferredShareLink(links)}
            itemLabel={title}
          />
          <button
            type="button"
            className="secondary small"
            onClick={() => onRemove(record)}
            aria-label={`Remove ${title} from your dataset collection`}
          >
            Remove
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
      </div>
    </li>
  )
}

function LiveCatalog() {
  const {
    state,
    setView,
    toggleLive,
    selectPage,
    clearSelection,
    loadCatalogPage,
    setCatalogSize,
  } = useWorkspace()
  const catalog = state.catalog
  const liveSelected = state.liveSelected
  const [reviewing, setReviewing] = useState(false)
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null)
  // Whole-catalog title/ID search (server-side over the cached snapshot —
  // never just the visible page). Local to this view; paging resumes
  // untouched when the search is cleared.
  const [searchInput, setSearchInput] = useState('')
  const [catalogSearch, setCatalogSearch] =
    useState<CatalogSearchResponse | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const searchSeqRef = useRef(0)

  useEffect(
    () => () => {
      searchAbortRef.current?.abort()
    },
    [],
  )

  const page = catalog.page
  const pageNum = catalog.pageNum
  const pageSize = catalog.pageSize
  const catalogLoading = catalog.loading
  const catalogError = catalog.error

  // Page data lives in the store, so this only fetches when there is nothing
  // to show (first visit, reload, or a fresh investigation) — navigating
  // between views never refetches.
  useEffect(() => {
    if (page === null && !catalogLoading && catalogError === null) {
      loadCatalogPage(pageNum, pageSize)
    }
  }, [page, catalogLoading, catalogError, pageNum, pageSize, loadCatalogPage])

  function handleRetry() {
    loadCatalogPage(pageNum, pageSize, catalog.offsets, true)
  }

  function runCatalogSearch(rawQuery: string) {
    const query = rawQuery.trim()
    if (query === '' || searching) return
    searchAbortRef.current?.abort()
    const controller = new AbortController()
    searchAbortRef.current = controller
    const seq = searchSeqRef.current + 1
    searchSeqRef.current = seq
    setSearching(true)
    setSearchError(null)
    void (async () => {
      try {
        const found = await fetchCatalogSearch(query, 20, {
          signal: controller.signal,
        })
        if (searchSeqRef.current !== seq) return
        setCatalogSearch(found)
      } catch (error) {
        if (searchSeqRef.current !== seq) return
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        if (controller.signal.aborted) return
        setSearchError(errorMessage(error))
      } finally {
        if (searchSeqRef.current === seq) setSearching(false)
        if (searchAbortRef.current === controller) {
          searchAbortRef.current = null
        }
      }
    })()
  }

  function handleCatalogSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    runCatalogSearch(searchInput)
  }

  function handleClearCatalogSearch() {
    searchAbortRef.current?.abort()
    searchAbortRef.current = null
    searchSeqRef.current += 1
    setCatalogSearch(null)
    setSearchError(null)
    setSearching(false)
    setSearchInput('')
  }

  function handlePage(target: number) {
    const total = page?.total_records ?? null
    const clamped =
      total !== null
        ? Math.min(target, Math.max(1, Math.ceil(total / pageSize)))
        : target
    if (clamped === pageNum || clamped < 1) return
    loadCatalogPage(clamped, pageSize, catalog.offsets, false)
  }

  function handleReviewToggle() {
    const next = !reviewing
    setReviewing(next)
    if (next) {
      requestAnimationFrame(() => {
        reviewHeadingRef.current?.scrollIntoView({ block: 'nearest' })
        reviewHeadingRef.current?.focus()
      })
    }
  }

  const status = catalog.status
  const loading = catalog.loading
  const error = catalog.error
  const showSearch = catalogSearch !== null
  const totalRecords = page?.total_records ?? null
  const totalPages =
    totalRecords !== null
      ? Math.max(1, Math.ceil(totalRecords / pageSize))
      : null
  const canNext =
    page !== null &&
    !loading &&
    (page.has_more === true ||
      (page.has_more === null &&
        (totalPages !== null
          ? pageNum < totalPages
          : page.returned >= pageSize)))
  const offset = catalog.offsets[pageNum] ?? (pageNum - 1) * pageSize
  const rangeStart = page === null || page.returned === 0 ? 0 : offset + 1
  const rangeEnd = offset + (page?.returned ?? 0)
  const selectableOnPage =
    page?.records.filter((record) => record.assigned_id !== null) ?? []
  const pagination = (idSuffix: string, navLabel: string) => (
    <Pagination
      idSuffix={idSuffix}
      navLabel={navLabel}
      pageNum={pageNum}
      pageSize={pageSize}
      totalPages={totalPages}
      totalRecords={totalRecords}
      rangeStart={rangeStart}
      rangeEnd={rangeEnd}
      loading={loading}
      canNext={canNext}
      capped={catalog.capped}
      knownOffsets={catalog.offsets}
      onPage={handlePage}
      onSizeChange={setCatalogSize}
    />
  )

  return (
    <div>
      <h1>Browse the catalog</h1>
      <p className="lede">
        Real records from the metadata catalog, shown in catalog order. These
        are not AI-ranked matches to your question — relevance ranking lives
        in AI Discovery.
      </p>

      {status && (
        <p className="sample-note" role="status">
          {status.reachable
            ? `Connected to the catalog (${status.tools.length} tools available).`
            : `The catalog service is unreachable: ${status.error ?? 'unknown error'}`}
        </p>
      )}

      <form className="catalog-search" onSubmit={handleCatalogSearch}>
        <label htmlFor="catalog-search-input">Search the catalog</label>
        <div className="catalog-search-row">
          <input
            id="catalog-search-input"
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Title words or an exact dataset ID"
            autoComplete="off"
            disabled={searching}
          />
          <button
            type="submit"
            disabled={searching || searchInput.trim() === ''}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
          {(catalogSearch !== null || searchError !== null) && (
            <button
              type="button"
              className="secondary"
              onClick={handleClearCatalogSearch}
            >
              Clear search
            </button>
          )}
        </div>
        <p className="sample-note">
          Searches titles across the whole cached catalog, not just this
          page; an exact dataset ID jumps straight to it.
        </p>
      </form>

      {searching && <p aria-live="polite">Searching the catalog…</p>}

      {searchError !== null && !searching && (
        <div className="notice" role="alert">
          <p>{searchError}</p>
          <button
            type="button"
            className="secondary"
            disabled={searchInput.trim() === ''}
            onClick={() => runCatalogSearch(searchInput)}
          >
            Retry search
          </button>
        </div>
      )}

      <div className="live-selection-bar" aria-live="polite">
        <p>
          {liveSelected.length === 0
            ? 'Your dataset collection is empty'
            : `Your dataset collection: ${liveSelected.length} dataset${liveSelected.length === 1 ? '' : 's'}`}
        </p>
        <div className="live-selection-actions">
          <button
            type="button"
            className="secondary small"
            disabled={loading || selectableOnPage.length === 0}
            onClick={() => selectPage(selectableOnPage, 'catalog')}
            title="Adds the records visible on this page"
          >
            Select this page ({selectableOnPage.length})
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={liveSelected.length === 0}
            onClick={clearSelection}
          >
            Clear selection
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={liveSelected.length === 0}
            aria-expanded={reviewing}
            onClick={handleReviewToggle}
          >
            {reviewing ? 'Hide review' : 'Review selection'}
          </button>
        </div>
      </div>

      {showSearch && catalogSearch && (
        <section aria-labelledby="catalog-search-heading" aria-live="polite" className="panel">
          <h2 id="catalog-search-heading">Catalog search results</h2>
          <p role="status">
            {catalogSearch.returned} match
            {catalogSearch.returned === 1 ? '' : 'es'} for{' '}
            <q>{catalogSearch.query}</q> across{' '}
            {catalogSearch.searched_records.toLocaleString('en-US')} cached
            catalog records
            {catalogSearch.catalog_total !== null &&
              ` (catalog total ${catalogSearch.catalog_total.toLocaleString('en-US')})`}
            {catalogSearch.retrieval_complete ? '' : ' — partial snapshot'}
            {catalogSearch.limit_applied ? '; showing the first matches' : ''}.
          </p>
          {catalogSearch.records.length === 0 ? (
            <div className="notice">
              <p>
                No catalog titles match this search. Try fewer words, or an
                exact dataset ID.
              </p>
            </div>
          ) : (
            <ul className="dataset-list">
              {catalogSearch.records.map((record, index) => (
                <LiveRecordCard
                  key={
                    record.assigned_id ?? `search-${index}-${record.title}`
                  }
                  record={record}
                  selected={
                    record.assigned_id !== null &&
                    liveSelected.some(
                      (item) => item.assigned_id === record.assigned_id,
                    )
                  }
                  onToggle={(toggled) => toggleLive(toggled, 'catalog')}
                  expandedKey={expandedKeyForRecord(
                    record,
                    `catalog-search-${index}`,
                  )}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {!showSearch && loading && page === null && (
        <p aria-live="polite">Loading live catalog records…</p>
      )}

      {!showSearch && error && (
        <div className="notice" role="alert">
          <p>{error}</p>
          <p>
            Only live catalog data is shown here: there is no offline fallback
            for this view.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={handleRetry}
          >
            Retry
          </button>
        </div>
      )}

      {!showSearch && !error && page !== null && page.records.length === 0 && (
        <div className="notice">
          <p>No catalog records were returned for this page.</p>
        </div>
      )}

      {!showSearch && !error && page !== null && page.records.length > 0 && (
        <section aria-labelledby="live-results-heading" aria-live="polite" className="panel">
          <h2 id="live-results-heading">Catalog records</h2>
          {pagination('top', 'Catalog pages, top')}
          <ul className="dataset-list">
            {page.records.map((record, index) => (
              <LiveRecordCard
                key={record.assigned_id ?? `index-${offset + index}`}
                record={record}
                selected={
                  record.assigned_id !== null &&
                  liveSelected.some(
                    (item) => item.assigned_id === record.assigned_id,
                  )
                }
                onToggle={(toggled) => toggleLive(toggled, 'catalog')}
                expandedKey={expandedKeyForRecord(
                  record,
                  `catalog-${offset + index}`,
                )}
              />
            ))}
          </ul>
          {pagination('bottom', 'Catalog pages, bottom')}
        </section>
      )}

      {reviewing && liveSelected.length > 0 && (
        <section aria-labelledby="live-selection-heading" className="panel">
          <h2 id="live-selection-heading" ref={reviewHeadingRef} tabIndex={-1}>
            Your dataset collection ({liveSelected.length})
          </h2>
          <p className="sample-note">
            These records travel with your investigation. Turn them into a
            generated analysis plan in Data Recipe.
          </p>
          <ul className="recipe-list">
            {liveSelected.map((record) => (
              <CollectionItem
                key={record.assigned_id ?? record.title ?? 'unknown'}
                record={record}
                onRemove={(toggled) => toggleLive(toggled, 'catalog')}
              />
            ))}
          </ul>
          <div className="review-actions">
            <button type="button" onClick={() => setView('recipe')}>
              Continue to Data Recipe
            </button>
          </div>
          <div className="review-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => downloadReferences(liveSelected)}
            >
              Download references (JSON)
            </button>
            <p className="sample-note">
              Downloads dataset references (IDs, titles, source URLs), not a
              generated recipe.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}

export default LiveCatalog
