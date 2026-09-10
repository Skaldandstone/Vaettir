import type { ReactNode } from "react";
import Link from "next/link";
import { ClerkProvider } from "@clerk/nextjs";
import { RuneMark } from "../components/RuneMark";
import { ThemeToggle } from "../components/ThemeToggle";
import { Sidebar } from "../components/Sidebar";
import { NavAuth } from "../components/NavAuth";
import { TRPCReactProvider } from "../lib/trpcReact";
import "./globals.css";

export const metadata = {
  title: "Vaettir™",
  description: "Every place has its guardians. So does your codebase.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#8fa37a",
          colorBackground: "#2e2820",
          colorForeground: "#f3ecdf",
          colorInputForeground: "#f3ecdf",
          borderRadius: "3px",
          fontFamily: "Inter, sans-serif",
        },
      }}
    >
      <html lang="en">
        <body>
        <TRPCReactProvider>
          <nav className="app-nav">
            <div className="app-nav-inner">
              <Link href="/" className="brand">
                <RuneMark />
                Vaettir™
              </Link>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                <ThemeToggle />
                <NavAuth />
              </div>
            </div>
          </nav>
          <div className="app-shell">
            <Sidebar />
            <main className="app-main">{children}</main>
          </div>
          <footer style={{ padding: "20px 24px", borderTop: "1px solid var(--border)", fontSize: 14, lineHeight: 1.6 }}>
            <p>© 2026 Skald and Stone LLC</p>
            <details><summary style={{ cursor: "pointer", paddingBlock: 12 }}>About copyright</summary><p>Original Vaettir software and studio content. Customer content, third-party material, and existing software licenses retain their own rights.</p></details>
          </footer>
        </TRPCReactProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
