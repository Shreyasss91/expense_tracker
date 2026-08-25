import { ImageResponse } from "next/og";

/**
 * iOS home-screen icon (apple-touch-icon), same shape-built ledger mark as
 * /icon — pure divs, no font glyph (a text ₹ needs a build-time font download
 * that fails on restricted networks and renders a tofu box).
 */
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
        }}
      >
        <div
          style={{
            width: 93,
            height: 113,
            display: "flex",
            borderRadius: 10,
            background: "#ffffff",
          }}
        >
          <div
            style={{
              width: 15,
              height: "100%",
              display: "flex",
              borderRadius: "10px 0 0 10px",
              background: "#0f766e",
            }}
          />
          <div
            style={{
              flex: 1,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "0 14px 0 11px",
            }}
          >
            {["100%", "72%", "86%", "56%"].map((w, i) => (
              <div
                key={i}
                style={{
                  width: w,
                  height: 8,
                  borderRadius: 4,
                  background: i === 1 ? "#14b8a6" : "#99f6e4",
                  marginTop: i === 0 ? 0 : 12,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
