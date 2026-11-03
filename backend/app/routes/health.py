"""Backend liveness probe. Never contacts the remote MCP service."""

from fastapi import APIRouter

from ..models import HealthResponse

router = APIRouter()


@router.get('/health', response_model=HealthResponse)
def read_health() -> HealthResponse:
    return HealthResponse()
