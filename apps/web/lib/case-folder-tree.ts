import { folderPathSchema } from "@vaettir/api/src/services/caseFolderSchema";
export const FOLDER_DRAG_TYPE = "application/x-vaettir-folder-path";
export type CaseFolderCatalog = { projectId: string; organizationId: string; clerkActorId: string; paths: string[]; folders: { id: string; path: string }[]; canEdit: boolean };
export type FolderReviewIntent = { id: string; projectId: string; organizationId: string; clerkActorId: string; action: "MOVE" | "RENAME"; fromPath: string; destinationParent?: string | null };
export type CaseFolderKind = "SAVED_FOLDER" | "PERSISTED_SUITE" | "SOURCE_GROUP" | "MIXED" | "UNVERIFIED";
export type CaseFolderNode = { kind: CaseFolderKind; supported: boolean; savedId: string | null; nativeCases: number; sourceCases: number; nativeFolder: boolean; canOrganize: boolean; canReceiveCase: boolean };
type Placed = { suitePath: string | null; sourceFilePath: string | null };
export function supportedCaseFolderPath(path: string): boolean { return folderPathSchema.safeParse(path).success; }
function pathsFor(raw: string) { return supportedCaseFolderPath(raw) ? raw.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/")) : [raw]; }
export function caseFolderNodeCatalog(cases: readonly Placed[], catalog: CaseFolderCatalog | null, displayPaths: readonly string[] = []): Map<string, CaseFolderNode> {
  const entries = new Map<string, CaseFolderNode>();
  function node(path: string) { let entry = entries.get(path); if (!entry) { entry = { kind: "UNVERIFIED", supported: supportedCaseFolderPath(path), savedId: null, nativeCases: 0, sourceCases: 0, nativeFolder: false, canOrganize: false, canReceiveCase: false }; entries.set(path, entry); } return entry; }
  for (const item of cases) { const path = item.suitePath || item.sourceFilePath; if (!path) continue; for (const ancestor of pathsFor(path)) { const entry = node(ancestor); if (item.suitePath) entry.nativeCases++; else entry.sourceCases++; } }
  for (const path of catalog?.paths ?? []) node(path);
  for (const path of displayPaths) for (const ancestor of pathsFor(path)) node(ancestor);
  for (const folder of catalog?.folders ?? []) { for (const ancestor of pathsFor(folder.path)) node(ancestor).nativeFolder = true; node(folder.path).savedId = folder.id; }
  for (const [path, entry] of entries) {
    const native = entry.nativeCases > 0 || entry.nativeFolder;
    entry.kind = entry.sourceCases > 0 && native ? "MIXED" : entry.savedId ? "SAVED_FOLDER" : native ? "PERSISTED_SUITE" : entry.sourceCases > 0 ? "SOURCE_GROUP" : "UNVERIFIED";
    entry.canOrganize = !!catalog?.canEdit && entry.supported && catalog.paths.includes(path);
    // A source grouping is never a silent single-case suite assignment.
    entry.canReceiveCase = entry.canOrganize && native;
  }
  return entries;
}
export function caseFolderKindLabel(entry: CaseFolderNode, verified: boolean): string {
  const label = entry.kind === "SAVED_FOLDER" ? "Saved folder" : entry.kind === "PERSISTED_SUITE" ? "Case suite" : entry.kind === "MIXED" ? "Mixed suite / source group" : entry.kind === "SOURCE_GROUP" ? "Source group" : "Folder status unavailable";
  return !entry.supported ? `${label} · unsupported raw path` : !verified && entry.kind !== "UNVERIFIED" ? `${label} · saved-folder status unverified` : label;
}
export function encodeFolderDrag(catalog: CaseFolderCatalog, path: string): string {
  if (!catalog.canEdit || !catalog.paths.includes(path) || !supportedCaseFolderPath(path)) throw Error("Only a current supported group can start a reviewed folder move.");
  return JSON.stringify({ projectId: catalog.projectId, organizationId: catalog.organizationId, clerkActorId: catalog.clerkActorId, path });
}
export function reviewedFolderDrop(raw: string, catalog: CaseFolderCatalog | null, parent: string | null): Omit<FolderReviewIntent, "id"> {
  if (!catalog?.canEdit || raw.length > 4096) throw Error("Verify current editor access and folder scope before reviewing a move.");
  let data: unknown; try { data = JSON.parse(raw); } catch { throw Error("This is not a Vaettir folder gesture. Nothing was moved."); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("Unsupported folder gesture. Nothing was moved.");
  const value = data as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "clerkActorId,organizationId,path,projectId" || value.projectId !== catalog.projectId || value.organizationId !== catalog.organizationId || value.clerkActorId !== catalog.clerkActorId || typeof value.path !== "string" || !supportedCaseFolderPath(value.path) || !catalog.paths.includes(value.path)) throw Error("The folder gesture does not belong to this current account/project scope. Nothing was moved.");
  const from = value.path;
  if (parent !== null && (!supportedCaseFolderPath(parent) || !catalog.paths.includes(parent))) throw Error("Choose a supported current destination parent. Raw source paths were not normalized.");
  const toPath = [parent, from.slice(from.lastIndexOf("/") + 1)].filter(part => part !== null).join("/");
  if (!supportedCaseFolderPath(toPath) || toPath === from || parent === from || parent?.startsWith(`${from}/`)) throw Error("Choose a different valid parent outside this group and its descendants. Nothing was moved.");
  return { projectId: catalog.projectId, organizationId: catalog.organizationId, clerkActorId: catalog.clerkActorId, action: "MOVE", fromPath: from, destinationParent: parent };
}
export function folderIntentMatches(intent: FolderReviewIntent, catalog: CaseFolderCatalog): boolean {
  const valid = intent.projectId === catalog.projectId && intent.organizationId === catalog.organizationId && intent.clerkActorId === catalog.clerkActorId && catalog.canEdit && catalog.paths.includes(intent.fromPath) && supportedCaseFolderPath(intent.fromPath) && ["MOVE", "RENAME"].includes(intent.action);
  if (!valid || intent.action === "RENAME" && intent.destinationParent !== undefined) return false;
  if (intent.destinationParent === undefined) return true; // Keyboard chooser, not an approved destination.
  try { reviewedFolderDrop(encodeFolderDrag(catalog, intent.fromPath), catalog, intent.destinationParent); return true; } catch { return false; }
}
