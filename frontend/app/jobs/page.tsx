import type { Metadata } from "next";
import { JobWorkspace } from "../../components/job-workspace";

export const metadata: Metadata = { title: "Discover jobs" };

export default function JobsPage() {
  return <div className="profile-stack">
    <div>
      <p className="eyebrow">Opportunity pipeline</p>
      <h1>Discover jobs</h1>
      <p className="intro">Import listings, shortlist opportunities, and see how they match your reviewed profile.</p>
    </div>
    <JobWorkspace />
  </div>;
}
