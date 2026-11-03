"""Mise backend: FastAPI app serving live catalog data via MCP.

On Render this is the only service: when a built frontend exists at
``frontend/dist`` it is served at ``/`` with SPA fallback, after the
``/api`` routers so API routes always take precedence. Locally
(``npm run dev``) no dist exists and the dev server owns the pages.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import catalog_cache
from .rate_limit import RateLimitMiddleware
from .routes import catalog, chat, discovery, health, recipe

logger = logging.getLogger(__name__)

DIST_DIR = Path(__file__).resolve().parent.parent.parent / 'frontend' / 'dist'


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    async def _warm() -> None:
        try:
            snapshot = await catalog_cache.get_catalog_snapshot()
        except Exception as exc:  # noqa: BLE001 - warmup must never fail boot
            logger.warning('catalog warmup failed: %s', type(exc).__name__)
        else:
            logger.info('catalog warmed: %d records', len(snapshot.records))

    task = asyncio.create_task(_warm())
    yield
    if not task.done():
        task.cancel()


def create_app() -> FastAPI:
    app = FastAPI(title='Mise backend', version='0.2.0', lifespan=_lifespan)
    app.add_middleware(RateLimitMiddleware)
    app.include_router(health.router, prefix='/api', tags=['health'])
    app.include_router(catalog.router, prefix='/api', tags=['catalog'])
    app.include_router(discovery.router, prefix='/api', tags=['discovery'])
    app.include_router(recipe.router, prefix='/api', tags=['recipe'])
    app.include_router(chat.router, prefix='/api', tags=['chat'])
    _mount_frontend(app)
    return app


def _mount_frontend(app: FastAPI) -> None:
    """Serve the built SPA with fallback; unknown /api/* stays a 404."""
    if not DIST_DIR.is_dir():
        return
    assets = DIST_DIR / 'assets'
    if assets.is_dir():
        app.mount('/assets', StaticFiles(directory=assets), name='frontend-assets')

    @app.get('/', include_in_schema=False)
    async def _index() -> FileResponse:
        return FileResponse(DIST_DIR / 'index.html')

    @app.get('/{path:path}', include_in_schema=False)
    async def _spa(path: str) -> FileResponse:
        if path.startswith('api/'):
            raise HTTPException(status_code=404)
        root = DIST_DIR.resolve()
        candidate = (DIST_DIR / path).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            raise HTTPException(status_code=404) from None
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(root / 'index.html')


app = create_app()
