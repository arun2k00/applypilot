"use client";

import { useEffect, useState } from "react";
import { Database, Server, ShieldCheck } from "lucide-react";

type Status = "checking" | "ready" | "unavailable";

export function ServiceStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      try {
        const response = await fetch("/api/local/status", { cache: "no-store", signal: controller.signal });
        if (!controller.signal.aborted) setStatus(response.ok ? "ready" : "unavailable");
      } catch {
        if (!controller.signal.aborted) setStatus("unavailable");
      }
    }
    void check();
    const timer = window.setInterval(check, 15000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, []);

  const api = status === "ready" ? "Ready" : status === "checking" ? "Checking…" : "Unavailable";
  const storage = status === "ready" ? "Connected" : status === "checking" ? "Checking…" : "Unconfirmed";

  return (
    <dl className="status-list" aria-live="polite">
      <div><dt><Server size={17} /> Local API</dt><dd data-status={status}>{api}</dd></div>
      <div><dt><Database size={17} /> Workspace storage</dt><dd data-status={status}>{storage}</dd></div>
      <div><dt><ShieldCheck size={17} /> Outbound AI</dt><dd data-status="ready">Opt-in</dd></div>
    </dl>
  );
}
