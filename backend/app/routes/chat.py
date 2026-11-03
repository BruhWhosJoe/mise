"""Assistant chat route: one turn over the current investigation."""

from fastapi import APIRouter, HTTPException

from .. import chat as chat_service
from .. import model_client
from ..models import ChatRequest, ChatResponse

router = APIRouter()


def _detail(code: str, message: str) -> dict[str, str]:
    return {'code': code, 'message': message}


@router.post('/chat/message', response_model=ChatResponse)
async def post_chat_message(body: ChatRequest) -> ChatResponse:
    try:
        return await chat_service.run_chat(body)
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
    except model_client.ModelBusyError as exc:
        raise HTTPException(
            status_code=429,
            detail=_detail('model_busy', str(exc)),
            headers={'Retry-After': '10'},
        ) from exc
    except model_client.ModelError as exc:
        raise HTTPException(
            status_code=502, detail=_detail('model_error', str(exc))
        ) from exc
