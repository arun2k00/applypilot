"use client";

import { useEffect, useState } from "react";
import { settingsSchema, type Settings } from "../lib/settings";

export function SettingsForm() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/local/settings", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const result = settingsSchema.parse(await response.json());
        if (!controller.signal.aborted) setSettings(result);
      } catch {
        if (!controller.signal.aborted) setError("Could not load settings. Check the local API and try again.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    const parsed = settingsSchema.safeParse(settings);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/local/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (response.status === 422) {
        setError("Enter an IANA timezone, such as UTC or Asia/Kolkata.");
        return;
      }
      if (!response.ok) throw new Error();
      setSettings(settingsSchema.parse(await response.json()));
      setMessage("Settings saved.");
    } catch {
      setError("Could not save settings. Check the local API and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p role="status">Loading settings…</p>;
  if (!settings) return (
    <div className="form">
      <p className="error" role="alert">{error}</p>
      <button className="button" type="button" onClick={() => {
        setLoading(true);
        setError("");
        setAttempt((value) => value + 1);
      }}>Try again</button>
    </div>
  );

  return (
    <form className="form" onSubmit={save}>
      <label>Workspace name
        <input value={settings.workspace_name} maxLength={80} required disabled={saving}
          onChange={(event) => { setMessage(""); setSettings({ ...settings, workspace_name: event.target.value }); }} />
      </label>
      <label>Timezone
        <input value={settings.timezone} maxLength={64} required disabled={saving}
          spellCheck={false} aria-describedby="timezone-help"
          onChange={(event) => { setMessage(""); setSettings({ ...settings, timezone: event.target.value }); }} />
      </label>
      <small id="timezone-help">Use an IANA name such as UTC, America/New_York, or Asia/Kolkata.</small>
      <div className="form-actions">
        <button className="button" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
        <span className="success" role="status">{message}</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
