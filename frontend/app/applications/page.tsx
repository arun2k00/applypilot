import type { Metadata } from "next";
import { ApplicationWorkspace } from "../../components/application-workspace";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage() {
  return <div className="profile-stack">
    <div>
      <p className="eyebrow">Application workspace</p>
      <h1>Applications</h1>
      <p className="intro">Prepare documents, review what you’ll share, and track each application.</p>
    </div>
    <ApplicationWorkspace />
  </div>;
}
