# ApplyPilot architecture

## Runtime and boundaries

ApplyPilot is a single-user workspace on one machine. Next.js renders the UI and exposes a narrow, same-origin bridge to FastAPI. FastAPI owns validation, data, and future adapter calls. SQLite lives under the private application data directory with original resumes and generated files in separate subdirectories when those features arrive. SQLAlchemy keeps transactions and SQL portable. An advanced installation can supply PostgreSQL through a database URL. Alembic owns schema changes. Start one API process per local workspace. Future scheduled work will use durable database rows and leases in that process, with concurrency scoped to each task.

In Compose only the UI is published, on IPv4 loopback. The API runs on the private Compose network. Native installs bind both servers to loopback. The UI API accepts only its configured origin for writes and permits a fixed list of routes and methods. The API has trusted host checks, a custom mutation header and no CORS. This local trust model assumes control of the OS account and loopback environment. Remote or shared-machine operation needs a separate authenticated deployment design.

## Data design

The first migration creates a singleton `workspace_settings` row at migration time. It holds the workspace name and IANA timezone. Later migrations add source resumes, candidate-confirmed profile revisions, provider routes and usage, jobs, searches, applications, events, schedules, and notifications. The table below describes the target model, including refinements beyond the current schema. Use UUIDs for domain entities, UTC timestamps and explicit foreign-key deletion policies. Keep secrets and document bytes out of ordinary JSON responses.

| Area | Planned relations and constraints |
| --- | --- |
| Profile | `candidate_profiles` owns employment, education, certifications, achievements, skills, projects, languages and links. `profile_versions` snapshots edits. Facts carry provenance, review status and optional source document/section. Only candidate confirmation promotes evidence to verified. |
| Documents | `master_resumes` owns `resume_versions`. Original bytes are immutable and recorded by checksum, size and media type. `tailored_resumes` references a verified profile revision, job revision and rendered artifact. `cover_letters` and `screening_answers` retain referenced evidence and review state. |
| AI | `ai_providers` stores model/endpoint metadata and credential references. `ai_task_configs` has one primary route and ordered fallbacks per task. `ai_usage` tracks status, model, time, tokens and optional cost without storing prompts. |
| Discovery | `job_sources` owns configuration and cursor state. `saved_searches` stores criteria and schedules. `discovered_jobs` has normalized URL and content digest. `job_source_records` is unique on source and external ID. `job_skills` links canonical skills to requirements. `match_analyses` is unique on job revision, profile revision, preference revision and scoring version. |
| Company | `company_profiles` owns cited `company_sources` with source URL, excerpt and observation time. Inferences stay separate from sourced observations. |
| Applications | `applications` references a job and owns `application_documents`, `application_answers`, `application_events` and `application_approvals`. An approval binds one application and a digest of the reviewed package. Submitted status requires an explicit manual event or verified submission outcome. |
| Operations | `automation_tasks` and `automation_runs` store schedule, lease, attempts, progress and outcome. `notifications` has unique deduplication keys. `audit_events` stores redacted metadata for sensitive transitions. |

Index job discovery time, source/ID, match score, application status and follow-up time, scheduled run time and notification read state. Write domain state and corresponding events in the same transaction. Store job revisions so an edited listing can invalidate cached analysis and stale approvals.

## API contracts

Use JSON and version domain APIs under `/api/v1`. Phase 1 exposes `GET /health/live`, `GET /health/ready`, and `GET/PUT /api/v1/settings`. Settings accept and return `{workspace_name, timezone}`. Readiness verifies that the settings row is available. The browser uses `GET /api/local/status` and `GET/PUT /api/local/settings`.

Planned resources:

| Resource | Operations |
| --- | --- |
| `/profile`, `/resumes`, `/onboarding` | Get/update profile and wizard checkpoint. Upload multipart, return extraction task, confirm individual draft facts. |
| `/providers`, `/ai-task-configs`, `/ai-usage` | Configure metadata, rotate credentials, test connection and list available models. Responses omit credentials. |
| `/sources`, `/searches`, `/jobs` | Configure authorized sources, import pasted job data, browse jobs, shortlist and request match analysis. |
| `/companies`, `/drafts`, `/answers` | Read cited research, create a document generation task, review drafts, export files and approve reusable answers. |
| `/applications` | Prepare and review a package, issue a short-lived individual approval, track status and inspect events. |
| `/tasks`, `/notifications`, `/backups` | Poll progress, retry eligible tasks, manage notifications and export or restore data. |

List endpoints use stable cursor pagination. Long-running actions return `202` and a task identifier. Mutation requests that may be retried accept an idempotency key. Validation errors identify invalid fields without returning raw input, and logs omit private payloads.

## Adapter contracts

