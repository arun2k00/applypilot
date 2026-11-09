from sqlalchemy import Engine, create_engine, event, make_url

from .config import Config


def build_engine(config: Config) -> Engine:
    url = make_url(config.database)
    if url.drivername == "sqlite" and not config.database_url:
        config.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

    sqlite_options = {"autocommit": False} if url.drivername == "sqlite" else {}
    engine = create_engine(
        url,
        hide_parameters=True,
        pool_pre_ping=True,
        connect_args=sqlite_options,
    )
    if url.drivername == "sqlite":

        @event.listens_for(engine, "connect")
        def set_sqlite_options(connection, _record):
            autocommit = connection.autocommit
            connection.autocommit = True
            cursor = connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute("PRAGMA busy_timeout=5000")
                cursor.execute("PRAGMA secure_delete=ON")
            finally:
                cursor.close()
                connection.autocommit = autocommit

    return engine
