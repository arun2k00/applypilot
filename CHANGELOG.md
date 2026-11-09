# Changelog

## Upcoming workflow update (unreleased)

- Added candidate profiles with local resume import, suggestions, history, and original-file export.
- Added provider configuration, encrypted API keys, explicit task routing and redacted usage.
- Added manual and authorized RSS discovery, saved searches, shortlist, and explainable scores.
- Added resume and cover letter preparation, screening drafts, cited research notes, PDF and DOCX export, package approval, and tracking.
- Added scheduled RSS imports, retry history, in-app reminders, and SQLite backup and offline restore.
- Added saved-search scoring controls, global recommendation ranking, application calendar and conversion breakdowns, and opt-in desktop alerts.
- Added an external-drive build command for macOS checkouts on exFAT.

## 0.1.0 foundation

- Local dashboard with service health.
- Persistent workspace name and timezone settings.
- FastAPI, SQLAlchemy, Alembic, Next.js and Compose foundation.
- Native and container verification commands, CI configuration, and a phased architecture plan.

Native macOS verification covered migrations, settings persistence, API access controls, the production frontend build, and the Chromium settings flow. The locked npm tree and Python runtime dependencies had no known advisories at the time of the Phase 1 checks. Windows, native Linux, and PostgreSQL verification remain open.

Docker Desktop on macOS successfully built both images and reached healthy status. Chromium passed against the containerized workspace. SQLite settings persisted across backend container replacement.
