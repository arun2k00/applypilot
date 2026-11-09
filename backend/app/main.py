import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Config
from .database import build_engine
from .dependencies import Database, LocalHeader, require_local
from .models import WorkspaceSettings
from .routers.applications import router as application_router
from .routers.automation import router as automation_router
from .routers.data import router as data_router
from .routers.jobs import router as job_router
from .routers.overview import router as overview_router
from .routers.profile import router as profile_router
from .routers.providers import router as provider_router
from .scheduler import loop
from .schemas import SettingsPayload


def create_app(config: Config | None = None) -> FastAPI:
    config = config or Config()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = build_engine(config)
        app.state.engine = engine
        app.state.config = config
        stop = asyncio.Event()
        scheduler = asyncio.create_task(loop(engine, stop)) if config.scheduler_enabled else None
        try:
            yield
        finally:
            stop.set()
            if scheduler:
                await scheduler
            engine.dispose()

    app = FastAPI(title="ApplyPilot", version="0.1.0", lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "backend"])

    app.include_router(overview_router, prefix="/api/v1")
    app.include_router(data_router, prefix="/api/v1")
    app.include_router(automation_router, prefix="/api/v1")
    app.include_router(application_router, prefix="/api/v1")
    app.include_router(job_router, prefix="/api/v1")
    app.include_router(profile_router, prefix="/api/v1")
    app.include_router(provider_router, prefix="/api/v1")

    def workspace(database: Session) -> WorkspaceSettings:
        settings = database.get(WorkspaceSettings, 1)
        if settings is None:
            raise HTTPException(503, "Workspace migration required.")
        return settings

    @app.exception_handler(SQLAlchemyError)
    async def database_error(_request: Request, _error: SQLAlchemyError) -> JSONResponse:
        return JSONResponse({"detail": "Local database unavailable."}, status_code=503)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, error: RequestValidationError) -> JSONResponse:
        errors = [
            {
                "loc": [
                    part for part in entry["loc"] if part in {"body", "workspace_name", "timezone"}
                ],
                "msg": entry["msg"],
                "type": entry["type"],
            }
            for entry in error.errors()
        ]
        return JSONResponse({"detail": errors}, status_code=422)

    @app.get("/health/live")
    def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready")
    def ready(database: Database) -> dict[str, str]:
        workspace(database)
        return {"status": "ready", "storage": "connected"}

    @app.get("/api/v1/settings")
    def get_settings(database: Database) -> SettingsPayload:
        return SettingsPayload.model_validate(workspace(database))

    @app.put("/api/v1/settings")
    def update_settings(
        payload: SettingsPayload,
        database: Database,
        local_request: LocalHeader = None,
    ) -> SettingsPayload:
        require_local(local_request, "settings")
        settings = workspace(database)
        settings.workspace_name = payload.workspace_name
        settings.timezone = payload.timezone
        database.commit()
        return payload

    return app


app = create_app()
