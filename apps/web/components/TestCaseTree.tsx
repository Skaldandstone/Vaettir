"use client";

import { useMemo, useState } from "react";
import { FOLDER_DRAG_TYPE, caseFolderNodeCatalog, caseFolderKindLabel, encodeFolderDrag, reviewedFolderDrop, supportedCaseFolderPath, type CaseFolderCatalog, type CaseFolderNode, type FolderReviewIntent } from "@/lib/case-folder-tree";

// TestRail/Qase organize test cases into a manually-curated suite/section
// tree. Every case here gets a location in that tree -- `suitePath` is a
// manual, user-settable "/"-delimited path any case can be assigned
// (regardless of origin), and `sourceFilePath` is the file an
// AI-reverse-engineered case came from, which serves as its DEFAULT
// location before anyone manually reassigns it. A case with neither lands
// in a distinct "Unassigned" bucket rather than being forced into a guess.
export interface TreeCase {
  id: string;
  title: string;
  sourceFilePath: string | null;
  suitePath: string | null;
}

function effectiveLocation(tc: TreeCase): string | null {
  return tc.suitePath || tc.sourceFilePath;
}

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  cases: TreeCase[];
}

function buildTree(cases: TreeCase[], folderPaths: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), cases: [] };
  for (const tc of [...cases, ...folderPaths.map(path => ({id:"",title:"",suitePath:path,sourceFilePath:null}))]) {
    const location = effectiveLocation(tc);
    if (!location) continue;
    // Unsupported original paths are retained as exact, flat groups. Splitting
    // or trimming malformed segments would silently rename their identity.
    if (!supportedCaseFolderPath(location)) {
      // The internal discriminator cannot collide with a supported segment
      // named e.g. "unsupported:__unassigned__"; it is never a saved path.
      const key = `\u0000raw:${location}`;
      let node = root.children.get(key);
      if (!node) { node = { name: location, path: location, children: new Map(), cases: [] }; root.children.set(key, node); }
      if (tc.id) node.cases.push(tc);
      continue;
    }
    const segments = location.split("/");
    let node = root;
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let next = node.children.get(segment);
      if (!next) {
        next = { name: segment, path, children: new Map(), cases: [] };
        node.children.set(segment, next);
      }
      node = next;
    }
    if (tc.id) node.cases.push(tc);
  }
  return root;
}

