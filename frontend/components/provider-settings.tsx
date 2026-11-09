"use client";

import { useEffect, useState } from "react";
import { jsonRequest, request } from "../lib/workspace-client";

const kinds = {
  openai: "OpenAI", anthropic: "Anthropic Claude", gemini: "Google Gemini",
  ollama: "Ollama", compatible: "OpenAI-compatible",
} as const;
type Kind = keyof typeof kinds;
type Provider = {
  id?: number; kind: Kind; label: string; model: string; endpoint: string;
  has_key?: boolean; enabled: boolean; allow_candidate_data: boolean; json_mode: boolean;
  input_rate: number | null; output_rate: number | null;
};
type Usage = {
  id: number; provider: string; task: string; model: string; status: string;
  input_tokens: number | null; output_tokens: number | null; estimated_usd: number | null;
};
type ProviderWorkspace = { providers: Provider[]; routes: Record<string, number[]>; tasks: string[]; usage: Usage[] };
const blank: Provider = {
  kind: "openai", label: "", model: "", endpoint: "", enabled: true,
  allow_candidate_data: false, json_mode: false, input_rate: null, output_rate: null,
};

export function ProviderSettings() {
  const [workspace, setWorkspace] = useState<ProviderWorkspace | null>(null);
  const [draft, setDraft] = useState(blank);
  const [key, setKey] = useState("");
  const [task, setTask] = useState("default");
  const [routing, setRouting] = useState<number[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    request<ProviderWorkspace>("providers", { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setWorkspace(result);
        setRouting(result.routes.default ?? []);
      }
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load your local providers. Reload to try again.");
    });
    return () => controller.abort();
  }, []);

  async function action(work: () => Promise<string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await work());
      setWorkspace(await request<ProviderWorkspace>("providers"));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not complete this request.");
    } finally {
      setBusy(false);
    }
  }

  function edit(provider: Provider) {
    setDraft(provider);
    setKey("");
    setModels([]);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    void action(async () => {
      const { has_key: hadKey, ...fields } = draft;
      const saved = await jsonRequest<Provider>("providers", "PUT", { ...fields, api_key: key || null });
      edit(saved);
      return key && hadKey ? "Credential updated." : "Provider saved.";
    });
  }

  if (!workspace) return <p role={error ? "alert" : "status"}>{error || "Loading providers…"}</p>;
  const custom = draft.kind === "ollama" || draft.kind === "compatible";

  return <div className="profile-stack">
    <section className="card panel">
      <h2>Configured providers</h2>
      {workspace.providers.length === 0 && <p>Your workspace runs locally until you configure a provider.</p>}
      <ul className="records">
        {workspace.providers.map((provider) => <li key={provider.id}>
          <button type="button" className="text-button" disabled={busy} onClick={() => edit(provider)}>{provider.label}</button>
          <span>{kinds[provider.kind]} · {provider.model}{provider.enabled ? "" : " · Disabled"}</span>
        </li>)}
      </ul>
      {draft.id && <button type="button" className="text-button" disabled={busy} onClick={() => edit(blank)}>Add another provider</button>}
    </section>
    <section className="card panel">
      <h2>{draft.id ? "Edit provider" : "Add a provider"}</h2>
      <form className="form" onSubmit={save}>
        <fieldset className="profile-fields" disabled={busy}>
          <label>Provider
            <select value={draft.kind} onChange={(event) => {
              setModels([]);
              setKey("");
              setDraft({ ...draft, kind: event.target.value as Kind, endpoint: "", allow_candidate_data: false });
            }}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
          <label>Display name<input value={draft.label} required maxLength={80}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
          <label>Model ID<input value={draft.model} required maxLength={160} list="provider-model-options"
            onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
            <datalist id="provider-model-options">{models.map((model) => <option key={model} value={model} />)}</datalist>
          </label>
          <label>API key<input type="password" value={key} autoComplete="new-password" maxLength={4000}
            placeholder={draft.has_key ? "Leave blank to keep saved key" : ""}
            onChange={(event) => setKey(event.target.value)} /></label>
          {custom && <label>Base URL<input value={draft.endpoint} maxLength={400}
            placeholder={draft.kind === "ollama" ? "http://127.0.0.1:11434" : "https://provider.example/v1"}
            onChange={(event) => setDraft({ ...draft, endpoint: event.target.value, allow_candidate_data: false })} /></label>}
          <label>Input USD per million tokens<input type="number" min="0" max="10000" step="any" value={draft.input_rate ?? ""}
            onChange={(event) => setDraft({ ...draft, input_rate: event.target.value ? Number(event.target.value) : null })} /></label>
          <label>Output USD per million tokens<input type="number" min="0" max="10000" step="any" value={draft.output_rate ?? ""}
            onChange={(event) => setDraft({ ...draft, output_rate: event.target.value ? Number(event.target.value) : null })} /></label>
        </fieldset>
        <label className="checkbox-label"><input type="checkbox" checked={draft.enabled} disabled={busy}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Enable provider</label>
        <label className="checkbox-label"><input type="checkbox" checked={draft.json_mode} disabled={busy}
          onChange={(event) => setDraft({ ...draft, json_mode: event.target.checked })} />This model supports JSON mode</label>
        <label className="checkbox-label"><input type="checkbox" checked={draft.allow_candidate_data} disabled={busy}
          onChange={(event) => setDraft({ ...draft, allow_candidate_data: event.target.checked })} />Allow selected AI tasks to share candidate data with this provider</label>
        <div className="form-actions">
          <button className="button" disabled={busy}>Save provider</button>
          {draft.id && <button type="button" className="text-button" disabled={busy} onClick={() => void action(async () => {
            await jsonRequest("provider-check", "POST", { id: draft.id });
            return "The saved model responded to a test message.";
          })}>Test saved connection</button>}
          {draft.id && draft.kind === "ollama" && <button type="button" className="text-button" disabled={busy} onClick={() => void action(async () => {
            const result = await jsonRequest<{ models: string[] }>("provider-models", "POST", { id: draft.id });
            setModels(result.models);
            return result.models.length ? "Models loaded. Choose one in the Model ID field." : "No installed models found.";
          })}>Find local models</button>}
          {draft.id && <button type="button" className="text-button" disabled={busy} onClick={() => {
            if (!window.confirm("Remove this provider and its saved credential?")) return;
            void action(async () => {
              await jsonRequest("provider-delete", "POST", { id: draft.id });
              edit(blank);
              setRouting((items) => items.filter((item) => item !== draft.id));
              return "Provider removed.";
            });
          }}>Remove provider</button>}
        </div>
      </form>
    </section>
    <section className="card panel">
      <h2>Task routing</h2>
      <p>Choose a primary provider and a fallback. Tasks without their own route use the default.</p>
      <form className="form" onSubmit={(event) => {
        event.preventDefault();
        void action(async () => {
          await jsonRequest("provider-routing", "PUT", { task, providers: routing.filter(Boolean) });
          return "Task route saved.";
        });
      }}>
        <label>Task<select value={task} disabled={busy} onChange={(event) => {
          setTask(event.target.value);
          setRouting(workspace.routes[event.target.value] ?? []);
        }}>{workspace.tasks.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
        <div className="profile-fields">
          {["Primary provider", "Fallback provider"].map((label, index) => <label key={label}>{label}
            <select value={routing[index] ?? ""} disabled={busy} onChange={(event) => {
              const updated = [...routing];
              updated[index] = Number(event.target.value);
              setRouting(updated);
            }}>
              <option value="">None</option>
              {workspace.providers.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>)}
        </div>
        <button className="button" disabled={busy}>Save routing</button>
      </form>
    </section>
    <section className="card panel">
      <h2>Recent usage</h2>
      {workspace.usage.length === 0 && <p>Usage appears after a connection test or AI task.</p>}
      <ul className="records">{workspace.usage.map((item) => <li key={item.id}>
        <strong>{item.provider} · {item.task}</strong>
        <span>{item.status} · {item.input_tokens ?? "—"} in / {item.output_tokens ?? "—"} out
          {item.estimated_usd !== null && " · $" + item.estimated_usd.toFixed(6)}</span>
      </li>)}</ul>
    </section>
    {(error || message || busy) && <div className="profile-feedback" aria-live="polite">
      {error ? <p role="alert" className="error">{error}</p> : <p role="status">{busy ? "Working…" : message}</p>}
    </div>}
  </div>;
}
