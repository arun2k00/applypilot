"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { jsonRequest, request } from "../lib/workspace-client";
import { ApplicationCalendar } from "./application-calendar";

type Tracking = {
  applied_at?: string; interview_on?: string | null; follow_up_on?: string | null;
  notes?: string; recruiter?: string;
};
type Item = {
  id: number; version: number; title: string; company: string; status: string;
  url: string; source: string; tracking: Tracking; profile_revision: number | null;
};
type Answer = { question: string; answer: string };
type Evidence = { url: string; observation: string };
type Package = { master?: string; resume?: string; letter?: string; gaps?: string[]; reordered?: string[]; answers?: Answer[]; research?: Evidence[] };
type Details = Item & {
  package: Package; approved: boolean; answer_library: (Answer & { id: number })[];
  events: { id: number; action: string; status: string; created_at: string }[];
};
type Breakdown = { tracked: number; submitted: number; interviews: number };
type Listing = {
  items: Item[]; statuses: string[]; jobs_discovered: number; shortlisted: number;
  counts: { applications: number; submitted: number; interviews: number; offers: number };
  sources: Record<string, Breakdown>; industries: Record<string, Breakdown>; next_page: number | null;
};

export function ApplicationWorkspace() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [view, setView] = useState("table");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [item, setItem] = useState<Details | null>(null);
  const [draft, setDraft] = useState<Package>({});
  const [tracking, setTracking] = useState<Tracking>({});
  const [status, setStatus] = useState("");
  const [tone, setTone] = useState("professional");
  const [ai, setAi] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [answerConfirmed, setAnswerConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function loadDetail(details: Details) {
    setItem(details);
    setDraft(details.package);
    setTracking(details.tracking);
    setStatus(details.status);
    setConfirmed(false);
    setSubmitted(false);
    setAnswerConfirmed(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const job = new URLSearchParams(window.location.search).get("id");
        if (job && /^[1-9][0-9]{0,8}$/.test(job)) {
          const detail = await request<Details>("application-detail?id=" + job, { signal: controller.signal });
          if (!controller.signal.aborted) loadDetail(detail);
        }
      } catch {
        if (!controller.signal.aborted) setError("Could not open this application.");
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    request<Listing>("applications?page=" + page, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setListing(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Could not load your applications. Reload to try again.");
    });
    return () => controller.abort();
  }, [page, refresh]);

  async function action(work: () => Promise<string>) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      setMessage(await work());
      setRefresh((count) => count + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not complete this request.");
    } finally {
      setBusy(false);
    }
  }

  function open(id: number) {
    void action(async () => {
      loadDetail(await request<Details>("application-detail?id=" + id));
      return "";
    });
  }

  function changePackage(patch: Package) {
    setDraft({ ...draft, ...patch });
    setConfirmed(false);
    setAnswerConfirmed(false);
  }

  if (!listing) return <p role={error ? "alert" : "status"}>{error || "Loading applications…"}</p>;
  const changed = item && JSON.stringify(draft) !== JSON.stringify(item.package);
  const breakdowns = [
    { label: "Source", groups: listing.sources }, { label: "Industry", groups: listing.industries },
  ];
  const percent = (part: number, total: number) => total ? Math.round(part / total * 100) + "%" : "—";


  return <>
    <section className="card panel">
      <h2>Application tracker</h2>
      <p>{listing.jobs_discovered} jobs discovered · {listing.shortlisted} shortlisted · {listing.counts.submitted} submitted · {listing.counts.interviews} interviews · {listing.counts.offers} offers</p>
      <p>Application to interview {percent(listing.counts.interviews, listing.counts.submitted)} · Interview to offer {percent(listing.counts.offers, listing.counts.interviews)}</p>
      {listing.counts.applications > 0 && <details className="import-preview">
        <summary>Results by source and industry</summary>
        {breakdowns.map(({ label, groups }) =>
          <div className="table-scroll" key={label}><table className="workspace-table">
            <thead><tr><th scope="col">{label}</th><th scope="col">Tracked</th>
              <th scope="col">Submitted</th><th scope="col">Interviews</th><th scope="col">Interview rate</th></tr></thead>
            <tbody>{Object.entries(groups).map(([key, counts]) =>
              <tr key={key}><th scope="row">{key}</th><td>{counts.tracked}</td><td>{counts.submitted}</td>
                <td>{counts.interviews}</td><td>{percent(counts.interviews, counts.submitted)}</td></tr>
            )}</tbody>
          </table></div>
        )}
      </details>}
      {listing.counts.applications === 0 ? <div className="empty"><strong>No applications yet</strong><Link className="text-button" href="/jobs">Discover a job to prepare an application</Link></div> : <>
        <label className="form">Tracker view<select value={view} onChange={(event) => setView(event.target.value)}>
          <option value="table">Table</option><option value="board">Board</option><option value="calendar">Calendar</option>
        </select></label>
        {view === "table" && <div className="table-scroll"><table className="workspace-table">
          <thead><tr><th scope="col">Role</th><th scope="col">Company</th><th scope="col">Status</th></tr></thead>
          <tbody>{listing.items.map((row) => <tr key={row.id}><td><button className="text-button" disabled={busy} onClick={() => open(row.id)}>{row.title}</button></td><td>{row.company}</td><td>{row.status}</td></tr>)}</tbody>
        </table></div>}
        {view === "board" && <div className="board">{listing.statuses.map((column) => {
          const rows = listing.items.filter((row) => row.status === column);
          if (!rows.length) return null;
          return <section className="card panel" key={column}><h3>{column}</h3>
            <ul className="records">{rows.map((row) => <li key={row.id}><button className="text-button" disabled={busy} onClick={() => open(row.id)}>{row.title} · {row.company}</button></li>)}</ul>
          </section>;
        })}</div>}
        {view === "calendar" && <ApplicationCalendar refresh={refresh} open={open} />}
        {view !== "calendar" && <div className="form-actions">
          {page > 1 && <button className="text-button" onClick={() => setPage(page - 1)}>Previous page</button>}
          {listing.next_page && <button className="text-button" onClick={() => setPage(listing.next_page ?? page)}>Next page</button>}
        </div>}
      </>}
    </section>
    {item && <>
      <section className="card panel" aria-labelledby="application-title">
        <h2 id="application-title">{item.title} at {item.company}</h2>
        <p>{item.status} · {item.profile_revision ? "Profile revision " + item.profile_revision : "Awaiting document preparation"}</p>
        <p><a className="text-button" href={item.url} target="_blank" rel="noopener noreferrer">View original listing</a></p>
        <form className="form" onSubmit={(event) => {
          event.preventDefault();
          void action(async () => {
            loadDetail(await jsonRequest<Details>("application-prepare", "POST", {
              id: item.id, version: item.version, tone, ai_selection: ai,
            }));
            return "Documents prepared. Review them below.";
          });
        }}>
          <label>Cover letter tone<select value={tone} disabled={busy} onChange={(event) => setTone(event.target.value)}>
            {["professional", "concise", "formal", "conversational", "executive"].map((style) => <option key={style} value={style}>{style}</option>)}
          </select></label>
          <label className="checkbox-label"><input type="checkbox" checked={ai} disabled={busy} onChange={(event) => setAi(event.target.checked)} />
            Ask my permitted AI provider to rank reviewed resume sections</label>
          {item.package.resume && <p>Preparing again replaces the saved resume and cover letter with new drafts.</p>}
          <button className="button" disabled={busy}>Prepare documents</button>
        </form>
      </section>
      {item.package.resume && <section className="card panel">
        <h2>Review the package</h2>
        <p>Review your contact details, experience, and answers before approving. Edits require a fresh approval.</p>
        {draft.gaps && draft.gaps.length > 0 && <p>Skills to confirm: {draft.gaps.join(", ")}</p>}
        {draft.reordered && draft.reordered.length > 0 && <p>Moved earlier: {draft.reordered.join(", ")}</p>}
        <form className="form" onSubmit={(event) => {
          event.preventDefault();
          void action(async () => {
            loadDetail(await jsonRequest<Details>("application-package", "PUT", {
              id: item.id, version: item.version, resume: draft.resume, letter: draft.letter,
              answers: draft.answers ?? [], research: draft.research ?? [],
            }));
            return "Package saved for review.";
          });
        }}>
          <div className="profile-fields comparison">
            <label>Reviewed master resume<textarea rows={15} readOnly value={draft.master ?? ""} /></label>
            <label>Tailored resume<textarea rows={15} required value={draft.resume ?? ""} disabled={busy} onChange={(event) => changePackage({ resume: event.target.value })} /></label>
          </div>
          <label>Cover letter<textarea rows={12} required value={draft.letter ?? ""} disabled={busy} onChange={(event) => changePackage({ letter: event.target.value })} /></label>
          <div className="form-actions" aria-label="Download saved documents">
            {["resume", "letter"].flatMap((kind) => ["docx", "pdf"].map((format) =>
              <a key={kind + format} download className="text-button" href={"/api/local/application-document?id=" + item.id + "&kind=" + kind + "&format=" + format}>{kind === "resume" ? "Resume" : "Cover letter"} {format.toUpperCase()}</a>
            ))}
          </div>
          <h3>Screening questions</h3>
          <p>Draft from reviewed profile facts or write an answer yourself. Enter details such as compensation, notice period, work authorization, and legal declarations yourself.</p>
          {(draft.answers ?? []).map((row, index) => <fieldset className="card panel form" disabled={busy} key={index}>
            <label>Question<input required maxLength={600} value={row.question} onChange={(event) => changePackage({
              answers: (draft.answers ?? []).map((answer, i) => i === index ? { ...answer, question: event.target.value } : answer),
            })} /></label>
            <label>Answer<textarea rows={3} maxLength={2000} value={row.answer} onChange={(event) => changePackage({
              answers: (draft.answers ?? []).map((answer, i) => i === index ? { ...answer, answer: event.target.value } : answer),
            })} /></label>
            <div className="form-actions">
              <button type="button" className="text-button" disabled={!row.question.trim() || Boolean(row.answer.trim())} onClick={() => void action(async () => {
                const suggestion = await jsonRequest<{ answer: string; message: string }>("application-screening", "POST", {
                  id: item.id, version: item.version, question: row.question,
                });
                if (suggestion.answer) changePackage({
                  answers: (draft.answers ?? []).map((entry, i) => i === index ? { ...entry, answer: suggestion.answer } : entry),
                });
                return suggestion.message;
              })}>Draft from profile</button>
              <button type="button" className="text-button" onClick={() => changePackage({ answers: (draft.answers ?? []).filter((_, i) => i !== index) })}>Remove question</button>
              <button type="button" className="text-button" disabled={!answerConfirmed || !row.question.trim() || !row.answer.trim()} onClick={() => void action(async () => {
                await jsonRequest("application-answer", "PUT", { ...row, confirmed: answerConfirmed });
                const refreshed = await request<Details>("application-detail?id=" + item.id);
                setItem(refreshed);
                setAnswerConfirmed(false);
                return "Answer saved to the library.";
              })}>Save answer to library</button>
            </div>
          </fieldset>)}
          <div className="form-actions">
            <button type="button" className="text-button" disabled={busy || (draft.answers?.length ?? 0) >= 12}
              onClick={() => changePackage({ answers: [...(draft.answers ?? []), { question: "", answer: "" }] })}>Add a screening question</button>
            {(draft.answers?.length ?? 0) > 0 && <label className="checkbox-label">
              <input type="checkbox" checked={answerConfirmed} disabled={busy} onChange={(event) => setAnswerConfirmed(event.target.checked)} />I reviewed the answers above</label>}
          </div>
          {item.answer_library.length > 0 && <label>Reuse an approved answer<select value="" disabled={busy || (draft.answers?.length ?? 0) >= 12} onChange={(event) => {
            const saved = item.answer_library.find(({ id }) => id === Number(event.target.value));
            if (saved) changePackage({ answers: [...(draft.answers ?? []), { question: saved.question, answer: saved.answer }] });
          }}><option value="">Choose a saved question</option>{item.answer_library.map(({ id, question }) => <option key={id} value={id}>{question}</option>)}</select></label>}
          <h3>Company research</h3>
          <p>Record sourced observations for this opportunity.</p>
          {(draft.research ?? []).map((row, index) => <fieldset className="card panel form" disabled={busy} key={index}>
            <label>Source URL<input type="url" maxLength={1600} required value={row.url} onChange={(event) => changePackage({
              research: (draft.research ?? []).map((entry, i) => i === index ? { ...entry, url: event.target.value } : entry),
            })} /></label>
            <label>Observation<textarea rows={2} maxLength={1000} value={row.observation} onChange={(event) => changePackage({
              research: (draft.research ?? []).map((entry, i) => i === index ? { ...entry, observation: event.target.value } : entry),
            })} /></label>
            <button type="button" className="text-button" onClick={() => changePackage({ research: (draft.research ?? []).filter((_, i) => i !== index) })}>Remove source</button>
          </fieldset>)}
          <button type="button" className="text-button" disabled={busy || (draft.research?.length ?? 0) >= 8}
            onClick={() => changePackage({ research: [...(draft.research ?? []), { url: "", observation: "" }] })}>Add a research source</button>
          <button className="button" disabled={busy || !changed}>Save package edits</button>
        </form>
        <div className="form">
          <label className="checkbox-label"><input type="checkbox" checked={confirmed} disabled={busy || Boolean(changed)}
            onChange={(event) => setConfirmed(event.target.checked)} />I reviewed the saved package for this specific application.</label>
          <button className="button" disabled={busy || !confirmed || Boolean(changed)} onClick={() => void action(async () => {
            loadDetail(await jsonRequest<Details>("application-approve", "POST", { id: item.id, version: item.version, confirmed }));
            return "Package approved. You can complete the application on the employer’s site.";
          })}>Approve for manual completion</button>
          {item.approved && !changed && <a className="text-button" href={item.url} target="_blank" rel="noopener noreferrer">Open employer site to complete the application</a>}
        </div>
      </section>}
      <section className="card panel">
        <h2>Track this application</h2>
        <form className="form" onSubmit={(event) => {
          event.preventDefault();
          void action(async () => {
            loadDetail(await jsonRequest<Details>("application-tracking", "PUT", {
              id: item.id, version: item.version, status, applied_manually: submitted,
              interview_on: tracking.interview_on || null, follow_up_on: tracking.follow_up_on || null,
              notes: tracking.notes ?? "", recruiter: tracking.recruiter ?? "",
            }));
            return "Tracking saved.";
          });
        }}>
          <fieldset disabled={busy} className="profile-fields">
            <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>
              {listing.statuses.map((value) => <option key={value}>{value}</option>)}
            </select></label>
            <label>Recruiter contact<input value={tracking.recruiter ?? ""} maxLength={300} onChange={(event) => setTracking({ ...tracking, recruiter: event.target.value })} /></label>
            <label>Interview date<input type="date" value={tracking.interview_on ?? ""} onChange={(event) => setTracking({ ...tracking, interview_on: event.target.value })} /></label>
            <label>Follow-up date<input type="date" value={tracking.follow_up_on ?? ""} onChange={(event) => setTracking({ ...tracking, follow_up_on: event.target.value })} /></label>
          </fieldset>
          <label>Notes<textarea rows={4} value={tracking.notes ?? ""} maxLength={3500} disabled={busy} onChange={(event) => setTracking({ ...tracking, notes: event.target.value })} /></label>
          {!item.tracking.applied_at && <label className="checkbox-label"><input type="checkbox" checked={submitted} disabled={busy} onChange={(event) => setSubmitted(event.target.checked)} />I personally submitted this application on the employer’s site.</label>}
          <button className="button" disabled={busy}>Save tracking</button>
        </form>
        <ul className="records" aria-label="Application activity">
          {item.events.map(({ id, action: label, status: state, created_at }) => <li key={id}><span>{label} · {state}</span><time>{created_at.slice(0, 10)}</time></li>)}
        </ul>
      </section>
    </>}
    {(error || message || busy) && <div className="profile-feedback" aria-live="polite">
      {error ? <p role="alert" className="error">{error}</p> : <p role="status">{busy ? "Working…" : message}</p>}
    </div>}
  </>;
}
