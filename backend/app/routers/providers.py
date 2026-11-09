from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..dependencies import Database, LocalHeader, require_local
from ..models import ProviderConfig, ProviderRoute, ProviderUsage
from ..providers import (
    TASKS,
    ProviderFailure,
    cipher,
    record_call,
    transport,
    validated_endpoint,
)

router = APIRouter()


class ProviderInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int | None = Field(default=None, gt=0)
    kind: Literal["openai", "anthropic", "gemini", "ollama", "compatible"]
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    model: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    endpoint: str = Field(default="", max_length=400)
    api_key: SecretStr | None = Field(default=None, max_length=4000)
    enabled: bool = True
    allow_candidate_data: bool = False
    json_mode: bool = False
    input_rate: float | None = Field(default=None, ge=0, le=10000)
    output_rate: float | None = Field(default=None, ge=0, le=10000)


class ProviderAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int = Field(gt=0)


class RoutingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task: str
    providers: list[int] = Field(max_length=5)


def public_provider(provider: ProviderConfig) -> dict:
    return {
        key: getattr(provider, key)
        for key in (
            "id",
            "kind",
            "label",
            "model",
            "endpoint",
            "enabled",
            "allow_candidate_data",
            "json_mode",
            "input_rate",
            "output_rate",
        )
    } | {"has_key": provider.credential is not None}


def find_provider(database: Database, provider_id: int) -> ProviderConfig:
    provider = database.get(ProviderConfig, provider_id)
    if not provider:
        raise HTTPException(404, "Provider not found.")
    return provider


@router.get("/providers")
def get_providers(database: Database):
    return {
        "providers": [
            public_provider(row)
            for row in database.scalars(
                select(ProviderConfig).order_by(ProviderConfig.id).limit(50)
            )
        ],
        "tasks": TASKS,
        "routes": {row.task: row.providers for row in database.scalars(select(ProviderRoute))},
        "usage": [
            {
                key: getattr(row, key)
                for key in (
                    "id",
                    "provider",
                    "task",
                    "model",
                    "status",
                    "input_tokens",
                    "output_tokens",
                    "estimated_usd",
                    "created_at",
                )
            }
            for row in database.scalars(
                select(ProviderUsage).order_by(ProviderUsage.id.desc()).limit(25)
            )
        ],
    }


@router.put("/providers")
def save_provider(
    payload: ProviderInput, request: Request, database: Database, local_request: LocalHeader = None
):
    require_local(local_request, "providers")
    provider = find_provider(database, payload.id) if payload.id else ProviderConfig()
    try:
        endpoint = validated_endpoint(payload.kind, payload.endpoint)
        scope_changed = bool(
            payload.id and (provider.kind, provider.endpoint) != (payload.kind, endpoint)
        )
        key = payload.api_key.get_secret_value().strip() if payload.api_key else ""
        if any(ord(char) < 33 or ord(char) > 126 for char in key):
            raise ProviderFailure("The key must contain printable ASCII characters.")
        if key:
            provider.credential = cipher(
                request.app.state.config.data_dir,
                create=True,
            ).encrypt(key.encode())
        elif scope_changed:
            provider.credential = None
        if payload.kind in {"openai", "anthropic", "gemini"} and not provider.credential:
            raise ProviderFailure("Enter an API key for this provider.")
    except ProviderFailure as error:
        raise HTTPException(422, str(error)) from None

    for field, value in payload.model_dump(exclude={"id", "api_key", "endpoint"}).items():
        setattr(provider, field, value)
    provider.endpoint = endpoint
    database.add(provider)
    try:
        database.commit()
    except IntegrityError:
        raise HTTPException(409, "A provider with that name already exists.") from None
    return public_provider(provider)


@router.post("/providers/check")
def check_provider(
    payload: ProviderAction, request: Request, database: Database, local_request: LocalHeader = None
):
    require_local(local_request, "provider-check")
    provider = find_provider(database, payload.id)
    if not provider.enabled:
        raise HTTPException(409, "Enable the provider before testing.")
    try:
        result = record_call(
            database,
            provider,
            "connectivity",
            "Reply briefly.",
            "This is an ApplyPilot connection test. Reply OK.",
            request.app.state.config.data_dir,
            budget=64,
        )
    except ProviderFailure as error:
        raise HTTPException(502, str(error)) from None
    return {
        "status": "connected",
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
    }


@router.post("/providers/models")
def discover_models(payload: ProviderAction, database: Database, local_request: LocalHeader = None):
    require_local(local_request, "provider-models")
    provider = find_provider(database, payload.id)
    if provider.kind != "ollama" or not provider.enabled:
        raise HTTPException(409, "Model discovery is available for enabled Ollama connections.")
    try:
        endpoint = validated_endpoint(provider.kind, provider.endpoint)
        result = transport(endpoint + "/api/tags", {})
    except ProviderFailure as error:
        raise HTTPException(502, str(error)) from None
    models = result.get("models", [])
    return {
        "models": [
            model["name"]
            for model in models[:100]
            if isinstance(model, dict) and isinstance(model.get("name"), str)
        ]
        if isinstance(models, list)
        else []
    }


@router.post("/providers/delete")
def delete_provider(payload: ProviderAction, database: Database, local_request: LocalHeader = None):
    require_local(local_request, "provider-delete")
    provider = find_provider(database, payload.id)
    for route in database.scalars(select(ProviderRoute)):
        if provider.id in route.providers:
            route.providers = [item for item in route.providers if item != provider.id]
    database.delete(provider)
    database.commit()
    return {"status": "deleted"}


@router.put("/providers/routes")
def set_route(payload: RoutingInput, database: Database, local_request: LocalHeader = None):
    require_local(local_request, "provider-routing")
    if payload.task not in TASKS or len(set(payload.providers)) != len(payload.providers):
        raise HTTPException(422, "Choose a valid task and distinct providers.")
    if any(not database.get(ProviderConfig, item) for item in payload.providers):
        raise HTTPException(404, "One of the selected providers no longer exists.")
    route = database.get(ProviderRoute, payload.task)
    if payload.providers:
        database.merge(ProviderRoute(task=payload.task, providers=payload.providers))
    elif route:
        database.delete(route)
    database.commit()
    return {"task": payload.task, "providers": payload.providers}
