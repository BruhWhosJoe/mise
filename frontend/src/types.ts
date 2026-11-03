import type { DiscoveryResponse, RecipeResponse } from './services/api'

export type View = 'discover' | 'catalog' | 'recipe'

/**
 * Timing metadata for an async operation. The completed duration is stored
 * (not recomputed from a component timer) so navigation and reload never
 * show a fresh 0s timer for finished work.
 */
export interface TimedOperation {
  startedAt: number | null
  endedAt: number | null
  durationMs: number | null
  requestId: number
  interrupted: boolean
}

export interface AISearchState extends TimedOperation {
  // 'canceled' is a terminal user action, not a failure: the previous
  // result, duration, and selection stay intact.
  status: 'idle' | 'loading' | 'ready' | 'error' | 'canceled'
  question: string | null
  result: DiscoveryResponse | null
  error: string | null
}

export interface RecipeState extends TimedOperation {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: RecipeResponse | null
  question: string | null
  ids: string[]
  error: string | null
}

export type ScenarioId =
  | 'pedestrian-safety'
  | 'healthcare-access'
  | 'flood-exposure'

/** A fictional dataset record used only by the offline example fixtures. */
export interface SampleDataset {
  id: string
  title: string
  source: string
  purpose: string
  usefulness: string
  details: string[]
}

export interface ResultGroup {
  purpose: string
  datasets: SampleDataset[]
}

export interface ScenarioFixture {
  id: ScenarioId
  exampleQuestion: string
  groups: ResultGroup[]
}
