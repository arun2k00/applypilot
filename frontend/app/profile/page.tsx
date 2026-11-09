import type { Metadata } from "next";
import { ProfileForm } from "../../components/profile-form";

export const metadata: Metadata = { title: "Candidate profile" };

export default function ProfilePage() {
  return (
    <div className="settings-page profile-page">
      <p className="eyebrow">Candidate workspace</p>
      <h1>Candidate profile</h1>
      <p className="intro">Import a resume or start with a blank profile. Review your information before saving it for future matches and documents.</p>
      <ProfileForm />
    </div>
  );
}
