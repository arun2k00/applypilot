import type { Metadata } from "next";
import { ProviderSettings } from "../../components/provider-settings";

export const metadata: Metadata = { title: "AI providers" };

export default function ProvidersPage() {
  return (
    <div className="settings-page profile-page">
      <p className="eyebrow">Optional integrations</p>
      <h1>AI providers</h1>
      <p className="intro">Connect a provider with your own API key or use a local Ollama model. Connection tests can incur API charges. API billing is separate from consumer subscriptions.</p>
      <ProviderSettings />
    </div>
  );
}
