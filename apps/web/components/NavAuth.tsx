"use client";

import { useAuth, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

// @clerk/nextjs v7 ("Core 3") removed the plain <SignedIn>/<SignedOut>
// wrappers outright (they throw at runtime, not just a deprecation warning) -
// Clerk's own guidance is a resource-based auth check instead of a path-
// matching one, so this reads useAuth() directly rather than reaching for
// an unfamiliar replacement component. SignInButton/SignUpButton/UserButton
// themselves were NOT removed - only the plain conditional wrappers were.
export function NavAuth() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) return null;

  if (!isSignedIn) {
    return (
      <div style={{ display: "flex", gap: 8 }}>
        <SignInButton>
          <button className="btn-primary">Sign in</button>
        </SignInButton>
        <SignUpButton>
          <button className="btn-secondary">Sign up</button>
        </SignUpButton>
      </div>
    );
  }

  return <UserButton />;
}
