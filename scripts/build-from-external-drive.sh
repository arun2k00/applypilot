#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || (${1:-} != "" && ${1:-} != "--build-only") ]]; then
  printf '%s\n' "Usage: bash scripts/build-from-external-drive.sh [--build-only]" >&2
  exit 2
fi

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
stage=$(mktemp -d "${TMPDIR:-/tmp}/applypilot-build.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT

for component in backend frontend; do
  mkdir -p "$stage/$component"
  rsync -a --exclude='._*' --exclude=.venv --exclude=node_modules --exclude=.next \
    --exclude='.env*' --exclude='*.tsbuildinfo' --exclude='__pycache__' \
    --exclude='.*_cache' --exclude=.local-data --exclude=test-results --exclude=playwright-report \
    "$root/$component/" "$stage/$component/"
done

python3 - "$stage" <<'PY'
import json
import sys
from pathlib import Path

stage = Path(sys.argv[1])
override = {
    "services": {
        component: {"build": {"context": str(stage / component)}}
        for component in ("backend", "frontend")
    }
}
(stage / "compose.build.json").write_text(json.dumps(override), encoding="utf-8")
PY

cd "$root"
docker compose -f docker-compose.yml -f "$stage/compose.build.json" build
if [[ ${1:-} != "--build-only" ]]; then
  docker compose up -d --no-build --wait
fi
