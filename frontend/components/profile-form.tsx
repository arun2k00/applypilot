"use client";

import { useEffect, useState } from "react";
import { request } from "../lib/workspace-client";

const shortFields = {
  name: "Full name", email: "Email", phone: "Phone", location: "Location",
  headline: "Professional headline", total_experience: "Total experience",
} as const;
const longFields = {
  summary: "Professional summary", employment: "Employment history", achievements: "Achievements",
  skills: "Skills", education: "Education", certifications: "Certifications", projects: "Projects",
  languages: "Languages", links: "Portfolio and professional links",
} as const;
type Fields = Record<keyof typeof shortFields | keyof typeof longFields, string>;
type Snapshot = { revision: number; resume_id: number | null; fields: Fields };
type Source = { id: number; name: string; format: string };
type Import = Source & { suggestions: Fields; text: string };
type Workspace = Snapshot & { resumes: Source[]; history: { revision: number; created_at: string }[] };

export function ProfileForm() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [draft, setDraft] = useState<Snapshot | null>(null);
  const [source, setSource] = useState<Import | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const abort = new AbortController();
    request<Workspace>("profile", { signal: abort.signal }).then((loaded) => {
      if (abort.signal.aborted) return;
      setWorkspace(loaded);
      setDraft(loaded);
    }).catch(() => {
      if (!abort.signal.aborted) setError("Could not load your local profile. Reload to try again.");
    });
    return () => abort.abort();
  }, []);

  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not complete this request.");
    } finally {
      setBusy(false);
    }
  }

  function showImport(imported: Import) {
    setSource(imported);
    setConfirmed(false);
  }

  function upload(file: File) {
    void action(async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error("Choose a file up to 8 MB.");
      const format = file.name.split(".").pop()?.toLowerCase();
      const type = format === "pdf" ? "application/pdf" : format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : null;
      if (!type) throw new Error("Choose a PDF or DOCX resume.");
      const imported = await request<Import>("resumes", {
        method: "POST", body: file, headers: {
          "Content-Type": type, "X-ApplyPilot-Filename": encodeURIComponent(file.name),
        },
      });
      showImport(imported);
      setWorkspace((previous) => previous ? {
        ...previous, resumes: [imported, ...previous.resumes.filter(({ id }) => id !== imported.id)],
      } : previous);
      setMessage("Resume imported. Review the extracted text and suggested fields.");
    });
  }

  function changeField(field: keyof Fields, value: string) {
    setDraft((previous) => previous ? { ...previous, fields: { ...previous.fields, [field]: value } } : previous);
    setConfirmed(false);
    setMessage("");
  }

  function applySuggestions() {
    if (!source || !draft) return;
    const fields = { ...draft.fields };
    for (const key of Object.keys(fields) as (keyof Fields)[]) {
      if (!fields[key]) fields[key] = source.suggestions[key];
    }
    setDraft({ ...draft, fields, resume_id: source.id });
    setConfirmed(false);
    setMessage("Suggestions filled empty fields. Confirm the details before saving.");
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    void action(async () => {
      const saved = await request<Snapshot>("profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: draft.revision, resume_id: draft.resume_id, fields: draft.fields, confirmed }),
      });
      setDraft(saved);
      setConfirmed(false);
      setMessage("Profile saved.");
      setWorkspace(await request<Workspace>("profile"));
    });
  }

  if (!draft || !workspace) return <p role={error ? "alert" : "status"}>{error || "Loading your profile…"}</p>;
  const completeness = Math.round(Object.values(draft.fields).filter((value) => value.trim()).length
    / Object.keys(draft.fields).length * 100);

  return (
    <div className="profile-stack">
      <section className="card panel">
        <p className="eyebrow">Step 1 of 2 · Optional</p>
        <h2>Import a resume</h2>
        <p>Text-based PDF or DOCX, up to 8 MB. Your document stays on this device.</p>
        <label className="file-input">Choose a resume
          <input type="file" accept=".pdf,.docx" disabled={busy} onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
            event.target.value = "";
          }} />
        </label>
        {workspace.resumes.length > 0 && <ul className="records" aria-label="Imported resumes">
          {workspace.resumes.map((resume) => <li key={resume.id}>
            <button type="button" disabled={busy} className="text-button" onClick={() => void action(async () => {
              showImport(await request<Import>("resume-detail?id=" + resume.id));
            })}>{resume.name}</button>
            <a href={"/api/local/resume-original?id=" + resume.id} download>Download original</a>
          </li>)}
        </ul>}
        {source && <div className="import-preview">
          <details open><summary>Extracted text from {source.name}</summary><pre>{source.text}</pre></details>
          <button type="button" className="button" disabled={busy} onClick={applySuggestions}>Fill empty fields from resume</button>
        </div>}
      </section>
      <section className="card panel">
        <p className="eyebrow">Step 2 of 2</p>
        <h2>Review your background</h2>
        <p>{completeness}% of profile fields filled{draft.resume_id ? " · linked to an imported resume" : ""}.</p>
        <form className="form" onSubmit={save}>
          <div className="profile-fields">
            {Object.entries(shortFields).map(([field, label]) => <label key={field}>{label}
              <input value={draft.fields[field as keyof Fields]} required={field === "name"} maxLength={240}
                type={field === "email" ? "email" : field === "phone" ? "tel" : "text"} disabled={busy}
                onChange={(event) => changeField(field as keyof Fields, event.target.value)} />
            </label>)}
          </div>
          {Object.entries(longFields).map(([field, label]) => <label key={field}>{label}
            <textarea rows={field === "employment" ? 4 : 2} maxLength={3000} value={draft.fields[field as keyof Fields]}
              disabled={busy} onChange={(event) => changeField(field as keyof Fields, event.target.value)} />
          </label>)}
          <label className="checkbox-label"><input type="checkbox" required checked={confirmed} disabled={busy}
            onChange={(event) => setConfirmed(event.target.checked)} />
            I reviewed these details and confirm they are accurate.</label>
          <button className="button" disabled={busy}>{busy ? "Working…" : "Save profile"}</button>
        </form>
      </section>
      {workspace.history.length > 0 && <section className="card panel">
        <h2>Profile history</h2>
        <p>Load a saved revision into the editor to review it or save it as a new revision.</p>
        <ul className="records">
          {workspace.history.map(({ revision }) => <li key={revision}>
            <button className="text-button" type="button" disabled={busy} onClick={() => void action(async () => {
              const historical = await request<Snapshot>("profile-history?id=" + revision);
              setDraft({ ...historical, revision: workspace.revision });
              setConfirmed(false);
              setMessage("Revision " + revision + " loaded into the editor.");
            })}>Revision {revision}</button>
            {workspace.revision === revision && <span>Current</span>}
          </li>)}
        </ul>
      </section>}
      {(error || message || busy) && <div className="profile-feedback" aria-live="polite">
        {error ? <p role="alert" className="error">{error}</p> : <p role="status">{busy ? "Working locally…" : message}</p>}
      </div>}
    </div>
  );
}
