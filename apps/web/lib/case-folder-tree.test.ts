import { describe, expect, it } from "vitest";
import { caseFolderNodeCatalog, caseFolderKindLabel, encodeFolderDrag, reviewedFolderDrop, folderIntentMatches, supportedCaseFolderPath, type CaseFolderCatalog } from "./case-folder-tree";
const catalog: CaseFolderCatalog = { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-actor", canEdit: true, paths: ["Empty", "Source", "Native", "Mixed", "Destination", "Source/Child"], folders: [{ id: "stable-empty", path: "Empty" }, { id: "stable-mixed", path: "Mixed" }, { id: "destination", path: "Destination" }] };
describe("source group and saved folder gestures", () => {
  it("distinguishes real saved identities, native placements, source-only and mixed nodes without treating catalog paths as case placements", () => {
    const map = caseFolderNodeCatalog([{ suitePath: null, sourceFilePath: "Source/Child" }, { suitePath: "Native", sourceFilePath: "Original/Native" }, { suitePath: null, sourceFilePath: "Mixed" }], catalog, catalog.paths);
    expect(map.get("Empty")!.kind).toBe("SAVED_FOLDER"); expect(map.get("Empty")!.savedId).toBe("stable-empty"); expect(map.get("Empty")!.nativeCases).toBe(0);
    expect(map.get("Native")!.kind).toBe("PERSISTED_SUITE"); expect(map.get("Source")!.kind).toBe("SOURCE_GROUP"); expect(map.get("Source")!.canReceiveCase).toBe(false);
    expect(map.get("Mixed")!.kind).toBe("MIXED"); expect(map.get("Mixed")!.canReceiveCase).toBe(true);
    expect(map.has("Original/Native")).toBe(false); expect(map.get("Source")!.sourceCases).toBe(1);
  });
  it("retains unsupported exact paths and refuses editing/drop without normalization or truncation", () => {
    for (const path of [" a ", "a//b", "a/../b", "a\\b", "x".repeat(241), "a/b/c/d/e/f/g/h/i"]) {
      expect(supportedCaseFolderPath(path)).toBe(false); const row = caseFolderNodeCatalog([{ suitePath: null, sourceFilePath: path }], catalog).get(path)!;
      expect(row.supported).toBe(false); expect(row.canOrganize).toBe(false); expect(row.canReceiveCase).toBe(false); expect(caseFolderKindLabel(row, true)).toContain("unsupported raw path"); expect(() => encodeFolderDrag(catalog, path)).toThrow();
    }
  });
  it("read-only/unverified metadata stays browsable but cannot authorize folder/case gestures", () => {
    const cases = [{ suitePath: "Native", sourceFilePath: null }];
    for (const scope of [null, { ...catalog, canEdit: false }]) { const row = caseFolderNodeCatalog(cases, scope).get("Native")!; expect(row.canOrganize).toBe(false); expect(row.canReceiveCase).toBe(false); }
    expect(caseFolderKindLabel(caseFolderNodeCatalog(cases, null).get("Native")!, false)).toContain("unverified");
  });
  it("folder drop emits only exact scoped MOVE review intent, preserving leaf and source path", () => {
    const raw = encodeFolderDrag(catalog, "Source"), intent = reviewedFolderDrop(raw, catalog, "Destination");
    expect(intent).toEqual({ projectId: catalog.projectId, organizationId: catalog.organizationId, clerkActorId: catalog.clerkActorId, action: "MOVE", fromPath: "Source", destinationParent: "Destination" });
    expect(folderIntentMatches({ ...intent, id: "gesture" }, catalog)).toBe(true);
    expect(Object.keys(intent)).not.toContain("confirmed"); expect(Object.keys(intent)).not.toContain("expectedHash"); expect(Object.keys(intent)).not.toContain("requestId");
    expect(reviewedFolderDrop(encodeFolderDrag(catalog, "Source/Child"), catalog, null).destinationParent).toBeNull();
  });
  it("refuses cross-account/project, malformed/extra fields, unsupported parent and self/descendant/same-path drops", () => {
    const raw = encodeFolderDrag(catalog, "Source");
    for (const scope of [null, { ...catalog, canEdit: false }, { ...catalog, projectId: "other" }, { ...catalog, organizationId: "other" }, { ...catalog, clerkActorId: "other" }]) expect(() => reviewedFolderDrop(raw, scope, "Destination")).toThrow();
    for (const text of ["not JSON", "[]", "{}", "x".repeat(4097), JSON.stringify({ ...JSON.parse(raw), confirmed: true })]) expect(() => reviewedFolderDrop(text, catalog, "Destination")).toThrow();
    for (const parent of [null, "Source", "Source/Child", "Missing", " a "]) expect(() => reviewedFolderDrop(raw, catalog, parent)).toThrow();
    for (const destinationParent of [null, "Source", "Source/Child", "Missing"]) expect(folderIntentMatches({ id: "gesture", projectId: catalog.projectId, organizationId: catalog.organizationId, clerkActorId: catalog.clerkActorId, action: "MOVE", fromPath: "Source", destinationParent }, catalog)).toBe(false);
  });
});
