"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { jsonRequest, request } from "../lib/workspace-client";

const jobFields = {
  title: "Job title", company: "Company", url: "Listing URL", location: "Location",
  industry: "Industry", seniority: "Seniority", currency: "Salary currency",
} as const;
const searchFields = {
  name: "Search name", titles: "Desired titles", locations: "Preferred locations",
  industry: "Industries", seniority: "Seniority", excluded_companies: "Excluded companies",
  currency: "Salary currency",
} as const;
const emptyJob = {
  title: "", company: "", url: "", location: "", industry: "", seniority: "", currency: "",
  arrangement: "", skills: "", description: "", experience: "", max_salary: "", closes_on: "", source: "manual",
};
const matchWeights = {
  role: "Role", skills: "Required skills", experience: "Experience",
  seniority: "Seniority", industry: "Industry", location: "Location and arrangement",
  compensation: "Compensation",
} as const;
const matchThresholds = {
  recommended_score: "Recommended score", excellent_score: "Excellent score",
  minimum_evidence: "Minimum evidence coverage",
} as const;
const defaultPolicy = {
  weights: { role: 25, skills: 20, experience: 15, seniority: 15, industry: 10, location: 10, compensation: 5 },
  recommended_score: 70, excellent_score: 85, minimum_evidence: 20,
};
const emptySearch = {
  name: "", titles: "", locations: "", industry: "", seniority: "", excluded_companies: "",
  arrangement: "", min_salary: null as number | null, currency: "", match_policy: defaultPolicy,
};
type Search = typeof emptySearch & { id?: number };
type Job = {
  id: number; title: string; company: string; url: string; location: string; source: string;
  arrangement: string; description: string; expired: boolean; excluded: boolean; shortlisted: boolean;
  match: {
    score: number | null; evidence: number; excellent: boolean; matched_skills: string[]; unconfirmed_skills: string[];
    dimensions: { label: string; weight: number; value: number | null; reason: string }[];
  };
};
type JobData = {
  items: Job[]; next_page: number | null; searches: Search[]; match_policy: typeof defaultPolicy;
};

