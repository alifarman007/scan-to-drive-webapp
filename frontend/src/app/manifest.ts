import type { MetadataRoute } from "next";

/**
 * "Add to Home screen": the app opens like an installed app (no browser bar), starting on the driver's page.
 * Drivers mostly come in through a car's QR sticker, but a home-screen icon gets them to "Scan car QR" in one tap.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scan-to-Drive · Epic Group",
    short_name: "Scan-to-Drive",
    description: "Company car trips, logged with a scan.",
    start_url: "/driver",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1c2e6f",
    theme_color: "#1c2e6f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
