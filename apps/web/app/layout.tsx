import type { ReactNode } from "react";
import Link from "next/link";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
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
          colorPrimary: "#8fa37a",
          colorBackground: "#2e2820",
          colorText: "#f3ecdf",
          colorInputBackground: "#26211b",
          colorInputText: "#f3ecdf",
          borderRadius: "3px",
          fontFamily: "Inter, sans-serif",
        },
      }}
    >
      <html lang="en">
        <body>
          <nav className="app-nav">
            <div className="app-nav-inner">
              <Link href="/" className="brand">
                <RuneMark />
                vaettir
              </Link>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
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
            <main className="app-main">{children}</main>
          </div>
        </body>
      </html>
    </ClerkProvider>
  );
}
