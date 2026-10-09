import { cookies } from "next/headers";

// Server-side calls (pages that check the session before showing anything). The browser's cookies are passed on.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export async function serverGet<T>(path: string): Promise<{ status: number; data: T | null }> {
  const jar = await cookies();
  const cookie = jar
    .getAll()
    .filter((c) => c.name.startsWith("s2d_"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  try {
    const res = await fetch(`${BACKEND_URL}/api${path}`, {
      headers: { Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      cache: "no-store",
    });
    return { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
  } catch {
    return { status: 0, data: null }; // backend not running
  }
}

export type SessionDriver = { kind: "driver"; id: number; employee_id: string; name: string };

/** The signed-in driver (null: no cookie, expired or deactivated). `offline`: the backend did not answer. */
export async function getDriverSession(): Promise<{ driver: SessionDriver | null; offline: boolean }> {
  const jar = await cookies();
  if (!jar.get("s2d_driver")) return { driver: null, offline: false };
  const { status, data } = await serverGet<SessionDriver>("/auth/driver/me");
  return { driver: data, offline: status === 0 || status >= 500 };
}
