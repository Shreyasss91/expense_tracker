import { ImageResponse } from "next/og";

/** UX pass — iOS home-screen icon (apple-touch-icon), same design as /icon. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 120,
          fontWeight: 700,
        }}
      >
        ₹
      </div>
    ),
    { ...size },
  );
}
