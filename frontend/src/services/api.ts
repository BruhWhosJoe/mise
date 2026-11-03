/** Typed client for the Mise backend API (same-origin `/api` URLs). */

export interface ApiHealth {
  status: string
  service: string
}

export interface MCPToolInfo {
  name: string
  description: string | null
  input_schema: Record<string, unknown> | null
}

export interface CatalogStatus {
  mcp_url: string
  reachable: boolean
  tools: MCPToolInfo[]
  error: string | null
}

export interface LiveRecord {
  assigned_id: string | null
  title: string | null
  description: string | null
  summary: string | null
  source: string | null
  portal_name: string | null
  organization_name: string | null
  item_type: string | null
  tags: string[] | null
  access_url: string | null
  service_endpoint_url: string | null
  download_url: string | null
  update_date: string | null
  modified_date: string | null
  temporal_range: string | null
  use_limitations: string | null
  access_constraints: string | null
  layer_names: string[] | null
  coordinate_system: string | null
  raw: Record<string, unknown>
}

export interface CatalogPreview {
  records: LiveRecord[]
  offset: number
  limit: number
  returned: number
  has_more: boolean | null
  next_offset: number | null
  total_records: number | null
}

export interface DatasetDetail {
  assigned_id: string
  record: LiveRecord
}

export interface CatalogSearchResponse {
  query: string
  records: LiveRecord[]
  returned: number
  searched_records: number
  catalog_total: number | null
  retrieval_complete: boolean
  retrieval_notes: string[]
  limit_applied: boolean
}

/** Must match the backend MF_RECIPE_MAX_DATASETS default (10). */
export const RECIPE_MAX_DATASETS = 10

export interface DiscoveryRecommendation {
  record: LiveRecord
  relevance: string
  /** AI-assessed fit, integer 0-100. Always set by the backend. */
  relevance_score: number
  why: string
  limitations: string[]
}

export interface DiscoveryCoverage {
  retrieval_method: string
  retrieval_note: string
  catalog_total: number | null
  records_retrieved: number
  retrieval_complete: boolean
  retrieval_notes: string[]
  candidates_evaluated: number
  candidates_excluded_no_id: number
  model_dropped_unknown_ids: number
  model_duplicates_removed: number
  result_cap: number
  cap_applied: boolean
  top_candidates: string[]
}

export interface DiscoveryResponse {
  question: string
  interpretation: { goal: string; assumptions: string[] }
  recommendations: DiscoveryRecommendation[]
  gaps: string[]
  coverage: DiscoveryCoverage
  partial: boolean
  partial_reason: string | null
}

export interface RecipeDatasetRef {
  assigned_id: string
  title: string | null
  organization_name: string | null
  portal_name: string | null
  access_url: string | null
  /** Authoritative catalog URLs, resolved by the backend at generation time. */
  service_endpoint_url: string | null
  download_url: string | null
}

export interface RecipeStep {
  step: number
  title: string
  detail: string
  dataset_ids: string[]
}

export interface RecipeCombination {
  dataset_ids: string[]
  approach: string
  prerequisites: string
  uncertainty: string
}

export interface RecipeResponse {
  question: string
  dataset_ids: string[]
  datasets: RecipeDatasetRef[]
  objective: string
  contributions: { assigned_id: string; contribution: string }[]
  workflow: RecipeStep[]
  combinations: RecipeCombination[]
  gaps: string[]
  limitations: string[]
  outputs: string[]
  generated_at: string
  coverage: {
    datasets_requested: number
    datasets_resolved: number
    metadata_complete: boolean
  }
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function detailMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('detail' in value)) return null
  const detail = (value as Record<string, unknown>).detail
  if (typeof detail === 'string') return detail
  if (typeof detail !== 'object' || detail === null) return null
  const message = (detail as Record<string, unknown>).message
  return typeof message === 'string' ? message : null
}

async function readDetail(response: Response): Promise<string> {
  try {
    const message = detailMessage(await response.json())
    if (message) return message
  } catch {
    // Fall through to the generic message below.
  }
  return `Request failed (HTTP ${response.status})`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ApiError(
      0,
      'Could not reach the Mise backend. Start it on port 8001 and retry.',
    )
  }
  if (!response.ok) {
    throw new ApiError(response.status, await readDetail(response))
  }
  return (await response.json()) as T
}

