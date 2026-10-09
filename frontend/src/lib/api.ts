/**
 * Browser-side calls to the backend. Everything goes to /api/... on this same address (Next.js passes it on to
 * FastAPI), so the session cookie is sent automatically. Every call carries the X-S2D header that the backend
 * asks for on changes (it stops other websites from making requests in the user's name).
 */

export type ApiErrorDetail = { code?: string; message?: string; [key: string]: unknown };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: ApiErrorDetail;

  constructor(status: number, code: string, message: string, detail: ApiErrorDetail = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** Status 0 = the request never reached the server (no Wi-Fi, server down). */
export const NETWORK_ERROR = "NETWORK";

type Options = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  json?: unknown;
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
};

function codeFor(status: number): string {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 422) return "INVALID";
  if (status === 429) return "TOO_MANY_TRIES";
  return status >= 500 ? "SERVER_ERROR" : `HTTP_${status}`;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "X-S2D": "1" };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  const qs = opts.query
    ? "?" +
      new URLSearchParams(
        Object.entries(opts.query)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";

  let res: Response;
  try {
    res = await fetch(`/api${path}${qs}`, {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, NETWORK_ERROR, "No connection");
  }

  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    // FastAPI errors: {"detail": "text"} or {"detail": {"code": ..., "message": ...}} or a 422 list
    const raw = (data as { detail?: unknown } | null)?.detail;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const d = raw as ApiErrorDetail;
      throw new ApiError(res.status, d.code ?? codeFor(res.status), d.message ?? "", d);
    }
    throw new ApiError(res.status, codeFor(res.status), typeof raw === "string" ? raw : "");
  }
  return data as T;
}

/** Only allow going back to a page on this site (blocks "?next=https://evil.example"). */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
