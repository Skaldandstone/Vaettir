import { describe, expect, it } from "vitest";
import { previewIdentityDraft } from "./identity-draft-preview";
import type { IdentityConfiguration } from "@vaettir/core";

const seed = (): IdentityConfiguration => ({ schemaVersion: 1, roles: [
  { id: "read", name: "Reader", permissions: ["cases.read"] },
  { id: "edit", name: "Author", permissions: ["cases.read", "cases.write"] },
], groups: [
  { id: "local", name: "Local team", userIds: ["one"], roleIds: ["edit"], scope: { kind: "projects", projectIds: ["a"] } },
  { id: "global", name: "Review team", userIds: ["one"], roleIds: ["read"], scope: { kind: "workspace" } },
] });
const preview = (configuration: unknown = seed(), userId = "one", projectId = "a", memberIds = ["one", "two"], projectIds = ["a", "b"]) =>
  previewIdentityDraft({ configuration, userId, projectId, memberIds, projectIds });

describe("display-only identity draft inspection", () => {
  it("requires explicit selection rather than defaulting to the first member", () => {
    expect(preview(seed(), "")).toEqual({ status: "select" });
    expect(preview(seed(), "one", "")).toEqual({ status: "select" });
  });
  it("deduplicates actions while retaining each exact group/role source", () => {
    expect(preview()).toEqual({ status: "ready", rules: [
      { permission: "cases.read", sources: [
        { groupId: "local", groupName: "Local team", roleId: "edit", roleName: "Author" },
        { groupId: "global", groupName: "Review team", roleId: "read", roleName: "Reader" },
      ] },
      { permission: "cases.write", sources: [{ groupId: "local", groupName: "Local team", roleId: "edit", roleName: "Author" }] },
    ] });
  });
  it("honors project scope and independent workspace rules", () => {
    expect(preview(seed(), "one", "b")).toMatchObject({ status: "ready", rules: [
      { permission: "cases.read", sources: [{ groupId: "global" }] },
    ] });
  });
  it("does not invent fallback access for an unassigned member", () => {
    expect(preview(seed(), "two")).toEqual({ status: "ready", rules: [] });
  });
  it("reflects role and membership reductions immediately without changing input", () => {
    const draft = seed(); draft.roles[1]!.permissions = ["cases.read"];
    draft.groups[0]!.userIds = ["two"];
    const original = JSON.stringify(draft);
    expect(preview(draft)).toMatchObject({ status: "ready", rules: [{ permission: "cases.read", sources: [{ groupId: "global" }] }] });
    expect(JSON.stringify(draft)).toBe(original);
  });
  it("reflects a scope reduction without stale action rows", () => {
    const draft = seed(); draft.groups[0]!.scope = { kind: "projects", projectIds: ["b"] };
    expect(preview(draft)).toMatchObject({ status: "ready", rules: [{ permission: "cases.read", sources: [{ groupId: "global" }] }] });
  });
  it.each(["unknown", "one@example.invalid", "One"])("does not infer membership from labels: %s", userId => {
    expect(preview(seed(), userId).status).toBe("unavailable");
  });
  it("rejects removed selected members and projects", () => {
    expect(preview(seed(), "one", "a", ["two"]).status).toBe("unavailable");
    expect(preview(seed(), "one", "a", ["one"], ["b"]).status).toBe("unavailable");
  });
  it("flags stale references even in groups not selected, rather than showing a misleading preview", () => {
    const draft = seed(); draft.groups[0]!.userIds.push("removed");
    expect(preview(draft).status).toBe("unavailable");
    draft.groups[0]!.userIds = ["one"]; draft.groups[0]!.scope = { kind: "projects", projectIds: ["removed"] };
    expect(preview(draft).status).toBe("unavailable");
  });
  it("rejects broken role references, unknown/reserved permissions and duplicate identifiers", () => {
    const broken = seed(); broken.roles.pop(); expect(preview(broken).status).toBe("unavailable");
    const unsafe = seed(); unsafe.roles[0]!.permissions = ["identity.admin" as never]; expect(preview(unsafe).status).toBe("unavailable");
    const duplicate = seed(); duplicate.groups.push(duplicate.groups[0]!); expect(preview(duplicate).status).toBe("unavailable");
  });
  it("does not accept directory payloads or browser claims as custom configuration", () => {
    expect(preview({ ...seed(), directoryGrants: [{ role: "ADMIN" }] }).status).toBe("unavailable");
  });
});
