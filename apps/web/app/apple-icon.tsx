import { ImageResponse } from "next/og";

// Next.js file convention: this route is auto-served as the app's
// apple-touch-icon (no <link> tag or layout.tsx change needed). Square, no
// border-radius -- iOS applies its own corner mask on home-screen icons, so
// a pre-rounded background would double up.
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
          background: "#26211B",
        }}
      >
        <svg width="108" height="108" viewBox="0 0 40 40" fill="none">
          <line x1="20" y1="4" x2="20" y2="36" stroke="#8FA37A" strokeWidth="6" strokeLinecap="round" />
          <line x1="20" y1="14" x2="34" y2="4" stroke="#8FA37A" strokeWidth="6" strokeLinecap="round" />
          <line x1="20" y1="14" x2="6" y2="4" stroke="#8FA37A" strokeWidth="6" strokeLinecap="round" />
          <line x1="20" y1="24" x2="34" y2="34" stroke="#8FA37A" strokeWidth="6" strokeLinecap="round" />
          <line x1="20" y1="24" x2="6" y2="34" stroke="#8FA37A" strokeWidth="6" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
