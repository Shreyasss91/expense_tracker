import { ImageResponse } from "next/og";

/**
 * UX pass — PWA/app icon generated at request time (no binary assets to
 * maintain). Served at /icon and referenced from manifest.webmanifest.
 */
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #059669 0%, #0d9488 100%)",
          color: "#ffffff",
          fontSize: 340,
          fontWeight: 700,
        }}
      >
        ₹
      </div>
    ),
    { ...size },
  );
}
