FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH" \
    APPLYPILOT_DATA_DIR=/data \
    APPLYPILOT_API_HOST=0.0.0.0

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN python -m pip install --no-cache-dir uv==0.12.16 \
    && uv sync --locked --no-dev \
    && /usr/local/bin/python -m pip uninstall --yes uv \
    && groupadd --gid 10001 applypilot \
    && useradd --uid 10001 --gid 10001 applypilot \
    && install -d -m 0700 -o applypilot -g applypilot /data
COPY --chown=10001:10001 app ./app
COPY --chown=10001:10001 migrations ./migrations
COPY --chown=10001:10001 alembic.ini ./
USER applypilot
EXPOSE 8000
CMD ["python", "-m", "app.start"]
