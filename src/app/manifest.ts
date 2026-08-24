import type { MetadataRoute } from "next";

/**
 * UX pass — PWA installability. Next serves this at /manifest.webmanifest and
 * injects the <link rel="manifest"> automatically. Icons point at the
 * ImageResponse routes (src/app/icon.tsx, src/app/apple-icon.tsx) so we get
 * real PNGs without shipping binary assets.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Ledger",
    short_name: "Ledger",
    description: "High-speed expense tracking for the family — bills, lifestyle and one-time buys at a glance.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#171717",
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png" },
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
