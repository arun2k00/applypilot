from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete
from starlette.background import BackgroundTask

from ..backup import BackupError, create_backup
from ..dependencies import Database, LocalHeader, require_local
from ..models import (
    Application,
    ApplicationEvent,
    Notification,
    ProfileRevision,
    ResumeSource,
    SavedAnswer,
)

router = APIRouter()


class DeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirmation: str


@router.get("/data/backup")
def export_workspace(request: Request):
    directory = TemporaryDirectory(prefix="applypilot-backup-")
    target = Path(directory.name) / "applypilot-backup.sqlite3"
    try:
        create_backup(request.app.state.config, target)
    except BackupError as error:
        directory.cleanup()
        raise HTTPException(422, str(error)) from None
    except BaseException:
        directory.cleanup()
        raise
    return FileResponse(
        target,
        filename="applypilot-backup.sqlite3",
        media_type="application/octet-stream",
        headers={"Cache-Control": "no-store"},
        background=BackgroundTask(directory.cleanup),
    )


@router.post("/data/delete")
def delete_personal_data(
    payload: DeleteRequest, database: Database, local_request: LocalHeader = None
):
    require_local(local_request, "data-delete")
    if payload.confirmation != "DELETE":
        raise HTTPException(422, "Type DELETE to confirm.")
    for model in (
        ApplicationEvent,
        Application,
        SavedAnswer,
        Notification,
        ProfileRevision,
        ResumeSource,
    ):
        database.execute(delete(model))
    database.commit()
    return {"status": "deleted"}
