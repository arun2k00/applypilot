from alembic import context

from app.config import Config
from app.database import build_engine
from app.models import Base


def migrate(connection):
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    context.configure(url=Config().database, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
elif (connection := context.config.attributes.get("connection")) is not None:
    migrate(connection)
else:
    engine = build_engine(Config())
    try:
        with engine.connect() as connection:
            migrate(connection)
    finally:
        engine.dispose()
