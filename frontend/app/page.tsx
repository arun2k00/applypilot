import { ArrowRight, Compass } from "lucide-react";
import Link from "next/link";
import { OverviewData } from "../components/overview-data";

export default function OverviewPage() {
  return (
    <>
      <section className="hero" aria-labelledby="overview-title">
        <div className="hero-art" aria-hidden="true"><Compass size={130} strokeWidth={0.5} /></div>
        <div className="hero-copy">
          <p className="eyebrow">Your job search, organized</p>
          <h1 id="overview-title">Workspace overview</h1>
          <p>A private space to manage your search, prepare applications, and see what’s next.</p>
          <Link href="/profile" className="button button-light">Set up your profile <ArrowRight size={16} /></Link>
        </div>
      </section>
      <OverviewData />
    </>
  );
}
