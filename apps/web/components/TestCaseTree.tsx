"use client";

import { useMemo, useState } from "react";

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

function buildTree(cases: TreeCase[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), cases: [] };
  for (const tc of cases) {
    const location = effectiveLocation(tc);
    if (!location) continue;
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
    node.cases.push(tc);
  }
  return root;
}

function TreeNodeView({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const totalCases = node.cases.length + [...node.children.values()].reduce((sum, c) => sum + countCases(c), 0);
  const hasChildren = node.children.size > 0;

  return (
    <div>
      <div
        className={`tree-row${selectedPath === node.path ? " active" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => {
          if (hasChildren) setOpen((o) => !o);
          onSelect(node.path);
        }}
      >
        {hasChildren && <span className="tree-caret">{open ? "▾" : "▸"}</span>}
        <span className="tree-label">{node.name}</span>
        <span className="tree-count">{totalCases}</span>
      </div>
      {open && (
        <>
          {[...node.children.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((child) => (
              <TreeNodeView key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
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
}: {
  cases: TreeCase[];
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
}) {
  const tree = useMemo(() => buildTree(cases), [cases]);
  const unassignedCount = cases.filter((c) => !effectiveLocation(c)).length;
  const total = cases.length;

  return (
    <div className="test-case-tree">
      <div
        className={`tree-row${selectedPath === null ? " active" : ""}`}
        style={{ paddingLeft: 8 }}
        onClick={() => onSelect(null)}
      >
        <span className="tree-label">All test cases</span>
        <span className="tree-count">{total}</span>
      </div>
      {[...tree.children.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => (
          <TreeNodeView key={child.path} node={child} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
      {unassignedCount > 0 && (
        <div
          className={`tree-row${selectedPath === UNASSIGNED ? " active" : ""}`}
          style={{ paddingLeft: 8 }}
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
