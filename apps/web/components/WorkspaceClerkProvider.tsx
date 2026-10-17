"use client";
import { ClerkProvider } from "@clerk/nextjs";
import type { ComponentProps } from "react";
import { isWorkspaceAuthHost, workspaceRedirectOrigins } from "../lib/workspace-auth";

export function WorkspaceClerkProvider(props: ComponentProps<typeof ClerkProvider>) {
  if (process.env.NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED !== "1") return <ClerkProvider {...props} />;
  return <ClerkProvider {...props}
    isSatellite={url => isWorkspaceAuthHost(url.hostname)}
    domain={url => isWorkspaceAuthHost(url.hostname) ? "vaettir.app" : ""}
    signInUrl="https://vaettir.skaldandstone.com/sign-in"
    signUpUrl="https://vaettir.skaldandstone.com/sign-up"
    allowedRedirectOrigins={workspaceRedirectOrigins(process.env.NEXT_PUBLIC_VAETTIR_ACTIVE_WORKSPACE_NAMES)}
  />;
}
