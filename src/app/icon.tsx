import { ImageResponse } from "next/og";

/**
 * PWA/app icon generated at request time (no binary assets to maintain).
 * Served at /icon and referenced from manifest.webmanifest (512×512, declared
 * for both `any` and `maskable` — the mark sits well inside the safe zone).
 *
 * The mark is drawn with pure div shapes, deliberately: a text ₹ glyph needs
 * a dynamic font subset download at build time, which fails offline/restricted
 * builds and renders a tofu box. Shapes are dependency-free and identical
 * everywhere. A white ledger book with a spine and entry lines on the brand
 * gradient.
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
        }}
      >
        {/* ledger book */}
        <div
          style={{
            width: 264,
            height: 320,
            display: "flex",
            borderRadius: 28,
            background: "#ffffff",
            boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
          }}
        >
          {/* spine */}
          <div
            style={{
              width: 44,
              height: "100%",
              display: "flex",
              borderRadius: "28px 0 0 28px",
              background: "#0f766e",
            }}
          />
          {/* entry lines */}
          <div
            style={{
              flex: 1,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "0 40px 0 32px",
            }}
          >
            {["100%", "72%", "86%", "56%"].map((w, i) => (
              <div
                key={i}
                style={{
                  width: w,
                  height: 22,
                  borderRadius: 11,
                  background: i === 1 ? "#14b8a6" : "#99f6e4",
                  marginTop: i === 0 ? 0 : 34,
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
