import type { ReactNode } from "react";
import Link from "next/link";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { RuneMark } from "../components/RuneMark";
import { ThemeToggle } from "../components/ThemeToggle";
import { Sidebar } from "../components/Sidebar";
import "./globals.css";

export const metadata = {
  title: "vaettir",
  description: "Every place has its guardians. So does your codebase.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "var(--frost)",
          colorBackground: "var(--panel)",
          colorText: "var(--fg)",
          colorTextSecondary: "var(--muted)",
          colorTextOnPrimaryBackground: "var(--on-accent)",
          colorInputBackground: "var(--panel)",
          colorInputText: "var(--fg)",
          colorDanger: "var(--ember)",
          borderRadius: "6px",
          fontFamily: "Inter, sans-serif",
        },
      }}
    >
      <html lang="en">
        <body>
          <a className="skip-link" href="#main-content">
            Skip to content
          </a>
          <nav className="app-nav">
            <div className="app-nav-inner">
              <Link href="/" className="brand">
                <RuneMark />
                vaettir
              </Link>
              <span className="nav-product-label">
                Quality intelligence <span>Private beta</span>
              </span>
              <div className="nav-account-actions">
                <ThemeToggle />
                <SignedOut>
                  <div style={{ display: "flex", gap: 8 }}>
                    <SignInButton>
                      <button className="btn-primary">Sign in</button>
                    </SignInButton>
                    <SignUpButton>
                      <button className="btn-secondary">Sign up</button>
                    </SignUpButton>
                  </div>
                </SignedOut>
                <SignedIn>
                  <UserButton />
                </SignedIn>
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
              <summary style={{ cursor: "pointer", paddingBlock: 12 }}>
                About copyright
              </summary>
              <p>
                Original Vaettir software and studio content. Customer content,
                third-party material, and existing software licenses retain
                their own rights.
              </p>
            </details>
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}
