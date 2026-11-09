"use client";

import { useState } from "react";
import { jsonRequest } from "../lib/workspace-client";

export function DataSettings() {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function erase(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await jsonRequest("data-delete", "POST", { confirmation });
      setConfirmation("");
      setMessage("Candidate records were deleted.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not delete records.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="card panel section" aria-labelledby="data-title">
    <h2 id="data-title">Workspace data</h2>
    <p>Download a SQLite backup of your workspace. Saved API keys are excluded and restored schedules start paused.</p>
    <div className="form-actions">
      <a className="button" href="/api/local/data-backup" download>Download workspace backup</a>
    </div>
    <p>Restore a backup with ApplyPilot stopped using the restore command in the project README.</p>
    <details className="import-preview">
      <summary>Delete candidate records</summary>
      <p>This removes profile history, imported resumes, application packages, tracking, saved answers, and notifications from the active workspace.</p>
      <form className="form" onSubmit={erase}>
        <label>Type DELETE to confirm<input value={confirmation} maxLength={6} disabled={busy}
          onChange={(event) => setConfirmation(event.target.value)} /></label>
        <button className="button" disabled={busy || confirmation !== "DELETE"}>Delete candidate records</button>
      </form>
    </details>
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