function TreeNodeView({
  node,
  depth,
  selectedPath,
  onSelect,
  onDropCase,
  catalog,
  metadata,
  onFolderReview,
  onDropRefused,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
  onDropCase?: (caseId: string, suitePath: string | null) => void;
  catalog: CaseFolderCatalog | null;
  metadata: Map<string, CaseFolderNode>;
  onFolderReview?: (intent: Omit<FolderReviewIntent, "id">) => void;
  onDropRefused?: (message: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const [dropTarget, setDropTarget] = useState(false);
  const totalCases = node.cases.length + [...node.children.values()].reduce((sum, c) => sum + countCases(c), 0);
  const hasChildren = node.children.size > 0;
  const entry = metadata.get(node.path)!;
  function reviewFolder(action: "MOVE" | "RENAME") {
    if (!catalog || !entry.canOrganize || !onFolderReview) return;
    onFolderReview({ projectId: catalog.projectId, organizationId: catalog.organizationId, clerkActorId: catalog.clerkActorId, action, fromPath: node.path });
  }
  function selectNode() {
    if (!entry.supported && node.path === UNASSIGNED) { onDropRefused?.("This exact raw source path conflicts with the Unassigned navigation marker. It is retained in All test cases; no path was normalized or moved."); return; }
    onSelect(node.path);
  }

  return (
    <div>
      <div
        className={`tree-row${selectedPath === node.path ? " active" : ""}${dropTarget ? " drop-target" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        role="button"
        tabIndex={0}
        aria-label={`${entry.supported ? node.name : JSON.stringify(node.path)}, ${caseFolderKindLabel(entry, !!catalog)}, ${totalCases} visible-lane cases`}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (hasChildren) setOpen((value) => !value);
            selectNode();
          }
        }}
        onDragOver={(event) => {
          const folder = event.dataTransfer.types.includes(FOLDER_DRAG_TYPE) && entry.canOrganize && !!onFolderReview;
          const testCase = event.dataTransfer.types.includes("application/x-vaettir-test-case") && !!onDropCase;
          if (!folder && !testCase) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDropTarget(true);
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(event) => {
          setDropTarget(false);
          if (event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) {
            event.preventDefault(); event.stopPropagation();
            try { if (onFolderReview) onFolderReview(reviewedFolderDrop(event.dataTransfer.getData(FOLDER_DRAG_TYPE), catalog, node.path)); }
            catch (cause) { onDropRefused?.(cause instanceof Error ? cause.message : "Folder gesture refused. Nothing was moved."); }
            return;
          }
          const caseId = event.dataTransfer.getData("application/x-vaettir-test-case");
          if (!onDropCase || !caseId) return;
          event.preventDefault();
          event.stopPropagation();
          if (!entry.canReceiveCase) { onDropRefused?.(entry.supported ? "This is a source-only or unverified group, not a current saved/case suite. Organize the group through reviewed Move/Rename first, or choose a verified native suite. No case was assigned." : "This original raw path is unsupported for folder changes. It remains visible and unchanged; choose a supported native suite."); return; }
          onDropCase(caseId, node.path);
        }}
        onClick={() => {
          if (hasChildren) setOpen((o) => !o);
          selectNode();
        }}
      >
        {hasChildren && <span className="tree-caret">{open ? "▾" : "▸"}</span>}
        <span className="tree-label" style={{ overflowWrap: "anywhere" }}>{entry.supported ? node.name : <code>{JSON.stringify(node.path)}</code>}<small style={{ display: "block", fontSize: 11 }}>{caseFolderKindLabel(entry, !!catalog)}</small></span>
        <span className="tree-count">{totalCases}</span>
      </div>
      {entry.canOrganize && onFolderReview && <details style={{ paddingLeft: 8 + depth * 14, fontSize: 12 }}>
        <summary aria-label={`Folder actions for ${node.path}`} style={{ cursor: "pointer", color: "var(--frost)", padding: "3px 0" }}>Folder actions</summary>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 0" }}>
        <button type="button" className="btn-secondary" draggable aria-label={`Drag ${node.path} to review a folder move`} onDragStart={event => { if (!catalog) return; event.dataTransfer.setData(FOLDER_DRAG_TYPE, encodeFolderDrag(catalog, node.path)); event.dataTransfer.effectAllowed = "move"; }}>⠿</button>
        <button type="button" className="btn-secondary" onClick={() => reviewFolder("MOVE")}>{entry.kind === "SOURCE_GROUP" ? "Organize source group…" : "Move…"}</button>
        <button type="button" className="btn-secondary" onClick={() => reviewFolder("RENAME")}>Rename…</button>
        </div>
      </details>}
      {!entry.supported && <p style={{ marginLeft: 8 + depth * 14, fontSize: 11 }}>Raw path retained. Move/rename is unsupported; no source path is normalized.</p>}
      {!entry.supported && node.path === UNASSIGNED && <button type="button" onClick={() => onSelect(null)}>View retained raw-path cases in All test cases</button>}
      {open && (
        <>
          {[...node.children.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((child) => (
              <TreeNodeView key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} onDropCase={onDropCase} catalog={catalog} metadata={metadata} onFolderReview={onFolderReview} onDropRefused={onDropRefused} />
            ))}
        </>
      )}
    </div>
  );
}

function countCases(node: TreeNode): number {
  return node.cases.length + [...node.children.values()].reduce((sum, c) => sum + countCases(c), 0);
}

export const UNASSIGNED = "__unassigned__";

export function TestCaseTree({
  cases,
  selectedPath,
  onSelect,
  onDropCase,
  folderPaths = [],
  folderCatalog = null,
  classificationCases = cases,
  onFolderReview,
  onDropRefused,
}: {
  cases: TreeCase[];
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
  onDropCase?: (caseId: string, suitePath: string | null) => void;
  folderPaths?: string[];
  folderCatalog?: CaseFolderCatalog | null;
  classificationCases?: TreeCase[];
  onFolderReview?: (intent: Omit<FolderReviewIntent, "id">) => void;
  onDropRefused?: (message: string) => void;
}) {
  const tree = useMemo(() => buildTree(cases, folderPaths), [cases, folderPaths]);
  const metadata = useMemo(() => caseFolderNodeCatalog(classificationCases, folderCatalog, [...folderPaths, ...cases.map(effectiveLocation).filter((path): path is string => path !== null)]), [cases, classificationCases, folderPaths, folderCatalog]);
  const unassignedCount = cases.filter((c) => !effectiveLocation(c)).length;
  const total = cases.length;

  return (
    <div className="test-case-tree">
      <div
        className={`tree-row${selectedPath === null ? " active" : ""}`}
        style={{ paddingLeft: 8 }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(null); } }}
        onClick={() => onSelect(null)}
        onDragOver={event => { if (folderCatalog?.canEdit && onFolderReview && event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
        onDrop={event => {
          if (!onFolderReview || !event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
          event.preventDefault();
          try { onFolderReview(reviewedFolderDrop(event.dataTransfer.getData(FOLDER_DRAG_TYPE), folderCatalog, null)); }
          catch (cause) { onDropRefused?.(cause instanceof Error ? cause.message : "Root folder gesture refused."); }
        }}
      >
        <span className="tree-label">All test cases</span>
        <span className="tree-count">{total}</span>
      </div>
      {[...tree.children.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => (
          <TreeNodeView key={child.path} node={child} depth={0} selectedPath={selectedPath} onSelect={onSelect} onDropCase={onDropCase} catalog={folderCatalog} metadata={metadata} onFolderReview={onFolderReview} onDropRefused={onDropRefused} />
        ))}
      {(unassignedCount > 0 || onDropCase) && (
        <div
          className={`tree-row${selectedPath === UNASSIGNED ? " active" : ""}`}
          style={{ paddingLeft: 8 }}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(UNASSIGNED); } }}
          onDragOver={(event) => { if (onDropCase && event.dataTransfer.types.includes("application/x-vaettir-test-case")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
          onDrop={(event) => {
            const caseId = event.dataTransfer.getData("application/x-vaettir-test-case");
            if (onDropCase && caseId) { event.preventDefault(); onDropCase(caseId, null); }
          }}
          onClick={() => onSelect(UNASSIGNED)}
        >
          <span className="tree-label">Unassigned</span>
          <span className="tree-count">{unassignedCount}</span>
        </div>
      )}
    </div>
  );
}

// Distinct suite paths already in use (manual or source-derived) --
// feeds a datalist so assigning a case doesn't invite near-duplicate
// folders from typos ("auth" vs "Auth" vs "auht").
export function collectKnownSuitePaths(cases: TreeCase[]): string[] {
  const paths = new Set<string>();
  for (const tc of cases) {
    const location = effectiveLocation(tc);
    if (location) paths.add(location);
  }
  return [...paths].sort();
}

// Filters a case list by the tree's current selection -- null = show
// everything, UNASSIGNED = cases with no suitePath or source file,
// otherwise a path prefix (a directory or an exact file both work, since
// matching is by prefix).
export function filterCasesByPath<T extends TreeCase>(cases: T[], selectedPath: string | null): T[] {
  if (selectedPath === null) return cases;
  if (selectedPath === UNASSIGNED) return cases.filter((c) => !effectiveLocation(c));
  return cases.filter((c) => {
    const location = effectiveLocation(c);
    return location === selectedPath || location?.startsWith(selectedPath + "/");
  });
}
