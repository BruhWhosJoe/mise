"""Catalog routes: MCP status, record preview pages, search, details."""

from fastapi import APIRouter, HTTPException

from .. import catalog_cache, catalog_search, mcp_service, normalize
from ..config import PREVIEW_FIELDS, get_settings
from ..models import (
    CatalogPreviewResponse,
    CatalogSearchResponse,
    CatalogStatusResponse,
    DatasetDetailResponse,
)

router = APIRouter()


@router.get('/catalog/status', response_model=CatalogStatusResponse)
async def read_catalog_status() -> CatalogStatusResponse:
    """Check MCP connectivity and report discovered tool names/schemas.

    Always answers 200: ``reachable: false`` plus ``error`` distinguishes
    a sick remote service from a sick backend (see /api/health).
    """
    settings = get_settings()
    try:
        tools = await mcp_service.discover_tools()
    except mcp_service.MCPError as exc:
        return CatalogStatusResponse(
            mcp_url=settings.mcp_url, reachable=False, error=str(exc)
        )
    return CatalogStatusResponse(
        mcp_url=settings.mcp_url, reachable=True, tools=tools
    )


@router.get('/catalog/preview', response_model=CatalogPreviewResponse)
async def read_catalog_preview(
    offset: int | None = None, limit: int | None = None
) -> CatalogPreviewResponse:
    """Return one bounded page of real catalog records plus pagination info."""
    settings = get_settings()
    offset = 0 if offset is None else offset
    limit = settings.preview_default_limit if limit is None else limit
    if offset < 0:
        raise HTTPException(status_code=422, detail='offset must be >= 0')
    if limit < 1 or limit > settings.preview_max_limit:
        raise HTTPException(
            status_code=422,
            detail=f'limit must be between 1 and {settings.preview_max_limit}',
        )
    try:
        payload = await mcp_service.fetch_catalog_page(
            offset=offset, limit=limit, fields=list(PREVIEW_FIELDS)
        )
    except mcp_service.MCPTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except mcp_service.MCPUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except mcp_service.MCPToolError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except mcp_service.MCPMalformedError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except mcp_service.MCPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return normalize.normalize_preview(payload, offset=offset, limit=limit)


@router.get('/catalog/search', response_model=CatalogSearchResponse)
async def search_catalog(
    q: str | None = None, limit: int | None = None
) -> CatalogSearchResponse:
    """Search cached catalog titles, or match one exact dataset ID.

    Matches run over the bounded TTL-cached snapshot (the same retrieval
    discovery uses), never over just the browser's visible page. Coverage
    fields say exactly how much of the catalog was considered.
    """
    limit = catalog_search.DEFAULT_SEARCH_LIMIT if limit is None else limit
    if limit < 1 or limit > catalog_search.MAX_SEARCH_LIMIT:
        raise HTTPException(
            status_code=422,
            detail='limit must be between 1 and '
            f'{catalog_search.MAX_SEARCH_LIMIT}',
        )
    try:
        query = catalog_search.validate_query(q)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        snapshot = await catalog_cache.get_catalog_snapshot()
    except mcp_service.MCPTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except mcp_service.MCPUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except mcp_service.MCPToolError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except mcp_service.MCPMalformedError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except mcp_service.MCPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    result = catalog_search.match_records(snapshot.records, query, limit)
    return CatalogSearchResponse(
        query=query,
        records=result.matches,
        returned=len(result.matches),
        searched_records=result.searched_records,
        catalog_total=snapshot.catalog_total,
        retrieval_complete=snapshot.complete,
        retrieval_notes=list(snapshot.notes),
        limit_applied=result.limit_applied,
    )


@router.get('/catalog/datasets/{assigned_id}', response_model=DatasetDetailResponse)
async def read_dataset(assigned_id: str) -> DatasetDetailResponse:
    """Return full available metadata for one exact dataset ID."""
    if not assigned_id.strip() or len(assigned_id) > 500:
        raise HTTPException(status_code=422, detail='invalid dataset ID')
    try:
        # Explicit card fields (not server defaults): the detail surface
        # needs the same authoritative AccessURL/ServiceEndpointURL/
        # DownloadURL links the cards already carry.
        payload = await mcp_service.fetch_layer_metadata(
            [assigned_id], fields=list(PREVIEW_FIELDS)
        )
    except mcp_service.MCPTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except mcp_service.MCPUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except mcp_service.MCPToolError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except mcp_service.MCPMalformedError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except mcp_service.MCPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    for item in normalize.extract_records(payload):
        record = normalize.normalize_record(item)
        if record.assigned_id == assigned_id:
            return DatasetDetailResponse(
                assigned_id=assigned_id, record=record
            )
    raise HTTPException(
        status_code=404,
        detail=f'no dataset found for ID {assigned_id!r}',
    )
