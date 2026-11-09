import { expect, test } from "@playwright/test";

function syntheticPdf() {
  const content = "BT /F1 14 Tf 50 750 Td (Taylor Example) Tj 0 -20 Td (Skills) Tj 0 -20 Td (Financial modeling) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
    return offset;
  });
  const table = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  pdf += offsets.map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("");
  pdf += "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + table + "\n%%EOF\n";
  return Buffer.from(pdf, "ascii");
}

test("review a synthetic resume, match a job, approve documents and record manual submission", async ({ page }) => {
  test.skip(process.env.APPLYPILOT_E2E_MUTATIONS !== "1", "Run only against a disposable workspace.");
  await page.goto("/profile");
  const main = page.getByRole("main");
  const upload = page.waitForResponse((response) =>
    response.url().endsWith("/api/local/resumes") && response.request().method() === "POST"
  );
  await main.getByLabel("Choose a resume").setInputFiles({
    name: "Synthetic Resume.pdf", mimeType: "application/pdf", buffer: syntheticPdf(),
  });
  const uploaded = await upload;
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  await main.getByRole("button", { name: "Fill empty fields from resume" }).click();
  await expect(main.getByLabel("Full name")).toHaveValue("Taylor Example");
  await expect(main.getByRole("textbox", { name: "Skills", exact: true })).toHaveValue("Financial modeling");
  await main.getByRole("checkbox", { name: /I reviewed these details/ }).check();
  await main.getByRole("button", { name: "Save profile" }).click();
  await expect(main.getByText("Profile saved.", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Discover jobs", exact: true }).click();
  await main.getByLabel("Job title").fill("Synthetic Financial Analyst");
  await main.getByLabel("Company", { exact: true }).fill("Example Company");
  await main.getByLabel("Listing URL").fill("https://jobs.example.test/analyst");
  await main.getByRole("textbox", { name: "Required skills", exact: true }).fill("Financial modeling, SQL");
  await main.getByRole("button", { name: "Import listing" }).click();
  await expect(main.getByText("50/100 match", { exact: true })).toBeVisible();
  await main.getByRole("textbox", { name: "Search name", exact: true }).fill("Synthetic search");
  await main.getByRole("textbox", { name: "Desired titles", exact: true }).fill("Financial Analyst");
  await main.getByText("Match weights and thresholds", { exact: true }).click();
  await main.getByRole("spinbutton", { name: "Role weight", exact: true }).fill("100");
  for (const dimension of ["Required skills", "Experience", "Seniority", "Industry", "Location and arrangement", "Compensation"]) {
    await main.getByRole("spinbutton", { name: dimension + " weight", exact: true }).fill("0");
  }
  await main.getByRole("button", { name: "Save search" }).click();
  await expect(main.getByText("100/100 match · Excellent", { exact: true })).toBeVisible();
  await main.getByRole("combobox", { name: "View", exact: true }).selectOption("recommended");
  await expect(main.getByText(/at least 20% evidence coverage/)).toBeVisible();
  await main.getByRole("button", { name: "Prepare application" }).click();

  await main.getByRole("button", { name: "Prepare documents" }).click();
  await expect(main.getByRole("textbox", { name: "Tailored resume", exact: true })).toHaveValue(/Financial modeling/);
  await expect(main.getByRole("textbox", { name: "Tailored resume", exact: true })).not.toHaveValue(/SQL/);
  const download = page.waitForEvent("download");
  await main.getByRole("link", { name: "Resume PDF", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/application-\d+-resume\.pdf/);

  await main.getByRole("button", { name: "Add a screening question" }).click();
  await main.getByRole("textbox", { name: "Question", exact: true }).fill("Why are you interested?");
  await main.getByRole("button", { name: "Draft from profile" }).click();
  await expect(main.getByRole("textbox", { name: "Answer", exact: true })).toHaveValue(/Financial modeling/);
  await main.getByRole("button", { name: "Save package edits" }).click();
  await expect(main.getByText("Package saved for review.", { exact: true })).toBeVisible();

  const approve = main.getByRole("button", { name: "Approve for manual completion" });
  await expect(approve).toBeDisabled();
  await main.getByRole("checkbox", { name: /I reviewed the saved package/ }).check();
  await approve.click();
  await expect(main.getByRole("link", { name: /Open employer site/ })).toHaveAttribute(
    "href", "https://jobs.example.test/analyst",
  );

  await main.getByRole("combobox", { name: "Status", exact: true }).selectOption("Applied");
  await main.getByRole("button", { name: "Save tracking" }).click();
  await expect(main.getByRole("alert")).toContainText("personally submitted");
  const monthResponse = await page.request.get("/api/local/application-calendar");
  expect(monthResponse.ok()).toBe(true);
  const { month } = await monthResponse.json();
  await main.getByLabel("Follow-up date", { exact: true }).fill(month + "-15");
  await main.getByRole("checkbox", { name: /I personally submitted/ }).check();
  await main.getByRole("button", { name: "Save tracking" }).click();
  await expect(main.getByText(/1 submitted · 0 interviews/)).toBeVisible();
  await main.getByRole("combobox", { name: "Tracker view", exact: true }).selectOption("calendar");
  const calendar = main.getByRole("table", { name: /application calendar/ });
  await expect(calendar.getByRole("button", { name: /Follow-up for Synthetic Financial Analyst/ })).toBeVisible();
  await main.getByRole("button", { name: "Next month" }).click();
  await expect(main.getByText("No interviews or follow-ups in this month.")).toBeVisible();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const backup = page.waitForEvent("download");
  await main.getByRole("link", { name: "Download workspace backup" }).click();
  expect((await backup).suggestedFilename()).toBe("applypilot-backup.sqlite3");
});