async function postJson<T>(
  path: string,
  body: unknown,
  options?: FetchOptions,
): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
  })
}

export interface FetchOptions {
  signal?: AbortSignal
}

export function fetchHealth(): Promise<ApiHealth> {
  return request<ApiHealth>('/api/health')
}

export function fetchCatalogStatus(
  options?: FetchOptions,
): Promise<CatalogStatus> {
  return request<CatalogStatus>('/api/catalog/status', {
    signal: options?.signal,
  })
}

export function fetchCatalogPreview(
  offset: number,
  limit: number,
  options?: FetchOptions,
): Promise<CatalogPreview> {
  return request<CatalogPreview>(
    `/api/catalog/preview?offset=${offset}&limit=${limit}`,
    { signal: options?.signal },
  )
}

export function fetchDatasetDetail(
  assignedId: string,
): Promise<DatasetDetail> {
  return request<DatasetDetail>(
    `/api/catalog/datasets/${encodeURIComponent(assignedId)}`,
  )
}

export function fetchCatalogSearch(
  query: string,
  limit = 20,
  options?: FetchOptions,
): Promise<CatalogSearchResponse> {
  return request<CatalogSearchResponse>(
    `/api/catalog/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { signal: options?.signal },
  )
}

export function fetchDiscoverySearch(
  question: string,
  options?: FetchOptions,
): Promise<DiscoveryResponse> {
  return postJson<DiscoveryResponse>(
    '/api/discovery/search',
    { question },
    options,
  )
}

export function fetchRecipeGenerate(
  question: string,
  datasetIds: string[],
  options?: FetchOptions,
): Promise<RecipeResponse> {
  return postJson<RecipeResponse>(
    '/api/recipe/generate',
    {
      question,
      dataset_ids: datasetIds,
    },
    options,
  )
}

export type ChatOp =
  | 'explain'
  | 'compare'
  | 'select_top'
  | 'add'
  | 'remove'
  | 'refine'
  | 'reset_filters'
  | 'undo'
  | 'suggest_question'
  | 'clarify'

export interface ChatAction {
  op: ChatOp
  assigned_ids: string[]
  count: number | null
  min_score: number | null
  sort: string | null
}

export interface ChatContextRecommendation {
  assigned_id: string
  title: string | null
  relevance: string
  relevance_score: number
  why: string
  limitations: string[]
  organization_name: string | null
  portal_name: string | null
  modified_date: string | null
  update_date: string | null
  temporal_range: string | null
}

export interface ChatRequestBody {
  message: string
  investigation_id: string
  request_id: number
  question: string | null
  recommendations: ChatContextRecommendation[]
  selected_ids: string[]
  filters: { min_score: number; sort: string; show_all: boolean }
  history: { role: 'user' | 'assistant'; text: string }[]
}

export interface ChatResponseBody {
  investigation_id: string
  request_id: number
  reply: string
  actions: ChatAction[]
  suggested_question: string | null
  change_summary: string | null
}

export function fetchChatMessage(
  body: ChatRequestBody,
  options?: FetchOptions,
): Promise<ChatResponseBody> {
  return postJson<ChatResponseBody>('/api/chat/message', body, options)
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return 'Something went wrong while loading the live catalog.'
}

/** Session cache of full detail records by AssignedID. Failures are never cached. */
const detailCache = new Map<string, LiveRecord>()

export async function fetchDatasetDetailCached(
  assignedId: string,
): Promise<LiveRecord> {
  const cached = detailCache.get(assignedId)
  if (cached) return cached
  const loaded = await fetchDatasetDetail(assignedId)
  detailCache.set(assignedId, loaded.record)
  return loaded.record
}

/** Extra frontend guard: only render http/https URLs as clickable links. */
export function isHttpUrl(value: string | null): value is string {
  return (
    value !== null && /^(https?):\/\/.+/i.test(value.trim())
  )
}
