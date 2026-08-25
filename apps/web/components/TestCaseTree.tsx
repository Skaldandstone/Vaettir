"use client";

import { useMemo, useState } from "react";

// TestRail/Qase organize test cases into a manually-curated suite/section
// tree. We don't have (and didn't want to force) a separate Suite data
// model for this -- an AI-reverse-engineered case already has a real,
// meaningful location: the source file it was extracted from. Deriving the
// tree from that path gives the same navigation benefit without new schema
// surface area. Manually-authored cases (no source) land in one flat
// bucket, since they have no natural folder of their own yet.
export interface TreeCase {
  id: string;
  title: string;
  sourceFilePath: string | null;
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
    if (!tc.sourceFilePath) continue;
    const segments = tc.sourceFilePath.split("/");
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
  const manualCount = cases.filter((c) => !c.sourceFilePath).length;
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
      {manualCount > 0 && (
        <div
          className={`tree-row${selectedPath === "__manual__" ? " active" : ""}`}
          style={{ paddingLeft: 8 }}
          onClick={() => onSelect("__manual__")}
        >
          <span className="tree-label">Manually authored</span>
          <span className="tree-count">{manualCount}</span>
        </div>
      )}
    </div>
  );
}

// Filters a case list by the tree's current selection -- null = show
// everything, "__manual__" = cases with no source file, otherwise a
// path prefix (a directory or an exact file both work, since matching is
// by prefix).
export function filterCasesByPath<T extends TreeCase>(cases: T[], selectedPath: string | null): T[] {
  if (selectedPath === null) return cases;
  if (selectedPath === "__manual__") return cases.filter((c) => !c.sourceFilePath);
  return cases.filter((c) => c.sourceFilePath === selectedPath || c.sourceFilePath?.startsWith(selectedPath + "/"));
}