- AI providers expose `capabilities(model)`, `test_connection()`, optional `list_models()`, `complete(request)` and optional `stream(request)`. A request contains task, model, trusted instructions, bounded evidence, token budget and optional JSON schema. A result contains content, model, finish reason and token counts when available. Routing owns timeouts, backoff, context limits, schema validation and task-level fallback. Check data-sharing consent again on every fallback. Treat provider output as a draft and require references to verified facts before document review.
- Job sources expose `discover(search, cursor, limit)` returning normalized job records and a next cursor, plus optional `verify(source_record)`. Adapters declare capabilities and access constraints. The discovery service owns rate limits, deduplication and expiry. Manual URLs and pasted descriptions work without fetching arbitrary pages. LinkedIn alerts start as user-supplied content.
- Browser adapters declare supported origins and workflow permissions. They open an isolated profile and prepare a typed field/attachment plan. Final submission is a separate, narrowly scoped operation. The application service must bind approval to a current package and consume it once. Uncertain outcomes go to manual reconciliation. Manual completion works independently of browser automation.

## Navigation

The current navigation exposes Overview, Discover Jobs, Candidate Profile, Applications, AI Providers, Automation, and Settings. The planned routes below describe finer-grained screens that can be separated as the workspace grows.

| Phase | Screens |
| --- | --- |
| 2 | Resumable setup, Candidate Profile and master resume import |
| 3 | AI Providers, task routing and usage |
| 4–5 | Discover Jobs, Saved Jobs, Job Sources, Recommended Jobs and match explanations |
| 6 | Resume Studio, Cover Letters, Company Research and answer library |
| 7 | Application Assistant and individual package review |
| 8 | Applications Tracker with table, board and calendar |
| 9 | Automation Settings, run history and Notifications |
| 10 | Data management, backup/restore and release diagnostics |

Expose navigation when the associated workflow is usable.

## Threats and safeguards

| Risk | Control and phase |
| --- | --- |
| Cross-origin requests and DNS rebinding | Phase 1 uses a configured browser origin, backend host checks, no CORS, mutation headers and loopback publishing. No remote access by default. |
| Credential exposure | Phase 3 adds keychain support where practical and encrypted local storage using an external key. Redact headers and URLs from errors. |
| File upload attacks | Phase 2 validates signatures and size, bounds decompression and PDF parsing, and isolates originals from public routes. |
| SSRF and exfiltration | Phase 3–4 validates endpoint policy, redirect targets and DNS/IP resolution. Local Ollama has an explicit exception. Provider calls require consent and payload minimization. |
| Prompt injection and fabricated experience | Treat job descriptions and documents as untrusted input. Give generation no browser or submission tools. Verify references and require review before use. |
| Unauthorized or duplicate submission | Phase 7 checks workflow permissions and individual approval server-side. Browser assistance stops at authentication challenges and unsupported sites. |
| Backup disclosure or destructive restore | Phase 10 uses explicit restore confirmation, archive validation, staged replacement and secrets exclusion by default. |

## Implemented workflows and remaining release gates

| Phase | Current behavior | Remaining work |
| --- | --- | --- |
| 1 | Local dashboard, Compose, health, settings, SQLite and migrations. | Verify Windows, native Linux, and optional PostgreSQL installations. |
| 2 | PDF and DOCX import, immutable originals, editable suggestions, confirmation and revision history. | Guided multi-step onboarding and normalized employment and education records with richer evidence references. |
| 3 | Five provider adapters, encrypted credentials, connection tests, Ollama model discovery, task routing, consent and redacted usage. | Live vendor verification, streaming, and model capability discovery across cloud providers. Resume section ranking is the implemented candidate-data AI task. |
| 4 | Manual URLs, pasted listings and alerts, allowlisted RSS, saved searches, canonical URL deduplication, and manual closing dates. | Source-specific verification, source identifiers, and broader authorized connectors. |
| 5 | Explainable local scoring, configurable search weights and thresholds, and global recommendation ranking. Unknown dimensions are separated from mismatches. | Optional AI job analysis and richer evidence sources. |
| 6 | Resume comparison, source-text ordering, optional AI ordering, editable letters, grounded screening drafts, reusable answers, cited manual research, PDF/DOCX export. | Template and layout controls, richer diff visualization, and research assistance. |
| 7 | Per-application approval bound to saved content and manual completion on the employer site. Edits revoke approval. | Site-specific Playwright integrations require permission and validation for each employer workflow. |
| 8 | Paginated application table and board, month calendar, history, notes, follow-ups, and source and industry conversion metrics. | Additional pipeline and outcome analytics. |
| 9 | Daily/weekly schedules with a durable lease, capped retries, run logs, in-app reminders, deduplicated match notifications, and opt-in desktop alerts while the app is open. | Optional SMTP delivery. |
| 10 | SQLite backup export and validated offline restore, candidate deletion, dependency locks, synthetic integration tests and CI. | Complete the platform matrix, independent security and accessibility reviews, and public release. |

Each release gate requires appropriate tests and updated operator instructions.
