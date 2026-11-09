import { settingsSchema } from "./settings";

const maxResumeBytes = 8 * 1024 * 1024;
const routes: Record<string, { path: string; methods: string[]; limit?: number }> = {
  overview: { path: "/api/v1/overview", methods: ["GET"] },
  status: { path: "/health/ready", methods: ["GET"] },
  settings: { path: "/api/v1/settings", methods: ["GET", "PUT"], limit: 2048 },
  profile: { path: "/api/v1/profile", methods: ["GET", "PUT"], limit: 220_000 },
  "data-backup": { path: "/api/v1/data/backup", methods: ["GET"] },
  "data-delete": { path: "/api/v1/data/delete", methods: ["POST"], limit: 2048 },
  automation: { path: "/api/v1/automation", methods: ["GET", "PUT"], limit: 16000 },
  "automation-run": { path: "/api/v1/automation/run", methods: ["POST"], limit: 2048 },
  "notification-head": { path: "/api/v1/automation/notifications/latest", methods: ["GET"] },
  "notification-read": { path: "/api/v1/automation/notifications", methods: ["PUT"], limit: 2048 },
  applications: { path: "/api/v1/applications", methods: ["GET", "POST"], limit: 2048 },
  "application-calendar": { path: "/api/v1/applications/calendar", methods: ["GET"] },
  "application-detail": { path: "/api/v1/applications", methods: ["GET"] },
  "application-document": { path: "/api/v1/applications", methods: ["GET"] },
  "application-prepare": { path: "/api/v1/applications/prepare", methods: ["POST"], limit: 2048 },
  "application-package": { path: "/api/v1/applications/package", methods: ["PUT"], limit: 560000 },
  "application-approve": { path: "/api/v1/applications/approve", methods: ["POST"], limit: 2048 },
  "application-tracking": { path: "/api/v1/applications/tracking", methods: ["PUT"], limit: 28000 },
  "application-screening": { path: "/api/v1/applications/screening", methods: ["POST"], limit: 8192 },
  "application-answer": { path: "/api/v1/applications/answers", methods: ["PUT"], limit: 18000 },
  jobs: { path: "/api/v1/jobs", methods: ["GET", "POST"], limit: 140000 },
  "job-shortlist": { path: "/api/v1/jobs/shortlist", methods: ["PUT"], limit: 2048 },
  "job-searches": { path: "/api/v1/jobs/searches", methods: ["PUT"], limit: 30000 },
  "job-feed": { path: "/api/v1/jobs/feed", methods: ["POST"], limit: 8192 },
  providers: { path: "/api/v1/providers", methods: ["GET", "PUT"], limit: 24000 },
  "provider-check": { path: "/api/v1/providers/check", methods: ["POST"], limit: 2048 },
  "provider-delete": { path: "/api/v1/providers/delete", methods: ["POST"], limit: 2048 },
  "provider-models": { path: "/api/v1/providers/models", methods: ["POST"], limit: 2048 },
  "provider-routing": { path: "/api/v1/providers/routes", methods: ["PUT"], limit: 2048 },
  resumes: { path: "/api/v1/resumes", methods: ["POST"], limit: maxResumeBytes },
  "profile-history": { path: "/api/v1/profile", methods: ["GET"] },
  "resume-detail": { path: "/api/v1/resumes", methods: ["GET"] },
  "resume-original": { path: "/api/v1/resumes", methods: ["GET"] },
};

