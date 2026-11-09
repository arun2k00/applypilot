import { expect, test } from "@playwright/test";

test("desktop alerts are opt-in and keep private details inside the app", async ({ page }) => {
  await page.addInitScript(() => {
    let permission: NotificationPermission = "default";
    const shown: string[] = [];
    Object.defineProperty(window, "applyPilotTestAlerts", { value: shown });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static get permission() { return permission; }
        static async requestPermission() {
          permission = "granted";
          return permission;
        }
        constructor(_title: string, options: NotificationOptions) {
          shown.push(options.body ?? "");
        }
      },
    });
  });
  await page.clock.install();
  let requests = 0;
  let latest: { id: number; created_at: string; read: boolean } | null = null;
  await page.route("**/api/local/notification-head", async (route) => {
    requests += 1;
    await route.fulfill({ json: { latest } });
  });
  await page.goto("/automation");
  const enable = page.getByRole("button", { name: "Enable desktop alerts" });
  await expect(enable).toBeVisible();
  expect(requests).toBe(0);
  await enable.click();
  await expect(page.getByRole("button", { name: "Turn off desktop alerts" })).toBeVisible();
  await expect.poll(() => requests).toBe(1);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("applypilot:last-desktop-notification"))).toBe("empty");

  latest = { id: 1, created_at: "2026-11-09T11:00:00", read: false };
  await page.clock.fastForward(15_001);
  const alerts = () => page.evaluate(() => (
    window as unknown as { applyPilotTestAlerts: string[] }
  ).applyPilotTestAlerts);
  await expect.poll(alerts).toEqual(["You have a new workspace notification."]);
  await page.clock.fastForward(15_001);
  await expect.poll(() => requests).toBe(3);
  expect(await alerts()).toHaveLength(1);
});
