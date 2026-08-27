import type { MetadataRoute } from "next";

// Web app manifest (PWA / "add to home screen" metadata) -- auto-linked by
// Next from this file's convention name. References the icon routes
// defined in icon.svg and apple-icon.tsx, which Next serves at /icon.svg
// and /apple-icon.png respectively.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "vaettir",
    short_name: "vaettir",
    description: "Every place has its guardians. So does your codebase.",
    start_url: "/",
    display: "standalone",
    background_color: "#26211B",
    theme_color: "#26211B",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