function respond(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function localApi(request: Request, resource: string): Promise<Response> {
  const origin = new URL(process.env.APPLYPILOT_ORIGIN ?? "http://localhost:3000");
  const incomingOrigin = request.headers.get("origin");
  if (
    request.headers.get("host") !== origin.host ||
    (incomingOrigin !== null && incomingOrigin !== origin.origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return respond({ detail: "Open ApplyPilot from its configured local address." }, 403);
  }

  const route = Object.hasOwn(routes, resource) ? routes[resource] : undefined;
  if (!route) return respond({ detail: "Unknown workspace resource." }, 404);
  if (!route.methods.includes(request.method)) return respond({ detail: "Method unavailable." }, 405);

  let path = route.path;
  if (["resume-detail", "resume-original", "profile-history", "application-detail", "application-document"].includes(resource)) {
    const id = new URL(request.url).searchParams.get("id");
    if (!id || !/^[1-9][0-9]{0,8}$/.test(id)) return respond({ detail: "Invalid record ID." }, 400);
    path += "/" + id + (resource === "resume-original" ? "/original" : "");
  }

  if (resource === "application-document") {
    const query = new URL(request.url).searchParams;
    const kind = query.get("kind");
    const format = query.get("format");
    if (!kind || !["resume", "letter"].includes(kind) || !format || !["docx", "pdf"].includes(format)) {
      return respond({ detail: "Invalid document type." }, 400);
    }
    path += "/document/" + kind + "/" + format;
  }

  if (resource === "jobs" && request.method === "GET") {
    const query = new URL(request.url).searchParams;
    const params = new URLSearchParams();
    for (const key of ["page", "search"]) {
      const value = query.get(key);
      if (value && /^[1-9][0-9]{0,8}$/.test(value)) params.set(key, value);
    }
    const view = query.get("view");
    if (view && ["all", "recommended", "saved"].includes(view)) params.set("view", view);
    if (params.size) path += "?" + params.toString();
  }

  if (resource === "applications" && request.method === "GET") {
    const page = new URL(request.url).searchParams.get("page");
    if (page && /^[1-9][0-9]{0,4}$/.test(page)) path += "?page=" + page;
  }
  if (resource === "application-calendar") {
    const month = new URL(request.url).searchParams.get("month");
    if (month && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) path += "?month=" + month;
  }

  let body: string | Uint8Array<ArrayBuffer> | undefined;
  let headers: Record<string, string> | undefined;
  if (request.method !== "GET") {
    if (incomingOrigin !== origin.origin) return respond({ detail: "Same-origin request required." }, 403);
    const contentType = request.headers.get("content-type")?.split(";")[0] ?? "";
    if (resource === "resumes") {
      const filename = request.headers.get("x-applypilot-filename");
      if (!filename || filename.length > 2160 || ![
        "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(contentType)) {
        return respond({ detail: "Choose a PDF or DOCX resume." }, 415);
      }
      headers = { "Content-Type": contentType, "X-ApplyPilot-Local": resource, "X-ApplyPilot-Filename": filename };
    } else {
      if (contentType !== "application/json") return respond({ detail: "JSON request required." }, 415);
      headers = { "Content-Type": contentType, "X-ApplyPilot-Local": resource };
    }
    try {
      const bytes = await readBody(request, route.limit ?? 0);
      if (bytes === null) return respond({ detail: "Request is too large." }, 413);
      if (resource === "settings") {
        const parsed = settingsSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
        if (!parsed.success) return respond({ detail: "Enter a workspace name and timezone." }, 422);
        body = JSON.stringify(parsed.data);
      } else {
        body = bytes;
      }
    } catch {
      return respond({ detail: "Could not read request." }, 400);
    }
  }

  const upstream = process.env.APPLYPILOT_BACKEND_URL ?? "http://127.0.0.1:8000";
  try {
    const response = await fetch(new URL(path, upstream), {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(resource === "data-backup" ? 60000 : resource === "application-prepare" ? 65000 :
        ["resumes", "provider-check", "provider-models", "job-feed"].includes(resource) ? 28000 : 5000),
    });
    if (response.ok && ["resume-original", "application-document", "data-backup"].includes(resource)) {
      return new Response(response.body, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": response.headers.get("content-disposition") ?? "attachment",
          "Cache-Control": "no-store",
        },
      });
    }
    return respond(await response.json(), response.status);
  } catch {
    return respond({ detail: "The local API is unavailable. Check that the backend is running." }, 503);
  }
}
