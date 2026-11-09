import { expect, test } from "@playwright/test";

test("dashboard reports readiness and settings survive reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Workspace overview" })).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const main = page.getByRole("main");
  const workspace = main.getByRole("textbox", { name: "Workspace name" });
  const timezone = main.getByRole("textbox", { name: "Timezone" });
  await expect(workspace).toBeVisible();
  const previousName = await workspace.inputValue();
  const previousTimezone = await timezone.inputValue();

  try {
    await workspace.fill("Synthetic test workspace");
    await timezone.fill("Invalid/TestZone");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(main.getByRole("alert")).toContainText("IANA timezone");
    await timezone.fill("Asia/Kolkata");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(main.getByRole("status")).toHaveText("Settings saved.");
    await page.reload();
    await expect(workspace).toHaveValue("Synthetic test workspace");
    await expect(timezone).toHaveValue("Asia/Kolkata");
  } finally {
    await workspace.fill(previousName);
    await timezone.fill(previousTimezone);
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(main.getByRole("status")).toHaveText("Settings saved.");
  }
});
