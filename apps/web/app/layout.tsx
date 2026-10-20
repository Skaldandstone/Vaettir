import type { ReactNode } from "react";
import Link from "next/link";
import { ClerkProvider } from "@clerk/nextjs";
import { headers } from "next/headers";
import { workspaceClerkConfiguration } from "../lib/clerk-auth-domain";
import { RuneMark } from "../components/RuneMark";
import { ThemeToggle } from "../components/ThemeToggle";
import { Sidebar } from "../components/Sidebar";
import { NavAuth } from "../components/NavAuth";
import { TRPCReactProvider } from "../lib/trpcReact";
import { Suspense } from "react";
import { LegacyWorkspaceRedirect } from "../components/LegacyWorkspaceRedirect";
import "./globals.css";
import "./workbench.css";

export const metadata = {
  title: "Vaettir™",
  description: "Every place has its guardians. So does your codebase.",
};

// Ported 2026-09-11 from codex/private-beta-readiness (the B2B interface
// direction in STYLE_GUIDE.md, "Application UI direction"): light default
// theme with a graphite dark theme, Clerk styled from the same tokens, a
// skip link, and the product label in the nav. NavAuth (Clerk v7) and the
// react-query provider are main's and stay.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const workspaceAuth = process.env.NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED === "1";
  const host = workspaceAuth ? (await headers()).get("x-vaettir-host") : null;
  const workspaceClerk = workspaceAuth ? workspaceClerkConfiguration(host,
    process.env.NEXT_PUBLIC_VAETTIR_PRIMARY_AUTH_ENABLED === "1",
    process.env.NEXT_PUBLIC_VAETTIR_ACTIVE_WORKSPACE_NAMES) : {};
  return (
    <ClerkProvider
      {...workspaceClerk}
      appearance={{
        variables: {
          colorPrimary: "var(--frost)",
          colorBackground: "var(--panel)",
          colorForeground: "var(--fg)",
          colorMutedForeground: "var(--muted)",
          colorPrimaryForeground: "var(--on-accent)",
          colorInput: "var(--panel)",
          colorInputForeground: "var(--fg)",
          colorDanger: "var(--ember)",
          borderRadius: "6px",
          fontFamily: "Inter, sans-serif",
        },
      }}
    >
      <html lang="en" data-theme="dark" suppressHydrationWarning>
        <body>
          <TRPCReactProvider>
            <Suspense><LegacyWorkspaceRedirect /></Suspense>
            <a className="skip-link" href="#main-content">
              Skip to content
            </a>
            <nav className="app-nav">
              <div className="app-nav-inner">
                <Link href="/" className="brand">
                  <RuneMark />
                  Vaettir<span className="tm">™</span>
                </Link>
                <span className="nav-product-label">
                  Quality intelligence <span>Private beta</span>
                </span>
                <div className="nav-account-actions">
                  <ThemeToggle />
                  <NavAuth />
                </div>
              </div>
            </nav>
            <div className="app-shell">
              <Sidebar />
              <main id="main-content" className="app-main" tabIndex={-1}>
                {children}
              </main>
            </div>
            <footer className="app-footer">
              <p>© 2026 Skald and Stone LLC</p>
              <details>
                <summary style={{ cursor: "pointer", paddingBlock: 12 }}>About copyright</summary>
                <p>
                  Original Vaettir software and studio content. Customer content, third-party material, and existing
                  software licenses retain their own rights.
                </p>
              </details>
            </footer>
          </TRPCReactProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
