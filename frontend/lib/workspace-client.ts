export async function request<T>(resource: string, init?: RequestInit): Promise<T> {
  const response = await fetch("/api/local/" + resource, init);
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "Check the fields and try again.");
  return result as T;
}

export function jsonRequest<T>(resource: string, method: "POST" | "PUT", body: unknown) {
  return request<T>(resource, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
