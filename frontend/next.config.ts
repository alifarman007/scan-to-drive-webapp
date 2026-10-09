import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// The browser only talks to this Next.js server. Calls to /api/... are passed on to FastAPI,
// so there is no CORS to set up and the backend address never reaches the phone.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false, // do not write AGENTS.md / CLAUDE.md into the project
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default createNextIntlPlugin()(nextConfig);
