import type { Metadata } from "next";
import { DesktopNotificationPoller } from "../components/desktop-notifications";
import { Shell } from "../components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Overview · ApplyPilot", template: "%s · ApplyPilot" },
  description: "A local workspace for your job search.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><DesktopNotificationPoller /><Shell>{children}</Shell></body></html>;
}
