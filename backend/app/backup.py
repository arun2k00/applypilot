"""Export a consistent SQLite snapshot or restore it with the workspace stopped."""

import argparse
import os
import shutil
import sqlite3
import sys
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from alembic import command
from alembic.config import Config as AlembicConfig
from sqlalchemy import make_url

from .config import Config
from .database import build_engine

MAX_BACKUP = 512 * 1024 * 1024
LATEST = "0006_automation"


class BackupError(Exception):
    pass


def database_path(config: Config) -> Path:
    url = make_url(config.database)
    if url.drivername != "sqlite" or not url.database or url.database == ":memory:":
        raise BackupError("Built-in backup and restore require a file-based SQLite workspace.")
    return Path(url.database).resolve()


def read_only(path: Path):
    return sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=8)


def protect_file(path: Path):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)


def create_backup(config: Config, target: Path) -> None:
    source = database_path(config)
    if not source.is_file():
        raise BackupError("The local database does not exist.")
    protect_file(target)
    try:
        with closing(read_only(source)) as original, closing(sqlite3.connect(target)) as snapshot:
            original.backup(snapshot)
            snapshot.execute("PRAGMA secure_delete=ON")
            snapshot.execute(
                "UPDATE provider_configs SET credential=NULL, enabled=0, allow_candidate_data=0"
            )
            snapshot.execute("UPDATE discovery_schedules SET enabled=0, lease_until=0")
            snapshot.execute(
                "UPDATE discovery_runs SET status='interrupted', message='Stopped at backup.' "
                "WHERE status='running'"
            )
            snapshot.commit()
            snapshot.execute("VACUUM")
        if target.stat().st_size > MAX_BACKUP:
            raise BackupError("This backup is larger than 512 MB. Use SQLite administration tools.")
    except (sqlite3.Error, OSError, BackupError):
        target.unlink(missing_ok=True)
        raise


def schema_snapshot(path: Path) -> list[tuple]:
    with closing(read_only(path)) as connection:
        connection.execute("PRAGMA trusted_schema=OFF")
        return connection.execute(
            "SELECT type, name, tbl_name, sql FROM sqlite_schema "
            "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
        ).fetchall()


def verify(candidate: Path, scratch: Path) -> None:
    with candidate.open("rb") as stream:
        if stream.read(16) != b"SQLite format 3\x00":
            raise BackupError("Select a SQLite backup created by ApplyPilot.")
    if candidate.stat().st_size > MAX_BACKUP:
        raise BackupError("The backup exceeds the 512 MB restore limit.")
    baseline = Config(data_dir=scratch, database_url=None, scheduler_enabled=False)
    engine = build_engine(baseline)
    migration = AlembicConfig(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    try:
        with engine.begin() as connection:
            migration.attributes["connection"] = connection
            command.upgrade(migration, LATEST)
    finally:
        engine.dispose()
    if schema_snapshot(candidate) != schema_snapshot(database_path(baseline)):
        raise BackupError("The backup schema does not match this ApplyPilot version.")
    with closing(read_only(candidate)) as connection:
        connection.execute("PRAGMA trusted_schema=OFF")
        if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
            raise BackupError("The SQLite backup failed its integrity check.")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise BackupError("The backup contains invalid record relationships.")
        if connection.execute("SELECT version_num FROM alembic_version").fetchall() != [(LATEST,)]:
            raise BackupError(
                "The backup migration version does not match this ApplyPilot version."
            )
        if (
            connection.execute(
                "SELECT 1 FROM provider_configs WHERE credential IS NOT NULL OR enabled != 0"
            ).fetchone()
            or connection.execute(
                "SELECT 1 FROM discovery_schedules WHERE enabled != 0 OR lease_until != 0"
            ).fetchone()
        ):
            raise BackupError(
                "Use an ApplyPilot export with credentials removed and automation paused."
            )


def restore(config: Config, source: Path) -> Path | None:
    destination = database_path(config)
    destination.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    for suffix in ("-wal", "-shm", "-journal"):
        if Path(str(destination) + suffix).exists():
            raise BackupError("Stop ApplyPilot and close other connections before restoring.")
    if source.resolve() == destination:
        raise BackupError("Choose a backup separate from the live database.")
    with TemporaryDirectory(prefix="applypilot-restore-", dir=destination.parent) as directory:
        scratch = Path(directory)
        candidate = scratch / "restored.sqlite3"
        protect_file(candidate)
        with source.open("rb") as incoming, candidate.open("wb") as outgoing:
            remaining = MAX_BACKUP
            while data := incoming.read(1024 * 1024):
                remaining -= len(data)
                if remaining < 0:
                    raise BackupError("The backup exceeds the 512 MB restore limit.")
                outgoing.write(data)
        verify(candidate, scratch / "schema")
        previous = None
        if destination.exists():
            previous = destination.parent / f"before-restore-{uuid4().hex}.sqlite3"
            protect_file(previous)
            try:
                shutil.copyfile(destination, previous)
            except OSError:
                previous.unlink(missing_ok=True)
                raise
        os.replace(candidate, destination)
        return previous


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    export = sub.add_parser("export")
    export.add_argument("file", help="New output file, or '-' for stdout.")
    restore_command = sub.add_parser("restore")
    restore_command.add_argument("file", help="Backup file, or '-' for stdin.")
    restore_command.add_argument("--confirm-stopped", action="store_true", required=True)
    options = parser.parse_args()
    try:
        config = Config()
        if options.action == "export" and options.file != "-":
            create_backup(config, Path(options.file))
        elif options.action == "export":
            with TemporaryDirectory(prefix="applypilot-export-") as directory:
                backup = Path(directory) / "applypilot.sqlite3"
                create_backup(config, backup)
                with backup.open("rb") as source:
                    shutil.copyfileobj(source, sys.stdout.buffer)
        elif options.file != "-":
            previous = restore(config, Path(options.file))
            if previous:
                print(f"Previous database saved as {previous.name}.")
        else:
            with TemporaryDirectory(prefix="applypilot-input-") as directory:
                incoming = Path(directory) / "input.sqlite3"
                with incoming.open("wb") as output:
                    remaining = MAX_BACKUP
                    while data := sys.stdin.buffer.read(1024 * 1024):
                        remaining -= len(data)
                        if remaining < 0:
                            raise BackupError("The backup exceeds the 512 MB restore limit.")
                        output.write(data)
                previous = restore(config, incoming)
                if previous:
                    print(f"Previous database saved as {previous.name}.")
    except FileExistsError:
        parser.exit(1, "The backup file already exists. Choose a new filename.\n")
    except BackupError as error:
        parser.exit(1, str(error) + "\n")
    except (OSError, sqlite3.Error):
        parser.exit(
            1, "The backup or restore could not be completed. Check storage and file permissions.\n"
        )


if __name__ == "__main__":
    main()
