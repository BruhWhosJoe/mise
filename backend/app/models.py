"""Pydantic response models for the MetaFabric backend API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = 'ok'
    service: str = 'metafabric-backend'


class MCPToolInfo(BaseModel):
    name: str
    description: str | None = None
    input_schema: dict[str, Any] | None = None


class CatalogStatusResponse(BaseModel):
    mcp_url: str
    reachable: bool
    tools: list[MCPToolInfo] = Field(default_factory=list)
    error: str | None = None


class CatalogRecord(BaseModel):
    """One normalized catalog record.

    ``raw`` preserves the server's original metadata untouched.
    Mapped fields stay ``None`` when the server did not supply them.
    """

    assigned_id: str | None = None
    title: str | None = None
    description: str | None = None
    summary: str | None = None
    source: str | None = None
    portal_name: str | None = None
    organization_name: str | None = None
    item_type: str | None = None
    tags: list[str] | None = None
    access_url: str | None = None
    service_endpoint_url: str | None = None
    download_url: str | None = None
    update_date: str | None = None
    modified_date: str | None = None
    temporal_range: str | None = None
    use_limitations: str | None = None
    access_constraints: str | None = None
    layer_names: list[str] | None = None
    coordinate_system: str | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


class CatalogPreviewResponse(BaseModel):
    records: list[CatalogRecord] = Field(default_factory=list)
    offset: int
    limit: int
    returned: int
    has_more: bool | None = None
    next_offset: int | None = None
    total_records: int | None = None


class DatasetDetailResponse(BaseModel):
    assigned_id: str
    record: CatalogRecord


class CatalogSearchResponse(BaseModel):
    """Title/ID matches over the bounded cached snapshot (never live-paged).

    ``searched_records`` is how many cached records were considered, so
    clients can label coverage honestly (complete vs. partial snapshot).
    """

    query: str
    records: list[CatalogRecord] = Field(default_factory=list)
    returned: int
    searched_records: int
    catalog_total: int | None = None
    retrieval_complete: bool = False
    retrieval_notes: list[str] = Field(default_factory=list)
    limit_applied: bool = False


class DiscoveryRequest(BaseModel):
    question: str


class Interpretation(BaseModel):
    goal: str
    assumptions: list[str] = Field(default_factory=list)


class Recommendation(BaseModel):
    record: CatalogRecord
    relevance: str
    relevance_score: int = Field(ge=0, le=100)
    why: str
    limitations: list[str] = Field(default_factory=list)


class DiscoveryCoverage(BaseModel):
    retrieval_method: str = 'lexical'
    retrieval_note: str = ''
    catalog_total: int | None = None
    records_retrieved: int = 0
    retrieval_complete: bool = False
    retrieval_notes: list[str] = Field(default_factory=list)
    candidates_evaluated: int = 0
    candidates_excluded_no_id: int = 0
    model_dropped_unknown_ids: int = 0
    model_duplicates_removed: int = 0
    result_cap: int = 0
    cap_applied: bool = False
    expanded_terms: list[str] = Field(default_factory=list)
    expansion_fallback: bool = False


class DiscoveryResponse(BaseModel):
    question: str
    interpretation: Interpretation
    recommendations: list[Recommendation] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    coverage: DiscoveryCoverage
    partial: bool = False
    partial_reason: str | None = None


class RecipeRequest(BaseModel):
    question: str
    dataset_ids: list[str]


class RecipeDatasetRef(BaseModel):
    assigned_id: str
    title: str | None = None
    organization_name: str | None = None
    portal_name: str | None = None
    access_url: str | None = None
    service_endpoint_url: str | None = None
    download_url: str | None = None


class RecipeContribution(BaseModel):
    assigned_id: str
    contribution: str


class RecipeStep(BaseModel):
    step: int
    title: str
    detail: str
    dataset_ids: list[str] = Field(default_factory=list)


class RecipeCombination(BaseModel):
    dataset_ids: list[str] = Field(default_factory=list)
    approach: str
    prerequisites: str
    uncertainty: str


class ChatHistoryItem(BaseModel):
    role: str
    text: str


class ChatFilters(BaseModel):
    min_score: int = 85
    sort: str = 'score-desc'
    show_all: bool = False


class ChatRecommendationContext(BaseModel):
    """One visible ranked recommendation, as the client currently shows it.

    The chat service reasons over this client-supplied context only and
    never refetches the catalog per message.
    """

    assigned_id: str
    title: str | None = None
    relevance: str = ''
    relevance_score: int = 0
    why: str = ''
    limitations: list[str] = Field(default_factory=list)
    organization_name: str | None = None
    portal_name: str | None = None
    modified_date: str | None = None
    update_date: str | None = None
    temporal_range: str | None = None


class ChatRequest(BaseModel):
    message: str
    investigation_id: str
    request_id: int = 0
    question: str | None = None
    recommendations: list[ChatRecommendationContext] = Field(
        default_factory=list
    )
    selected_ids: list[str] = Field(default_factory=list)
    filters: ChatFilters = Field(default_factory=ChatFilters)
    history: list[ChatHistoryItem] = Field(default_factory=list)


class ChatAction(BaseModel):
    """One backend-validated assistant action (typed, ID-checked)."""

    op: str
    assigned_ids: list[str] = Field(default_factory=list)
    count: int | None = None
    min_score: int | None = None
    sort: str | None = None


class ChatResponse(BaseModel):
    investigation_id: str
    request_id: int
    reply: str
    actions: list[ChatAction] = Field(default_factory=list)
    suggested_question: str | None = None
    change_summary: str | None = None


class RecipeCoverage(BaseModel):
    datasets_requested: int = 0
    datasets_resolved: int = 0
    metadata_complete: bool = False


class RecipeResponse(BaseModel):
    question: str
    dataset_ids: list[str] = Field(default_factory=list)
    datasets: list[RecipeDatasetRef] = Field(default_factory=list)
    objective: str
    contributions: list[RecipeContribution] = Field(default_factory=list)
    workflow: list[RecipeStep] = Field(default_factory=list)
    combinations: list[RecipeCombination] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    generated_at: str
    coverage: RecipeCoverage
