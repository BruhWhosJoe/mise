"""Data recipe route: question + selected IDs -> analysis plan."""

from fastapi import APIRouter, HTTPException

from .. import mcp_service, model_client, recipe
from ..models import RecipeRequest, RecipeResponse

router = APIRouter()


def _detail(code: str, message: str) -> dict[str, str]:
    return {'code': code, 'message': message}


@router.post('/recipe/generate', response_model=RecipeResponse)
async def post_recipe_generate(body: RecipeRequest) -> RecipeResponse:
    try:
        return await recipe.generate_recipe(body.question, body.dataset_ids)
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
