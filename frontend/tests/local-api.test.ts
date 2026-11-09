import { afterEach, describe, expect, it, vi } from "vitest";
import { localApi } from "../lib/local-api";

const origin = "http://localhost:3000";
const url = origin + "/api/local/settings";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("workspace API bridge", () => {
  it("rejects an untrusted host", async () => {
    const response = await localApi(new Request(url, { headers: { host: "other.test" } }), "settings");
    expect(response.status).toBe(403);
  });

  it.each([undefined, "https://attacker.test"])("rejects a mutation with origin %s", async (source) => {
    const headers = new Headers({ host: "localhost:3000" });
    if (source) headers.set("origin", source);
    const response = await localApi(new Request(url, { method: "PUT", headers }), "settings");
    expect(response.status).toBe(403);
  });

  it("rejects unknown resources", async () => {
    const request = new Request(url, { headers: { host: "localhost:3000" } });
    expect((await localApi(request, "proxy")).status).toBe(404);
  });

  it("limits the settings body by bytes", async () => {
    const request = new Request(url, {
      method: "PUT",
      headers: { host: "localhost:3000", origin, "content-type": "application/json" },
      body: JSON.stringify({ workspace_name: "✓".repeat(750), timezone: "UTC" }),
    });
    expect((await localApi(request, "settings")).status).toBe(413);
  });

  it("passes normalized settings without forwarding arbitrary headers", async () => {
    vi.stubEnv("APPLYPILOT_ORIGIN", origin);
    vi.stubEnv("APPLYPILOT_BACKEND_URL", "http://127.0.0.1:8000");
    const settings = { workspace_name: "My workspace", timezone: "UTC" };
    const upstream = vi.fn().mockResolvedValue(Response.json(settings));
    vi.stubGlobal("fetch", upstream);
    const response = await localApi(new Request(url, {
      method: "PUT",
      headers: { host: "localhost:3000", origin, "content-type": "application/json", cookie: "private" },
      body: JSON.stringify({ ...settings, workspace_name: " My workspace " }),
    }), "settings");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(settings);
    expect(upstream).toHaveBeenCalledWith(new URL("http://127.0.0.1:8000/api/v1/settings"), expect.objectContaining({
      headers: { "Content-Type": "application/json", "X-ApplyPilot-Local": "settings" },
      body: JSON.stringify(settings),
      redirect: "error",
    }));
  });
});
