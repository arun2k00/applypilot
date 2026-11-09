import type { Metadata } from "next";
import { DataSettings } from "../../components/data-settings";
import { SettingsForm } from "../../components/settings-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="settings-page">
      <p className="eyebrow">Local workspace</p>
      <h1>Workspace settings</h1>
      <p className="intro">Personalize your workspace and set the timezone it will use for local schedules.</p>
      <section className="card panel" aria-labelledby="preferences-title">
        <h2 id="preferences-title">General preferences</h2>
        <p>Changes are saved to your local database.</p>
        <SettingsForm />
      </section>
      <DataSettings />
    </div>
  );
}