export function JobWorkspace() {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<JobData | null>(null);
  const [job, setJob] = useState(emptyJob);
  const [search, setSearch] = useState<Search>(emptySearch);
  const [selected, setSelected] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [view, setView] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [feed, setFeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ page: String(page), view });
    if (selected) query.set("search", String(selected));
    request<JobData>("jobs?" + query.toString(), { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setWorkspace(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load jobs. Reload to try again.");
    });
    return () => controller.abort();
  }, [page, selected, view, refresh]);

  async function action(work: () => Promise<string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await work());
      setRefresh((count) => count + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not complete the request.");
    } finally {
      setBusy(false);
    }
  }

  if (!workspace) return <p role={error ? "alert" : "status"}>{error || "Loading jobs…"}</p>;
  const jobs = workspace.items;
  const policy = search.match_policy;
  const totalWeight = Object.values(policy.weights).reduce((sum, weight) => sum + weight, 0);

  return <>
    <section className="card panel">
      <h2>Listings</h2>
      <div className="form profile-fields">
        <label>View<select value={view} onChange={(event) => { setView(event.target.value); setPage(1); }}>
          <option value="all">All jobs</option><option value="recommended">Recommended</option><option value="saved">Shortlisted</option>
        </select></label>
        <label>Match against<select value={selected ?? ""} onChange={(event) => {
          const id = Number(event.target.value) || null;
          setSelected(id);
          setSearch(workspace.searches.find((item) => item.id === id) ?? emptySearch);
          setPage(1);
        }}>
          <option value="">Candidate profile only</option>
          {workspace.searches.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select></label>
      </div>
      {view === "recommended" && <p>Showing scores of {workspace.match_policy.recommended_score} or higher with at least {workspace.match_policy.minimum_evidence}% evidence coverage.</p>}
      {jobs.length === 0 && <p className="empty">No listings on this page. Import a job below or choose another view.</p>}
      <div className="job-list">
        {jobs.map((item) => <article className="card panel" key={item.id}>
          <div className="section-heading">
            <h3>{item.title}</h3>
            <strong>{item.match.score === null ? "Awaiting evidence" : item.match.score + "/100 match" + (item.match.excellent && !item.expired && !item.excluded ? " · Excellent" : "")}</strong>
          </div>
          <p>{[item.company, item.location, item.arrangement, item.source].filter(Boolean).join(" · ")}</p>
          <p>{item.expired ? "Closing date passed. " : ""}{item.excluded ? "Company excluded by this search." : ""}</p>
          <div className="form-actions">
            <a className="text-button" href={item.url} target="_blank" rel="noopener noreferrer">Open listing</a>
            <button className="text-button" disabled={busy} onClick={() => void action(async () => {
              const created = await jsonRequest<{ id: number }>("applications", "POST", { job_id: item.id });
              router.push("/applications?id=" + created.id);
              return "Application opened.";
            })}>Prepare application</button>
            <button className="text-button" disabled={busy} onClick={() => void action(async () => {
              await jsonRequest("job-shortlist", "PUT", { id: item.id, shortlisted: !item.shortlisted });
              return item.shortlisted ? "Removed from shortlist." : "Added to shortlist.";
            })}>{item.shortlisted ? "Remove from shortlist" : "Shortlist"}</button>
          </div>
          <details className="import-preview">
            <summary>Match explanation · {item.match.evidence}% evidence coverage</summary>
            <ul className="records">{item.match.dimensions.map(({ label, weight, value, reason }) => <li key={label}>
              <div><strong>{label} · {weight}% weight</strong><p>{reason}</p></div>
              <span>{value === null ? "Unknown" : Math.round(value * 100) + "%"}</span>
            </li>)}</ul>
            {item.match.matched_skills.length > 0 && <p>Documented skills: {item.match.matched_skills.join(", ")}</p>}
            {item.match.unconfirmed_skills.length > 0 && <p>Skills to confirm: {item.match.unconfirmed_skills.join(", ")}</p>}
          </details>
          {item.description && <details className="import-preview"><summary>Description</summary><pre>{item.description}</pre></details>}
        </article>)}
      </div>
      <div className="form-actions">
        {page > 1 && <button className="text-button" onClick={() => setPage(page - 1)}>Previous page</button>}
        {workspace.next_page && <button className="text-button" onClick={() => setPage(workspace.next_page ?? page)}>Next page</button>}
      </div>
    </section>
    <section className="card panel">
      <h2>Import a job</h2>
      <p>Paste a listing or an alert you received. Opening the source is optional.</p>
      <form className="form" onSubmit={(event) => {
        event.preventDefault();
        void action(async () => {
          const imported = await jsonRequest<{ created: boolean }>("jobs", "POST", {
            ...job, experience: job.experience ? Number(job.experience) : null,
            max_salary: job.max_salary ? Number(job.max_salary) : null, closes_on: job.closes_on || null,
          });
          setJob(emptyJob);
          setPage(1);
          return imported.created ? "Listing imported." : "This listing is already in your workspace.";
        });
      }}>
        <fieldset disabled={busy} className="profile-fields">
          {Object.entries(jobFields).map(([field, label]) => <label key={field}>{label}
            <input required={["title", "company", "url"].includes(field)}
              value={job[field as keyof typeof jobFields]} type={field === "url" ? "url" : "text"}
              maxLength={field === "url" ? 1600 : field === "currency" ? 3 : 180}
              onChange={(event) => setJob({ ...job, [field]: event.target.value })} />
          </label>)}
          <label>Work arrangement<Arrangement value={job.arrangement} change={(value) => setJob({ ...job, arrangement: value })} /></label>
          <label>Minimum years of experience<input type="number" min="0" max="90" step="0.1" value={job.experience}
            onChange={(event) => setJob({ ...job, experience: event.target.value })} /></label>
          <label>Maximum salary<input type="number" min="0" max="1000000000" value={job.max_salary}
            onChange={(event) => setJob({ ...job, max_salary: event.target.value })} /></label>
          <label>Closing date<input type="date" value={job.closes_on} onChange={(event) => setJob({ ...job, closes_on: event.target.value })} /></label>
          <label>Source<select value={job.source} onChange={(event) => setJob({ ...job, source: event.target.value })}>
            <option value="manual">Manual listing</option><option value="alert">User-provided job alert</option>
          </select></label>
        </fieldset>
        <label>Required skills<input value={job.skills} disabled={busy} maxLength={1600} placeholder="Separate skills with commas"
          onChange={(event) => setJob({ ...job, skills: event.target.value })} /></label>
        <label>Description<textarea rows={4} value={job.description} disabled={busy} maxLength={20000}
          onChange={(event) => setJob({ ...job, description: event.target.value })} /></label>
        <button className="button" disabled={busy}>Import listing</button>
      </form>
    </section>
    <section className="card panel">
      <h2>Saved searches</h2>
      <p>Separate multiple values with commas.</p>
      {search.id && <button className="text-button" type="button" onClick={() => setSearch(emptySearch)}>New search</button>}
      <form className="form" onSubmit={(event) => {
        event.preventDefault();
        void action(async () => {
          const saved = await jsonRequest<Search>("job-searches", "PUT", search);
          setSearch(saved);
          setSelected(saved.id ?? null);
          setPage(1);
          return "Search saved.";
        });
      }}>
        <fieldset disabled={busy} className="profile-fields">
          {Object.entries(searchFields).map(([field, label]) => <label key={field}>{label}
            <input required={field === "name"} value={search[field as keyof typeof searchFields]}
              maxLength={field === "name" ? 80 : field === "currency" ? 3 : 1000}
              onChange={(event) => setSearch({ ...search, [field]: event.target.value })} />
          </label>)}
          <label>Preferred work arrangement<Arrangement value={search.arrangement}
            change={(value) => setSearch({ ...search, arrangement: value })} /></label>
          <label>Minimum compensation<input type="number" min="0" max="1000000000" value={search.min_salary ?? ""}
            onChange={(event) => setSearch({ ...search, min_salary: event.target.value ? Number(event.target.value) : null })} /></label>
        </fieldset>
        <details className="import-preview">
          <summary>Match weights and thresholds</summary>
          <p>Weights must add up to 100%. The current total is {totalWeight}%.</p>
          <fieldset disabled={busy} className="profile-fields">
            {Object.entries(matchWeights).map(([key, label]) => <label key={key}>{label} weight
              <input type="number" required min="0" max="100" step="1" value={policy.weights[key as keyof typeof matchWeights]}
                onChange={(event) => setSearch({ ...search, match_policy: {
                  ...policy, weights: { ...policy.weights, [key]: Number(event.target.value) },
                } })} />
            </label>)}
            {Object.entries(matchThresholds).map(([key, label]) => <label key={key}>{label}
              <input type="number" required min="0" max="100" step="1" value={policy[key as keyof typeof matchThresholds]}
                onChange={(event) => setSearch({ ...search, match_policy: { ...policy, [key]: Number(event.target.value) } })} />
            </label>)}
          </fieldset>
        </details>
        <button className="button" disabled={busy || totalWeight !== 100 || policy.recommended_score > policy.excellent_score}>Save search</button>
        {policy.recommended_score > policy.excellent_score && <p>Excellent score must be at least the recommended score.</p>}
      </form>
    </section>
    <section className="card panel">
      <h2>Authorized RSS feed</h2>
      <p>Use a feed you have permission to access and have enabled in your local configuration.</p>
      <form className="form" onSubmit={(event) => {
        event.preventDefault();
        void action(async () => {
          const result = await jsonRequest<{ imported: number }>("job-feed", "POST", { url: feed.trim() });
          setPage(1);
          return "Imported " + result.imported + " new listings.";
        });
      }}>
        <label>Feed URL<input value={feed} type="url" required disabled={busy} onChange={(event) => setFeed(event.target.value)} /></label>
        <button className="button" disabled={busy}>Import feed</button>
      </form>
    </section>
    {(error || message || busy) && <div className="profile-feedback" aria-live="polite">
      {error ? <p role="alert" className="error">{error}</p> : <p role="status">{busy ? "Working…" : message}</p>}
    </div>}
  </>;
}

function Arrangement({ value, change }: { value: string; change: (value: string) => void }) {
  return <select value={value} onChange={(event) => change(event.target.value)}>
    <option value="">Unspecified</option><option value="remote">Remote</option>
    <option value="hybrid">Hybrid</option><option value="onsite">On-site</option>
  </select>;
}
