from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session


def session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine) as database:
        yield database


Database = Annotated[Session, Depends(session)]
LocalHeader = Annotated[str | None, Header(alias="X-ApplyPilot-Local")]


def require_local(request: str | None, resource: str) -> None:
    if request != resource:
        raise HTTPException(403, "Local request header required.")


async def read_bounded(request: Request, limit: int) -> bytes:
    chunks = bytearray()
    async for chunk in request.stream():
        if len(chunks) + len(chunk) > limit:
            raise HTTPException(413, "This file exceeds the upload limit.")
        chunks.extend(chunk)
    return bytes(chunks)
