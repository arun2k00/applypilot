"use client";

import { BriefcaseBusiness, CalendarDays, FileText, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { request } from "../lib/workspace-client";
import { ServiceStatus } from "./service-status";

const metrics = [
  { key: "jobs", label: "Jobs discovered", hint: "Your job pipeline", icon: BriefcaseBusiness },
  { key: "excellent", label: "Excellent matches", hint: "From your latest saved search", icon: Sparkles },
  { key: "in_progress", label: "Applications", hint: "Applications in progress", icon: FileText },
  { key: "interviews", label: "Interviews", hint: "Upcoming conversations", icon: CalendarDays },
] as const;
type Overview = {
  counts: Record<(typeof metrics)[number]["key"], number>;
  excellent_score: number;
  activity: { id: number; action: string; title: string; company: string }[];
  followups: { date: string; title: string; company: string }[];
  discovery: { status: string; message: string } | null;
};

export function OverviewData() {
  const [workspace, setWorkspace] = useState<Overview | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await request<Overview>("overview", { signal: controller.signal });
        if (!controller.signal.aborted) {
          setWorkspace(result);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load();
    const timer = window.setInterval(load, 30000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);
  return <>
    <section aria-labelledby="pipeline-title" className="section">
      <div className="section-heading"><h2 id="pipeline-title">Your pipeline</h2><span>Workspace snapshot</span></div>
      {error && <p role="alert" className="error">Could not refresh the dashboard.</p>}
      <div className="metrics">
        {metrics.map(({ key, label, hint, icon: Icon }) => (
          <article className="card metric" key={key}>
            <div className="metric-label"><Icon size={18} /> <h3>{label}</h3></div>
            <strong>{workspace?.counts[key] ?? "—"}</strong>
            <p>{key === "excellent" && workspace ? "Score of " + workspace.excellent_score + " or higher" : hint}</p>
          </article>
        ))}
      </div>
    </section>
    <div className="lower-grid section">
      <section className="card panel" aria-labelledby="activity-title">
        <h2 id="activity-title">Recent activity</h2>
        {workspace?.activity.length ? <ul className="records">
          {workspace.activity.map((item) => <li key={item.id}><strong>{item.action}</strong><span>{item.title} · {item.company}</span></li>)}
        </ul> : <div className="empty">
          <span className="metric-label"><CalendarDays size={19} /></span>
          <strong>{workspace ? "No activity yet" : "Checking activity…"}</strong>
          <span>Application updates appear here.</span>
        </div>}
        {workspace && workspace.followups.length > 0 && <>
          <h3 className="section">Upcoming follow-ups</h3>
          <ul className="records">{workspace.followups.map((item, index) =>
            <li key={index}><span>{item.title} · {item.company}</span><time>{item.date}</time></li>
          )}</ul>
        </>}
      </section>
      <section className="card panel" aria-labelledby="status-title">
        <h2 id="status-title">System status</h2>
        <p>Health of your local installation.</p>
        <ServiceStatus />
        {workspace?.discovery && <p>Last discovery run: {workspace.discovery.message}</p>}
      </section>
    </div>
  </>;
}
