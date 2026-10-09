// Start the dev server for testing on phones in the same Wi-Fi, and print the address to open on them
// (also as a QR code you can scan with the phone camera).
//   npm run dev:lan            -> port 3000
//   npm run dev:lan -- 3001    -> another port
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";

import QRCode from "qrcode";

const require = createRequire(import.meta.url);
const port = Number(process.argv[2] ?? process.env.PORT ?? 3000);

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      // skip virtual adapters (WSL, Hyper-V, VirtualBox, Docker) when we can tell
      if (/vethernet|virtualbox|vmware|docker|wsl|hyper-v/i.test(name)) continue;
      out.push({ name, ip: a.address });
    }
  }
  // home and office Wi-Fi first
  const rank = (ip) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2);
  return out.sort((x, y) => rank(x.ip) - rank(y.ip));
}

const addrs = lanAddresses();
console.log("\n  Scan-to-Drive, development server for phones\n");
console.log(`  On this laptop:   http://localhost:${port}`);
if (addrs.length === 0) {
  console.log("  No Wi-Fi / LAN address found. Connect the laptop to the same Wi-Fi as the phones.\n");
} else {
  for (const a of addrs) console.log(`  On the phones:    http://${a.ip}:${port}    (${a.name})`);
  const main = `http://${addrs[0].ip}:${port}`;
  console.log(`\n  Scan with a phone camera to open ${main}:\n`);
  console.log(await QRCode.toString(main, { type: "terminal", small: true }));
  console.log(`  Car and passenger QR codes point to PUBLIC_BASE_URL in backend/.env.`);
  console.log(`  For phone tests set it to ${main} and restart the backend.\n`);
}

const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", "--hostname", "0.0.0.0", "--port", String(port)], {
  stdio: "inherit",
  // next.config.ts adds these to allowedDevOrigins, so live reload also works on the phones
  env: { ...process.env, S2D_LAN_HOSTS: addrs.map((a) => a.ip).join(",") },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
