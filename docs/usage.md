# Installation and operations

[Back to the project overview](../README.md)

## Start with Docker

Install Docker with the Compose plugin. On macOS, use an APFS checkout or the external-drive build command below to avoid metadata errors from exFAT. From the ApplyPilot directory, run:

```sh
docker compose up -d --build --wait
```

Open [http://localhost:3000](http://localhost:3000). In **Candidate profile**, import a resume and review the suggested fields. In **Discover jobs**, paste a listing and create a saved search. Set match weights and thresholds in a saved search, shortlist the jobs you want to keep, or open **Applications** to review a package and see interviews and follow-ups on a monthly calendar. Use **Settings** to change the workspace name and timezone.

```sh
docker compose ps
docker compose logs --tail=100
docker compose down
```

If the checkout lives on a macOS external exFAT drive, run `bash scripts/build-from-external-drive.sh` from the project. It builds from a temporary copy on the internal disk and uses the same Compose project and data volume. To restart previously built images, run `docker compose up -d --no-build --wait`.

The named `workspace` volume preserves SQLite across ordinary restarts and container replacement. The first startup applies database migrations automatically. Only the frontend is published to the host, on loopback. Avoid removing the volume if you want to keep your settings.

## Native development

Install Python 3.12, [uv](https://docs.astral.sh/uv/getting-started/installation/), and Node.js 24. The following commands work in separate terminals on macOS, Linux, and Windows PowerShell with the prerequisites on your path.

```sh
cd backend
uv sync --locked
uv run --locked python -m app.start
```

```sh
cd frontend
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The default native SQLite database is `.local-data/applypilot.sqlite3` at the project root. On macOS, keep the checkout on an APFS volume. exFAT can generate AppleDouble metadata files that interfere with dependency installation, migrations and Docker builds.

### Verification

```sh
cd backend
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked pytest
```

```sh
cd frontend
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install --no-shell chromium
npm run test:e2e
```

Use a disposable workspace when running browser tests. The basic settings test restores the previous settings. Set `APPLYPILOT_E2E_MUTATIONS=1` to include the synthetic resume, job, application, and backup flow. It creates records and verifies the employer link without visiting it. The tests target `http://localhost:3000` unless `APPLYPILOT_E2E_URL` is set.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `APPLYPILOT_WEB_PORT` | `3000` | Compose host port for the UI. Update the origin when changing it. |
| `APPLYPILOT_ORIGIN` | `http://localhost:3000` | Exact browser origin allowed by the workspace API. |
| `APPLYPILOT_BACKEND_URL` | `http://127.0.0.1:8000` | Server-side upstream URL. Compose sets it to the backend service. |
| `APPLYPILOT_DATA_DIR` | `../.local-data` | SQLite storage directory relative to the backend working directory. Compose sets `/data`. |
| `APPLYPILOT_DATABASE_URL` | SQLite | Optional SQLAlchemy URL. For a separately provisioned PostgreSQL server use `postgresql+psycopg://…`. |
| `APPLYPILOT_AUTHORIZED_FEEDS` | Empty | Comma-separated RSS URLs you have permission to use. |
| `APPLYPILOT_ALLOWED_PROVIDER_ENDPOINTS` | Empty | Comma-separated custom provider base URLs. Literal loopback URLs are allowed by default. |
| `APPLYPILOT_CREDENTIAL_KEY` | Local key file | Optional Fernet key from your local secret store. |
| `APPLYPILOT_SCHEDULER` | `1` | Set to `0` to disable background scheduling. |
| `APPLYPILOT_PDF_FONT` | Bundled font | Optional TrueType font path for native PDF exports. |
| `APPLYPILOT_API_HOST` / `APPLYPILOT_API_PORT` | `127.0.0.1` / `8000` | Native API listen address. Compose sets its internal address to `0.0.0.0`. |

For Compose, copy `.env.example` to `.env` if you need overrides. For native development, set backend variables in the environment used to launch uv and frontend variables in the environment used to launch Next.js. Keep database credentials in private environment configuration.

If the dashboard reports an unavailable API, inspect `docker compose logs backend` or the backend terminal. For native installs, check [API readiness](http://127.0.0.1:8000/health/ready) and [OpenAPI documentation](http://127.0.0.1:8000/docs). If port 3000 is occupied, choose another port and set the origin to match. Use the configured hostname consistently in your browser.

If macOS reports AppleDouble files such as `._.dockerignore` or migration source containing null bytes, copy the project to a new folder on an APFS volume. Exclude `._*`, `.venv`, `node_modules`, and `.next`, then reinstall dependencies or rebuild. Keep existing application data in its original location until you have verified the new installation.

## Optional providers and job feeds

Open **AI providers** to enter an API key and model ID for OpenAI, Anthropic Claude, Gemini, Ollama or an OpenAI-compatible endpoint. Test the saved connection explicitly. Tests send a short synthetic message and can incur provider charges. To let resume preparation ask a provider to rank reviewed resume sections, enable candidate-data sharing for that provider, assign it to the task, and select AI ranking for the individual preparation request. ApplyPilot validates the returned section keys and assembles the document locally from the reviewed text.

Custom provider endpoints must use a literal loopback address or appear exactly in the comma-separated `APPLYPILOT_ALLOWED_PROVIDER_ENDPOINTS` list. On native installs Ollama defaults to `http://127.0.0.1:11434`. For Docker Desktop, explicitly allow `http://host.docker.internal:11434` and enter it as the Ollama URL. Ensure Ollama listens on an address reachable by Docker. Keep that service private. Credentials are encrypted with a local private key file or `APPLYPILOT_CREDENTIAL_KEY`. Keep the key outside the checkout and independent of distributed backups.

Manual job imports accept copied descriptions, job links, and user-supplied alerts. RSS imports require permission from the source and an exact URL in `APPLYPILOT_AUTHORIZED_FEEDS`. Feed requests send no candidate profile. Schedule enabled feeds in **Automation**. Runs and reminders work while ApplyPilot is awake and running. Enable generic desktop alerts in **Automation** if your browser supports them. They appear while the app is open and keep job and candidate details inside the app. Change Compose environment values in the project `.env` and run `docker compose up -d --no-build --wait` to apply them.

## Backup and restore

Open **Settings** and choose **Download workspace backup** to export a SQLite snapshot with original resume files, profile history, jobs, and application packages. The snapshot excludes credentials, disables providers, and pauses schedules. Keep the backup private.

To restore a backup to Docker, stop the workspace first. Run these commands from the project directory with a backup from this version of ApplyPilot:

```sh
docker compose stop
docker compose run --rm --no-deps -T backend python -m app.backup restore - --confirm-stopped < applypilot-backup.sqlite3
docker compose up -d --no-build --wait
```

For native SQLite, stop both servers, enter `backend`, and run `uv run --locked python -m app.backup restore /path/to/applypilot-backup.sqlite3 --confirm-stopped`. Restore checks the schema and keeps the previous database as a separate recovery copy. Use database administration tools for PostgreSQL backups. The deletion option in **Settings** removes candidate records from the active workspace. Existing backups and recovery copies are separate files.

## Scope and privacy

The default workflow keeps data local. The app prepares documents for individual review and opens the employer site for manual completion. The tracker counts an application as submitted only after the user confirms they submitted it. There is currently no employer-site form automation or automatic final submission.

Resume import supports text-based PDF and DOCX files. Image-only PDFs require OCR outside ApplyPilot. The PDF export uses a bundled font with limited script coverage. Use DOCX for other scripts, or set `APPLYPILOT_PDF_FONT` to a compatible TrueType font on native installs. The local trust model assumes a trusted OS account and loopback access. See the [security policy](../SECURITY.md).

The native and Docker instructions target macOS, Windows and Linux. CI is configured for those platforms. See the [changelog](../CHANGELOG.md) for verified platforms and the [release checklist](release.md) for the public-release gates.
