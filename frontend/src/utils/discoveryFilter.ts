import type { DiscoveryRecommendation } from '../services/api'

export const MIN_RELEVANCE = 0
export const MAX_RELEVANCE = 100
/** Inclusive "Strong matches" preset: recommendations scoring 85+ . */
export const DEFAULT_MIN_RELEVANCE = 85

export type DiscoverySort = 'score-desc' | 'score-asc' | 'title'

export const DISCOVERY_SORT_OPTIONS: {
  value: DiscoverySort
  label: string
}[] = [
  { value: 'score-desc', label: 'Highest relevance first' },
  { value: 'score-asc', label: 'Lowest relevance first' },
  { value: 'title', label: 'Title A to Z' },
]

export function isDiscoverySort(value: unknown): value is DiscoverySort {
  return (
    value === 'score-desc' || value === 'score-asc' || value === 'title'
  )
}

export function clampMinScore(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MIN_RELEVANCE
  return Math.min(
    MAX_RELEVANCE,
    Math.max(MIN_RELEVANCE, Math.round(value)),
  )
}

/** True only when the backend-supplied score is a usable number. */
export function scoredValue(
  item: DiscoveryRecommendation,
): number | null {
  const score = item.relevance_score
  return typeof score === 'number' && Number.isFinite(score) ? score : null
}

/** Recommendations whose score is missing or unusable (never fabricated). */
export function countUnscored(
  items: readonly DiscoveryRecommendation[],
): number {
  return items.filter((item) => scoredValue(item) === null).length
}

function matchesTag(
  item: DiscoveryRecommendation,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return (item.record.tags ?? []).some((tag) =>
    tag.toLowerCase().includes(needle),
  )
}

function matchesPublisher(
  item: DiscoveryRecommendation,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  const haystacks = [
    item.record.organization_name,
    item.record.portal_name,
    item.record.source,
  ]
  return haystacks.some(
    (value) => value !== null && value.toLowerCase().includes(needle),
  )
}

function matchesItemType(
  item: DiscoveryRecommendation,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  const value = item.record.item_type
  return value !== null && value.toLowerCase().includes(needle)
}

function matchesText(
  item: DiscoveryRecommendation,
  query: string,
): boolean {
  const trimmed = query.trim()
  if (trimmed === '') return true
  // An exact dataset ID always matches, even when the title differs.
  if (
    item.record.assigned_id !== null &&
    item.record.assigned_id === trimmed
  ) {
    return true
  }
  const title = item.record.title
  return (
    title !== null && title.toLowerCase().includes(trimmed.toLowerCase())
  )
}

/**
 * Filter to the visible recommendations. Every predicate narrows the
 * returned set only (AND-combined); the threshold is inclusive, and
 * `showAll` lifts the threshold while keeping the other predicates.
 * Never invents scores: unscored rows cannot satisfy a threshold.
 */
export function filterRecommendations(
  items: readonly DiscoveryRecommendation[],
  view: DiscoveryView,
): DiscoveryRecommendation[] {
  return items.filter((item) => {
    if (!matchesTag(item, view.tag)) return false
    if (!matchesPublisher(item, view.publisher)) return false
    if (!matchesItemType(item, view.itemType)) return false
    if (!matchesText(item, view.text)) return false
    if (view.showAll) return true
    const score = scoredValue(item)
    return score !== null && score >= view.minScore
  })
}

function compareTitle(
  a: DiscoveryRecommendation,
  b: DiscoveryRecommendation,
): number {
  const byTitle = (a.record.title ?? '').localeCompare(
    b.record.title ?? '',
  )
  if (byTitle !== 0) return byTitle
  return (a.record.assigned_id ?? '').localeCompare(
    b.record.assigned_id ?? '',
  )
}

/**
 * Sort a copy of the recommendations. Unscored rows sink below scored ones
 * in both score orders; ties break by title, then ID, for determinism.
 */
export function sortRecommendations(
  items: readonly DiscoveryRecommendation[],
  sort: DiscoverySort,
): DiscoveryRecommendation[] {
  const copy = [...items]
  if (sort === 'title') {
    copy.sort(compareTitle)
    return copy
  }
  copy.sort((a, b) => {
    const aScore = scoredValue(a)
    const bScore = scoredValue(b)
    if (aScore === null && bScore === null) return compareTitle(a, b)
    if (aScore === null) return 1
    if (bScore === null) return -1
    if (aScore !== bScore) {
      return sort === 'score-desc' ? bScore - aScore : aScore - bScore
    }
    return compareTitle(a, b)
  })
  return copy
}

export interface DiscoveryView {
  minScore: number
  sort: DiscoverySort
  showAll: boolean
  /** Case-insensitive substring over the record's tags. */
  tag: string
  /** Case-insensitive substring over publisher, portal, or source. */
  publisher: string
  /** Case-insensitive substring over the dataset type. */
  itemType: string
  /** Title substring, or an exact dataset ID. */
  text: string
}

/** Filter, then sort: the exact list the results section renders. */
export function visibleRecommendations(
  items: readonly DiscoveryRecommendation[],
  view: DiscoveryView,
): DiscoveryRecommendation[] {
  return sortRecommendations(filterRecommendations(items, view), view.sort)
}

/** Highest finite score in the set, for the "lower the threshold" offer. */
export function highestScore(
  items: readonly DiscoveryRecommendation[],
): number | null {
  let best: number | null = null
  for (const item of items) {
    const score = scoredValue(item)
    if (score !== null && (best === null || score > best)) {
      best = score
    }
  }
  return best
}
