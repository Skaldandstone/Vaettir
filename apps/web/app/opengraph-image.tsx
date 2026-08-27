import { ImageResponse } from "next/og";

// Social-card image (og:image / twitter:image), auto-linked by Next from
// this file's convention name -- no metadata changes needed elsewhere.
// Uses a generic serif fallback rather than fetching Fraunces at build
// time: keeps this route free of an external network dependency during
// the Docker build. Swap in a vendored Fraunces .ttf via next/og's local
// font loading if exact-face fidelity is wanted later.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          background: "#26211B",
        }}
      >
        <svg width="96" height="96" viewBox="0 0 40 40" fill="none">
          <line x1="20" y1="4" x2="20" y2="36" stroke="#8FA37A" strokeWidth="6" strokeLinecap="round" />
          <line x1="20" y1="14" x2="34" y2="4" stroke="#8FA37A" strokeWidth="6" strokeLinecap="round" />
          <line x1="20" y1="14" x2="6" y2="4" stroke="#8FA37A" strokeWidth="6" strokeLinecap="round" />
          <line x1="20" y1="24" x2="34" y2="34" stroke="#8FA37A" strokeWidth="6" strokeLinecap="round" />
          <line x1="20" y1="24" x2="6" y2="34" stroke="#8FA37A" strokeWidth="6" strokeLinecap="round" />
        </svg>
        <div style={{ display: "flex", fontSize: 76, fontFamily: "serif", color: "#F3ECDF" }}>vaettir</div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#B8A88D",
            fontFamily: "monospace",
          }}
        >
          Every place has its guardians. So does your codebase.
        </div>
      </div>
    ),
    { ...size },
  );
}
