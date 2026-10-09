import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// The browser only talks to this Next.js server. Calls to /api/... are passed on to FastAPI by
// src/app/api/[...path]/route.ts, so there is no CORS to set up, the session cookie stays on one address,
// and the backend can stay on 127.0.0.1 (not reachable from the network). Phones only need the frontend address.

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false, // do not write AGENTS.md / CLAUDE.md into the project
  // Development only: let phones on the same Wi-Fi load the dev server through the laptop's address
  // (home and office networks: 192.168.x.x, 10.x.x.x, 172.16-31.x.x, plus the addresses `npm run dev:lan` found).
  allowedDevOrigins: [
    "192.168.*.*",
    "10.*.*.*",
    "172.*.*.*",
    ...(process.env.S2D_LAN_HOSTS ?? "").split(",").filter(Boolean),
  ],
  devIndicators: false, // the floating "N" button covered the sign-out button on phones
};

export default createNextIntlPlugin()(nextConfig);
