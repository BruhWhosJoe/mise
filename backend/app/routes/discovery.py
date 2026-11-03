"""AI discovery route: question -> recommended real datasets."""

from fastapi import APIRouter, HTTPException

from .. import discovery, mcp_service, model_client
from ..models import DiscoveryRequest, DiscoveryResponse

router = APIRouter()


def _detail(code: str, message: str) -> dict[str, str]:
    return {'code': code, 'message': message}


@router.post('/discovery/search', response_model=DiscoveryResponse)
async def post_discovery_search(body: DiscoveryRequest) -> DiscoveryResponse:
    try:
        return await discovery.run_discovery(body.question)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except model_client.ModelNotConfiguredError as exc:
        raise HTTPException(
            status_code=503, detail=_detail('ai_not_configured', str(exc))
        ) from exc
    except model_client.ModelAuthError as exc:
        raise HTTPException(
            status_code=502, detail=_detail('model_auth_failed', str(exc))
        ) from exc
    except model_client.ModelRateLimitError as exc:
        raise HTTPException(
            status_code=429, detail=_detail('model_rate_limited', str(exc))
        ) from exc
    except model_client.ModelTimeoutError as exc:
        raise HTTPException(
            status_code=504, detail=_detail('model_timeout', str(exc))
        ) from exc
    except model_client.ModelOutputError as exc:
        raise HTTPException(
            status_code=502, detail=_detail('model_output_invalid', str(exc))
        ) from exc
    except model_client.ModelUpstreamError as exc:
        raise HTTPException(
            status_code=502, detail=_detail('model_upstream', str(exc))
        ) from exc
    except model_client.ModelError as exc:
        raise HTTPException(
            status_code=502, detail=_detail('model_error', str(exc))
        ) from exc
    except mcp_service.MCPTimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc)) from exc
    except mcp_service.MCPUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except mcp_service.MCPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
