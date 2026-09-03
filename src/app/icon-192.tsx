import { ImageResponse } from "next/og";

/**
 * §3.5 — 192px PNG companion to /icon (src/app/icon.tsx). Chromium's
 * installability heuristics want a ≥192px icon; some Android surfaces
 * specifically request 192 and fell back to a blurry upscale when only 512
 * was declared. Same art, drawn at 192 — dimensions scale proportionally
 * (512→192 = ×0.375) so the mark is pixel-identical at both sizes.
 */
export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon192() {
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
        {/* ledger book — 264×320 at 512 → ×0.375 = 99×120 */}
        <div
          style={{
            width: 99,
            height: 120,
            display: "flex",
            borderRadius: 10,
            background: "#ffffff",
            boxShadow: "0 7px 15px rgba(0,0,0,0.22)",
          }}
        >
          {/* spine — 44 → 16 */}
          <div
            style={{
              width: 16,
              height: "100%",
              display: "flex",
              borderRadius: "10px 0 0 10px",
              background: "#0f766e",
            }}
          />
          {/* entry lines — height 22→8, gaps 34→13, padding 40→15 / 32→12 */}
          <div
            style={{
              flex: 1,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "0 15px 0 12px",
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
                  marginTop: i === 0 ? 0 : 13,
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
