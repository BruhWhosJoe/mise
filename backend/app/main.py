"""Mise backend: FastAPI app serving live catalog data via MCP."""

from fastapi import FastAPI

from .routes import catalog, chat, discovery, health, recipe


def create_app() -> FastAPI:
    app = FastAPI(title='Mise backend', version='0.2.0')
    app.include_router(health.router, prefix='/api', tags=['health'])
    app.include_router(catalog.router, prefix='/api', tags=['catalog'])
    app.include_router(discovery.router, prefix='/api', tags=['discovery'])
    app.include_router(recipe.router, prefix='/api', tags=['recipe'])
    app.include_router(chat.router, prefix='/api', tags=['chat'])
    return app


app = create_app()
