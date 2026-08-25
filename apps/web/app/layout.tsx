import type { ReactNode } from "react";
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

export const metadata = {
  title: "Vaettir",
  description: "Quality intelligence & test case management",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
          <nav style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 24px", borderBottom: "1px solid #e5e5e5" }}>
            <a href="/">Vaettir</a>
            <a href="/projects">Projects</a>
            <a href="/test-cases">Test Cases</a>
            <a href="/test-plans">Test Plans</a>
            <a href="/requirements">Requirements</a>
            <a href="/reverse-engineer">Reverse Engineer</a>
            <a href="/risk-analysis">Risk Analysis</a>
            <a href="/settings/members">Members</a>
            <a href="/settings/organization">Settings</a>
            <div style={{ marginLeft: "auto" }}>
              <SignedOut>
                <SignInButton />
              </SignedOut>
              <SignedIn>
                <UserButton />
              </SignedIn>
            </div>
          </nav>
          <main style={{ padding: 24 }}>{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
