// Start the dev server for testing on phones in the same Wi-Fi, and print the address to open on them
// (also as a QR code you can scan with the phone camera).
//   npm run dev:lan                 -> http://<laptop-ip>:3000
//   npm run dev:lan:https           -> https://<laptop-ip>:3000 (needed on phones for the camera scanner and GPS)
//   npm run dev:lan -- 3001         -> another port
//
// HTTPS uses a self-signed certificate made here for this laptop's addresses (kept in .certs/, never committed).
// Phones show a one-time warning for it; see the README ("Testing on phones").
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import QRCode from "qrcode";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const https = args.includes("--https");
const port = Number(args.find((a) => /^\d+$/.test(a)) ?? process.env.PORT ?? 3000);

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

/** Make (or reuse) a certificate valid for localhost and every current LAN address. */
async function ensureCertificate(ips) {
  const dir = path.resolve(".certs");
  const keyFile = path.join(dir, "dev-key.pem");
  const certFile = path.join(dir, "dev-cert.pem");
  const hostsFile = path.join(dir, "hosts.txt");
  const hosts = ["localhost", "127.0.0.1", ...ips].join(",");
  const fresh =
    fs.existsSync(keyFile) &&
    fs.existsSync(certFile) &&
    fs.existsSync(hostsFile) &&
    fs.readFileSync(hostsFile, "utf8") === hosts &&
    Date.now() - fs.statSync(certFile).mtimeMs < 300 * 24 * 3600 * 1000;
  if (!fresh) {
    const selfsigned = require("selfsigned");
    const notAfter = new Date(Date.now() + 397 * 24 * 3600 * 1000); // phones refuse certificates longer than ~13 months
    const pems = await selfsigned.generate([{ name: "commonName", value: "Scan-to-Drive dev" }], {
      keySize: 2048,
      notAfterDate: notAfter,
      algorithm: "sha256",
      extensions: [
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
        { name: "extKeyUsage", serverAuth: true },
        {
          name: "subjectAltName",
          altNames: [
            { type: 2, value: "localhost" },
            { type: 7, ip: "127.0.0.1" },
            ...ips.map((ip) => ({ type: 7, ip })),
          ],
        },
      ],
    });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyFile, pems.private);
    fs.writeFileSync(certFile, pems.cert);
    fs.writeFileSync(hostsFile, hosts);
    console.log(`  Made a new development certificate for: ${hosts.replaceAll(",", ", ")}`);
  }
  return { keyFile, certFile };
}

const addrs = lanAddresses();
const scheme = https ? "https" : "http";
console.log(`\n  Scan-to-Drive, development server for phones (${scheme})\n`);
console.log(`  On this laptop:   ${scheme}://localhost:${port}`);
if (addrs.length === 0) {
  console.log("  No Wi-Fi / LAN address found. Connect the laptop to the same Wi-Fi as the phones.\n");
} else {
  for (const a of addrs) console.log(`  On the phones:    ${scheme}://${a.ip}:${port}    (${a.name})`);
  const main = `${scheme}://${addrs[0].ip}:${port}`;
  console.log(`\n  Scan with a phone camera to open ${main}:\n`);
  console.log(await QRCode.toString(main, { type: "terminal", small: true }));
  console.log(`  Car and passenger QR codes point to PUBLIC_BASE_URL in backend/.env.`);
  console.log(`  For phone tests set it to ${main} and restart the backend.`);
  if (https) {
    console.log(`  First visit on each phone: the browser warns about the certificate.`);
    console.log(`  Tap "Advanced" then "Proceed" (Android) or "Show details" then "visit this website" (iPhone).`);
  }
  console.log("");
}

const nextArgs = ["dev", "--hostname", "0.0.0.0", "--port", String(port)];
if (https) {
  const { keyFile, certFile } = await ensureCertificate(addrs.map((a) => a.ip));
  nextArgs.push("--experimental-https", "--experimental-https-key", keyFile, "--experimental-https-cert", certFile);
}

const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  stdio: "inherit",
  // next.config.ts adds these to allowedDevOrigins, so live reload also works on the phones
  env: { ...process.env, S2D_LAN_HOSTS: addrs.map((a) => a.ip).join(",") },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
