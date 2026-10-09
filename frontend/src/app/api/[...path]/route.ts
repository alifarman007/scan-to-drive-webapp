/**
 * Passes every /api/... call from the browser on to FastAPI (BACKEND_URL), like a small reverse proxy.
 *
 * Why not a rewrite in next.config: a rewrite does not forward the caller's IP address (the audit log would show
 * 127.0.0.1 for every phone), and its target is fixed when the app is built. Here the address is read when the
 * server starts, and X-Forwarded-For carries the real client IP (FastAPI/uvicorn trusts it from 127.0.0.1).
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_URL = (process.env.BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

// Hop-by-hop headers and ones fetch sets itself.
const SKIP_REQUEST = new Set(["host", "connection", "content-length", "keep-alive", "transfer-encoding", "upgrade"]);
const SKIP_RESPONSE = new Set(["connection", "content-encoding", "content-length", "keep-alive", "transfer-encoding"]);

async function forward(req: NextRequest): Promise<Response> {
  const target = `${BACKEND_URL}${req.nextUrl.pathname}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!SKIP_REQUEST.has(key.toLowerCase())) headers.set(key, value);
  });
  // Next.js fills x-forwarded-for with the caller's address (or keeps the one Nginx set in production).
  headers.set("x-forwarded-proto", req.nextUrl.protocol.replace(":", ""));
  const host = req.headers.get("host");
  if (host) headers.set("x-forwarded-host", host);

  const hasBody = !["GET", "HEAD"].includes(req.method);
  let res: Response;
  try {
    res = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { detail: { code: "BACKEND_DOWN", message: "The server is not reachable. Is the backend running?" } },
      { status: 502 },
    );
  }

  const out = new Headers();
  res.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (!SKIP_RESPONSE.has(k) && k !== "set-cookie") out.set(key, value);
  });
  for (const cookie of res.headers.getSetCookie()) out.append("set-cookie", cookie); // sign-in and sign-out cookies
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const HEAD = forward;
export const OPTIONS = forward;
