import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import type { ClerkClient } from "@clerk/backend";
import { identityProviderSetup } from "./identityProviderSetup.js";

function fixture() {
  const actor = { userId: "native-user", clerkSubject: "user_verified", workspaceOrganizationId: "workspace" };
  const binding = { organizationId: "workspace", clerkOrganizationId: "org_pinned", setupEnabled: true, revision: 1 };
  const db = {
    user: { findUnique: vi.fn().mockResolvedValue({ clerkUserId: actor.clerkSubject, apiKeyIdentity: null }) },
    membership: { findUnique: vi.fn().mockResolvedValue({ role: "ADMIN", seatType: "FULL" }) },
    organization: { findUnique: vi.fn().mockResolvedValue({ suspendedAt: null }) },
    identityProviderBinding: { findUnique: vi.fn().mockResolvedValue(binding) },
  };
  const member = { organization: { id: "org_pinned" }, publicUserData: { userId: actor.clerkSubject }, permissions: ["org:sys_entconns:manage"] };
  const connection = { id: "connection_pinned", name: "Google SAML", provider: "saml_google", active: false, organizationId: "org_pinned",
    oauthConfig: { clientSecret: "SYNTHETIC-NEVER-RETURN" }, samlConnection: { idpCertificate: "SYNTHETIC-NEVER-RETURN" } };
  const provider = {
    organizations: { getOrganizationMembershipList: vi.fn().mockResolvedValue({ data: [member], totalCount: 1 }) },
    enterpriseConnections: { getEnterpriseConnectionList: vi.fn().mockResolvedValue({ data: [connection], totalCount: 1 }) },
  };
  const read = () => identityProviderSetup(db as unknown as PrismaClient, actor, "workspace", provider as unknown as ClerkClient);
  return { actor, binding, db, provider, read, member, connection };
}
describe("identity setup preflight (provider doubles, never real credentials)", () => {
  it("only queries the pinned organization and independently authenticated subject and returns a safe projection", async () => {
    const f = fixture();
    expect(await f.read()).toEqual({ status: "ready", clerkOrganizationId: "org_pinned", clerkSubject: "user_verified", revision: 1,
      connections: [{ id: "connection_pinned", name: "Google SAML", provider: "saml_google", active: false }] });
    expect(f.provider.organizations.getOrganizationMembershipList).toHaveBeenCalledWith({ organizationId: "org_pinned", userId: ["user_verified"], limit: 2 });
    expect(f.provider.enterpriseConnections.getEnterpriseConnectionList).toHaveBeenCalledWith({ organizationId: "org_pinned", limit: 100 });
  });
  it.each([null, { setupEnabled: false }])("makes no provider request for an absent/disabled binding", async binding => {
    const f = fixture(); f.db.identityProviderBinding.findUnique.mockResolvedValue(binding);
    expect(await f.read()).toEqual({ status: "unavailable", connections: [] });
    expect(f.provider.organizations.getOrganizationMembershipList).not.toHaveBeenCalled();
  });
  it.each(["EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"])("denies native %s even if provider membership is admin", async role => {
    const f = fixture(); f.db.membership.findUnique.mockResolvedValue({ role, seatType: "FULL" });
    await expect(f.read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.provider.organizations.getOrganizationMembershipList).not.toHaveBeenCalled();
  });
  it("denies subject rebind, service identity, read-only seat, cross-tenant ingress and suspension", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => f.db.user.findUnique.mockResolvedValue({ clerkUserId: "rebound", apiKeyIdentity: null }),
      (f: ReturnType<typeof fixture>) => f.db.user.findUnique.mockResolvedValue({ clerkUserId: f.actor.clerkSubject, apiKeyIdentity: { id: "service" } }),
      (f: ReturnType<typeof fixture>) => f.db.membership.findUnique.mockResolvedValue({ role: "ADMIN", seatType: "READ_ONLY" }),
      (f: ReturnType<typeof fixture>) => { f.actor.workspaceOrganizationId = "other"; },
      (f: ReturnType<typeof fixture>) => f.db.organization.findUnique.mockResolvedValue({ suspendedAt: new Date() }),
    ]) { const f = fixture(); mutate(f); await expect(f.read()).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.provider.organizations.getOrganizationMembershipList).not.toHaveBeenCalled(); }
  });
  it("does not infer permission from a provider role name or unmatched user/org", async () => {
    for (const member of [
      { organization: { id: "org_pinned" }, publicUserData: { userId: "user_verified" }, role: "org:admin", permissions: [] },
      { organization: { id: "other" }, publicUserData: { userId: "user_verified" }, permissions: ["org:sys_entconns:manage"] },
      { organization: { id: "org_pinned" }, publicUserData: { userId: "other" }, permissions: ["org:sys_entconns:manage"] },
    ]) { const f = fixture(); f.provider.organizations.getOrganizationMembershipList.mockResolvedValue({ data: [member], totalCount: 1 });
      expect(await f.read()).toMatchObject({ status: "provider-admin-required" }); expect(f.provider.enterpriseConnections.getEnterpriseConnectionList).not.toHaveBeenCalled(); }
  });
  it("rejects partial and cross-tenant provider connection results", async () => {
    const f = fixture(); f.provider.enterpriseConnections.getEnterpriseConnectionList.mockResolvedValue({ data: [f.connection], totalCount: 101 });
    await expect(f.read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    f.provider.enterpriseConnections.getEnterpriseConnectionList.mockResolvedValue({ data: [{ ...f.connection, organizationId: "other" }], totalCount: 1 });
    await expect(f.read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("redacts provider failures and rechecks local disable after a delayed response", async () => {
    const f = fixture(); f.provider.enterpriseConnections.getEnterpriseConnectionList.mockRejectedValueOnce(new Error("SYNTHETIC-SECRET"));
    await expect(f.read()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Identity provider status is unavailable. Retry without changing your connection." });
    f.db.identityProviderBinding.findUnique.mockResolvedValueOnce(f.binding).mockResolvedValue({ ...f.binding, revision: 2, setupEnabled: false });
    await expect(f.read()).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
