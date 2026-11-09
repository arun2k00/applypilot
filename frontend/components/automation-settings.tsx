"use client";

import { useEffect, useState } from "react";
import { jsonRequest, request } from "../lib/workspace-client";
import { DesktopNotificationSettings } from "./desktop-notifications";

type Schedule = {
  id?: number; label: string; url: string; frequency: "daily" | "weekly"; at: string;
  weekday: number; threshold: number; max_jobs: number; search_id: number | null; enabled: boolean;
};
type Saved = Schedule & { id: number; next_run: number; last_success: number | null; running: boolean };
type Workspace = {
  timezone: string; schedules: Saved[];
  searches: { id: number; name: string }[];
  runs: { id: number; schedule_id: number; status: string; message: string; created_at: string }[];
  notifications: { id: number; message: string; read: boolean; created_at: string }[];
};
const empty: Schedule = {
  label: "", url: "", frequency: "daily", at: "09:00", weekday: 0,
  threshold: 85, max_jobs: 20, search_id: null, enabled: false,
};
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function AutomationSettings() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await request<Workspace>("automation", { signal: controller.signal });
        if (!controller.signal.aborted) setWorkspace(result);
      } catch {
        if (!controller.signal.aborted) setError("Could not load local automation.");
      }
    }
    void load();
    const timer = window.setInterval(load, 15000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  async function action(work: () => Promise<string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await work());
      setWorkspace(await request<Workspace>("automation"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not complete this request.");
    } finally {
      setBusy(false);
    }
  }

  function editable(row: Saved): Schedule {
    return {
      id: row.id, label: row.label, url: row.url, frequency: row.frequency, at: row.at,
      weekday: row.weekday, threshold: row.threshold, max_jobs: row.max_jobs,
      search_id: row.search_id, enabled: row.enabled,
    };
  }

  if (!workspace) return <p role={error ? "alert" : "status"}>{error || "Loading automation…"}</p>;
  const date = (seconds: number) => new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short", timeZone: workspace.timezone,
  }).format(seconds * 1000);

  return <div className="profile-stack">
    <section className="card panel">
      <h2>Notifications</h2>
      <DesktopNotificationSettings />
      {workspace.notifications.length === 0 && <p>High matches and upcoming application reminders appear here.</p>}
      <ul className="records">{workspace.notifications.map((item) => <li key={item.id}>
        <span>{item.message}</span>
        {!item.read && <button className="text-button" disabled={busy} onClick={() => void action(async () => {
          await jsonRequest("notification-read", "PUT", { id: item.id });
          return "Marked as read.";
        })}>Mark read</button>}
      </li>)}</ul>
    </section>
    <section className="card panel">
      <h2>Discovery schedules</h2>
      <p>Schedule times use {workspace.timezone}. Match alerts use the selected search’s minimum evidence coverage.</p>
      <ul className="records">{workspace.schedules.map((row) => <li key={row.id}>
        <div><strong>{row.label}</strong><p>{row.running ? "Running" : row.enabled ? "Next run " + date(row.next_run) : "Paused"}</p>
          {row.last_success && <p>Last success {date(row.last_success)}</p>}</div>
        <div className="form-actions">
          <button className="text-button" disabled={busy} onClick={() => setDraft(editable(row))}>Edit</button>
          <button className="text-button" disabled={busy} onClick={() => void action(async () => {
            const updated = await jsonRequest<Saved>("automation", "PUT", { ...editable(row), enabled: !row.enabled });
            if (draft.id === row.id) setDraft(editable(updated));
            return row.enabled ? "Schedule paused." : "Schedule enabled.";
          })}>{row.enabled ? "Pause" : "Resume"}</button>
          <button className="text-button" disabled={busy || row.running || !row.enabled} onClick={() => void action(async () => {
            await jsonRequest("automation-run", "POST", { id: row.id });
            return "Run queued.";
          })}>Run now</button>
        </div>
      </li>)}</ul>
      {draft.id && <button className="text-button" disabled={busy} onClick={() => setDraft(empty)}>New schedule</button>}
      <form className="form" onSubmit={(event) => {
        event.preventDefault();
        void action(async () => {
          setDraft(editable(await jsonRequest<Saved>("automation", "PUT", draft)));
          return "Schedule saved.";
        });
      }}>
        <fieldset className="profile-fields" disabled={busy}>
          <label>Name<input required maxLength={80} value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
          <label>Authorized RSS URL<input type="url" required maxLength={1600} value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></label>
          <label>Frequency<select value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value as Schedule["frequency"] })}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option>
          </select></label>
          <label>Search time<input type="time" required value={draft.at} onChange={(event) => setDraft({ ...draft, at: event.target.value })} /></label>
          {draft.frequency === "weekly" && <label>Day<select value={draft.weekday} onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}>
            {weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}
          </select></label>}
          <label>Saved search<select value={draft.search_id ?? ""} onChange={(event) => setDraft({ ...draft, search_id: Number(event.target.value) || null })}>
            <option value="">Candidate profile only</option>
            {workspace.searches.map((search) => <option key={search.id} value={search.id}>{search.name}</option>)}
          </select></label>
          <label>Minimum match score<input type="number" required min="0" max="100" value={draft.threshold} onChange={(event) => setDraft({ ...draft, threshold: Number(event.target.value) })} /></label>
          <label>Maximum listings per run<input type="number" required min="1" max="50" value={draft.max_jobs} onChange={(event) => setDraft({ ...draft, max_jobs: Number(event.target.value) })} /></label>
        </fieldset>
        <label className="checkbox-label"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Enable this schedule</label>
        <button className="button" disabled={busy}>Save schedule</button>
      </form>
    </section>
    <section className="card panel">
      <h2>Recent runs</h2>
      {workspace.runs.length === 0 && <p>No feed runs yet.</p>}
      <ul className="records">{workspace.runs.map((run) => <li key={run.id}>
        <div><strong>{workspace.schedules.find(({ id }) => id === run.schedule_id)?.label ?? "Schedule"} · {run.status}</strong><p>{run.message}</p></div>
        <time>{run.created_at.slice(0, 10)}</time>
      </li>)}</ul>
    </section>
    {(error || message || busy) && <div className="profile-feedback" aria-live="polite">
      {error ? <p role="alert" className="error">{error}</p> : <p role="status">{busy ? "Working…" : message}</p>}
    </div>}
  </div>;
}
