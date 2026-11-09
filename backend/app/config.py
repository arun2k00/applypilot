import os
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import URL


@dataclass(frozen=True)
class Config:
    data_dir: Path = field(
        default_factory=lambda: Path(os.getenv("APPLYPILOT_DATA_DIR", "../.local-data"))
    )
    database_url: str | None = field(
        default_factory=lambda: os.getenv("APPLYPILOT_DATABASE_URL") or None,
        repr=False,
    )

    scheduler_enabled: bool = field(
        default_factory=lambda: os.getenv("APPLYPILOT_SCHEDULER", "1") == "1"
    )

    @property
    def database(self) -> URL | str:
        if self.database_url:
            return self.database_url
        return URL.create("sqlite", database=str(self.data_dir.resolve() / "applypilot.sqlite3"))
