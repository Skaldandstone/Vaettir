"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  useAuth,
  useClerk,
  useUser,
  SignInButton,
  SignUpButton,
} from "@clerk/nextjs";
import { trpcReact } from "@/lib/trpcReact";
import { canAdministerOrganization } from "@/lib/membership";
import { Icon, type IconName } from "./ui/Workspace";

const ORGANIZATION_ADMIN_LINKS: Array<{
  href: string;
  label: string;
  icon: IconName;
}> = [
  { href: "/settings/members", label: "Members", icon: "people" },
  { href: "/settings/access-review", label: "Access review", icon: "check" },
  { href: "/settings/billing", label: "Billing", icon: "folder" },
  { href: "/settings/integrations", label: "Integrations", icon: "branch" },
  {
    href: "/settings/organization",
    label: "Organization settings",
    icon: "settings",
  },
];

function AccountMenu() {
  const { user } = useUser();
  const clerk = useClerk();
  const orgsQuery = trpcReact.organization.mine.useQuery();
  const membership = orgsQuery.data?.[0];
  const canAdmin = canAdministerOrganization(membership);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function closeFromOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeFromKeyboard(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        containerRef.current?.contains(document.activeElement)
      ) {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("mousedown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, []);

  const email = user?.primaryEmailAddress?.emailAddress ?? "Signed-in account";
  const displayName = user?.fullName || user?.firstName || email;

  return (
    <div className="account-menu" ref={containerRef}>
      <button
        type="button"
        className="account-menu-trigger"
        aria-label="Open account and workspace menu"
        ref={triggerRef}
        aria-controls="account-workspace-navigation"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {user?.imageUrl ? (
          <img src={user.imageUrl} alt="" />
        ) : (
          <span aria-hidden="true">{displayName.slice(0, 1)}</span>
        )}
      </button>
      {open && (
        <nav
          id="account-workspace-navigation"
          className="account-menu-popover"
          aria-label="Account and workspace"
        >
          <div className="account-menu-identity">
            {user?.imageUrl ? (
              <img src={user.imageUrl} alt="" />
            ) : (
              <span aria-hidden="true">{displayName.slice(0, 1)}</span>
            )}
            <div>
              <strong>{displayName}</strong>
              <small>{email}</small>
              {membership && (
                <small>
                  {membership.name} · {membership.role.toLowerCase()}
                </small>
              )}
            </div>
          </div>
          <div className="account-menu-section">
            <Link href="/account/security" onClick={() => setOpen(false)}>
              <Icon name="settings" size={16} />
              <span>
                <strong>Security &amp; sign-in</strong>
                <small>Passkeys, 2FA, OAuth and sessions</small>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                clerk.openUserProfile();
              }}
            >
              <Icon name="people" size={16} />
              <span>
                <strong>Manage account</strong>
                <small>Profile and connected identities</small>
              </span>
            </button>
          </div>
          <div
            className="account-menu-section"
            aria-label="Organization administration"
          >
            <div className="account-menu-heading">
              <span>Organization administration</span>
              {!canAdmin && <small>Admin access required</small>}
            </div>
            {ORGANIZATION_ADMIN_LINKS.map((item) =>
              canAdmin ? (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                >
                  <Icon name={item.icon} size={16} />
                  <span>
                    <strong>{item.label}</strong>
                  </span>
                </Link>
              ) : (
                <span
                  key={item.href}
                  className="account-menu-disabled"
                  role="link"
                  aria-disabled="true"
                  title="A full-seat Owner or Admin can access this area"
                >
                  <Icon name={item.icon} size={16} />
                  <span>
                    <strong>{item.label}</strong>
                    <small>Admin access required</small>
                  </span>
                </span>
              ),
            )}
          </div>
          <div className="account-menu-section">
            <button
              type="button"
              onClick={() => clerk.signOut({ redirectUrl: "/" })}
            >
              <Icon name="release" size={16} />
              <span>
                <strong>Sign out</strong>
              </span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

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
      <div className="nav-auth-actions">
        <SignInButton>
          <button className="btn-primary">Sign in</button>
        </SignInButton>
        <SignUpButton>
          <button className="btn-secondary">Sign up</button>
        </SignUpButton>
      </div>
    );
  }

  return <AccountMenu />;
}
