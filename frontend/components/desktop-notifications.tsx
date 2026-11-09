"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { request } from "../lib/workspace-client";

const preferenceKey = "applypilot:desktop-notifications";
const markerKey = "applypilot:last-desktop-notification";
const changedEvent = "applypilot:desktop-notifications-changed";

type Marker = { id: number; created_at: string };
type NotificationHead = Marker & { read: boolean };
type Setting = "off" | "on" | "blocked" | "unavailable";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("focus", listener);
  window.addEventListener(changedEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("focus", listener);
    window.removeEventListener(changedEvent, listener);
  };
}

function setting(): Setting {
  if (!window.isSecureContext || !("Notification" in window)) return "unavailable";
  if (Notification.permission === "denied") return "blocked";
  try {
    return Notification.permission === "granted" && localStorage.getItem(preferenceKey) === "on" ? "on" : "off";
  } catch {
    return "unavailable";
  }
}

function useSetting() {
  return useSyncExternalStore(subscribe, setting, (): Setting => "off");
}

export function DesktopNotificationSettings() {
  const current = useSetting();
  const [error, setError] = useState(false);

  async function toggle() {
    setError(false);
    try {
      if (current === "on") {
        localStorage.removeItem(preferenceKey);
        localStorage.removeItem(markerKey);
      } else if (await Notification.requestPermission() === "granted") {
        localStorage.setItem(preferenceKey, "on");
      }
    } catch {
      setError(true);
    } finally {
      window.dispatchEvent(new Event(changedEvent));
    }
  }

  if (current === "unavailable") return <p>Desktop alerts are unavailable in this browser.</p>;
  if (current === "blocked") return <p>Desktop alerts are blocked in your browser settings.</p>;
  return <div className="form-actions">
    <button className="text-button" type="button" onClick={() => void toggle()}>
      {current === "on" ? "Turn off desktop alerts" : "Enable desktop alerts"}
    </button>
    <span>Alerts are generic and appear while ApplyPilot is open.</span>
    {error && <span role="alert">Could not change desktop alerts.</span>}
  </div>;
}

export function DesktopNotificationPoller() {
  const router = useRouter();
  const current = useSetting();

  useEffect(() => {
    if (current !== "on") return;
    let stopped = false;
    let pending = false;
    const controller = new AbortController();

    async function check() {
      if (pending) return;
      pending = true;
      try {
        const { latest } = await request<{ latest: NotificationHead | null }>("notification-head", {
          signal: controller.signal,
        });
        if (stopped || setting() !== "on") return;
        const raw = localStorage.getItem(markerKey);
        const prior: Marker | null = raw && raw !== "empty" ? JSON.parse(raw) : null;
        if (!latest) {
          if (raw === null) localStorage.setItem(markerKey, "empty");
          return;
        }
        if (prior && (latest.created_at < prior.created_at ||
            (latest.created_at === prior.created_at && latest.id <= prior.id))) return;
        if (raw !== null && !latest.read) {
          const notification = new Notification("ApplyPilot", {
            body: "You have a new workspace notification.",
            tag: "applypilot-workspace-activity",
          });
          notification.onclick = () => {
            window.focus();
            router.push("/automation");
            notification.close();
          };
        }
        localStorage.setItem(markerKey, JSON.stringify({ id: latest.id, created_at: latest.created_at }));
      } catch {
        // The in-app notification remains available if delivery is unsupported or the API is offline.
      } finally {
        pending = false;
      }
    }

    void check();
    const timer = window.setInterval(check, 15000);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [current, router]);

  return null;
}
