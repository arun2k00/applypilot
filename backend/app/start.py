"""Apply migrations before accepting local requests."""

import os
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config


def main() -> None:
    command.upgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "head")
    uvicorn.run(
        "app.main:app",
        host=os.getenv("APPLYPILOT_API_HOST", "127.0.0.1"),
        port=int(os.getenv("APPLYPILOT_API_PORT", "8000")),
        proxy_headers=False,
    )


if __name__ == "__main__":
    main()
