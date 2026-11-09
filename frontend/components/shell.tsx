"use client";

import { AlarmClock, BriefcaseBusiness, Compass, FileText, LayoutGrid, LockKeyhole, Settings2, UserRound, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { label: "Overview", href: "/", icon: LayoutGrid },
  { label: "Discover jobs", href: "/jobs", icon: BriefcaseBusiness },
  { label: "Candidate profile", href: "/profile", icon: UserRound },
  { label: "Applications", href: "/applications", icon: FileText },
  { label: "AI providers", href: "/providers", icon: Sparkles },
  { label: "Automation", href: "/automation", icon: AlarmClock },
  { label: "Settings", href: "/settings", icon: Settings2 },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon"><Compass size={23} strokeWidth={1.8} /></span>
          <span>ApplyPilot <small>JOB SEARCH WORKSPACE</small></span>
        </Link>
        <nav aria-label="Workspace">
          <div className="nav-label">Workspace</div>
          {navigation.map(({ label, href, icon: Icon }) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
              <Icon size={18} strokeWidth={1.8} /> {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <LockKeyhole size={16} />
          <div><strong>Local workspace</strong><small>Stored on this device</small></div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>Workspace <span>/</span> <strong>{navigation.find(({ href }) => pathname === href)?.label ?? "Workspace"}</strong></div>
          <span className="badge"><span className="dot" /> Local mode</span>
        </header>
        <main id="main" className="content">{children}</main>
      </div>
    </div>
  );
}
