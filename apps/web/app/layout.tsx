import type { ReactNode } from "react";

export const metadata = {
  title: "Test Case Intelligence",
  description: "Quality intelligence & test case management",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <nav style={{ display: "flex", gap: 16, padding: "12px 24px", borderBottom: "1px solid #e5e5e5" }}>
          <a href="/">Test Case Intelligence</a>
          <a href="/test-cases">Test Cases</a>
          <a href="/reverse-engineer">Reverse Engineer</a>
          <a href="/login" style={{ marginLeft: "auto" }}>
            Log in
          </a>
        </nav>
        <main style={{ padding: 24 }}>{children}</main>
      </body>
    </html>
  );
}
