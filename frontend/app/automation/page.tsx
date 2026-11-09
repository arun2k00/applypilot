import type { Metadata } from "next";
import { AutomationSettings } from "../../components/automation-settings";

export const metadata: Metadata = { title: "Automation" };

export default function AutomationPage() {
  return <div className="settings-page profile-page">
    <p className="eyebrow">Local automation</p>
    <h1>Automation and notifications</h1>
    <p className="intro">Check authorized RSS feeds on a schedule and see reminders when ApplyPilot is running and your computer is awake.</p>
    <AutomationSettings />
  </div>;
}
