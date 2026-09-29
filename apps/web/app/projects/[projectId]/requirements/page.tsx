"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useParams } from "next/navigation";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { Modal } from "@/components/Modal";
import { ConnectionLink, SourceConnectionChips } from "@/components/SourceConnectionChips";
import { CreationWizard, WizardChoices } from "@/components/CreationWizard";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { saveRequirementDrafts } from "@/lib/requirement-drafts";

// 2026-08-27 competitor parity audit: draft-and-review, same shape as
// P4-02's strategy generation - nothing here creates a real TestCase
// until the user explicitly picks which drafts to keep.
//
// P1-15: the draft generation fires on mount, which is a mutation in tRPC
// terms (it costs an AI call) - so it goes through utils.client (the
// vanilla client behind the react-query layer) rather than a rendered
// hook, keeping the effect deps to the requirement id.
function GenerateTestCasesModal({
  requirementId,
  projectId,
  onClose,
  onCreated,
}: {
  requirementId: string;
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const utils = trpcReact.useUtils();
  const createCase = trpcReact.testCases.create.useMutation();
  const [drafts, setDrafts] = useState<
    RouterOutputs["requirements"]["generateTestCases"] | null
  >(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    utils.client.requirements.generateTestCases
      .mutate({ requirementId })
      .then((result) => {
        setDrafts(result);
        setSelected(new Set(result.map((_, i) => i)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setGenerating(false));
  }, [requirementId, utils]);

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function createSelected() {
    if (!drafts) return;
    setCreating(true);
    setError(null);
    try {
      for (const i of selected) {
        const d = drafts[i]!;
        await createCase.mutateAsync({
          projectId,
          title: d.title,
          given: d.given,
          when: d.when,
          then: d.then,
          testType: "FUNCTIONAL",
          priority: d.priority as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
        });
      }
      void utils.testCases.list.invalidate();
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Generate test cases with AI">
      {generating && <p>Drafting…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      {drafts && (
        <div style={{ maxHeight: 500, overflowY: "auto" }}>
          {drafts.map((d, i) => (
            <div
              key={i}
              className="panel"
              style={{ marginBottom: 10, padding: 10 }}
            >
              <label
                style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => toggle(i)}
                  style={{ marginTop: 4 }}
                />
                <div style={{ flex: 1 }}>
                  <strong>{d.title}</strong>{" "}
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    ({d.priority})
                  </span>
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    <div>
                      <em>Given</em> {d.given.join("; ")}
                    </div>
                    <div>
                      <em>When</em> {d.when.join("; ")}
                    </div>
                    <div>
                      <em>Then</em> {d.then.join("; ")}
                    </div>
                  </div>
                </div>
              </label>
            </div>
          ))}
          {drafts.length === 0 && (
            <p className="text-muted">No draft cases produced.</p>
          )}
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 10,
            }}
          >
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={createSelected}
              disabled={creating || selected.size === 0}
            >
              {creating ? "Creating…" : `Create ${selected.size} selected`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

type DraftRequirement = {
  title: string;
  description: string;
  sourceFile: string | null;
};

// Shared review list: both the markdown-paste and repo-scan extraction
// paths land drafts here for the same checkbox-and-create review flow
// GenerateTestCasesModal above already established.
function DraftRequirementReview({
  drafts,
  projectId,
  onClose,
  onCreated,
  onBusyChange,
}: {
  drafts: DraftRequirement[];
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const createRequirement = trpcReact.requirements.create.useMutation();
  const [editableDrafts, setEditableDrafts] = useState(drafts);
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(
    new Set(drafts.map((_, i) => i)),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function createSelected() {
    if (creating || selected.size === 0) return;
    if ([...selected].some((i) => !editableDrafts[i]?.title.trim())) {
      setError(
        "Add a title to each selected requirement before creating it. Your rows have been kept for editing.",
      );
      return;
    }
    setCreating(true);
    onBusyChange(true);
    setError(null);
    try {
      await saveRequirementDrafts(
        editableDrafts,
        selected,
        saved,
        (draft) => createRequirement.mutateAsync({ projectId, ...draft }),
        (i) => {
          setSaved((previous) => new Set(previous).add(i));
          setSelected((previous) => {
            const next = new Set(previous);
            next.delete(i);
            return next;
          });
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
      onBusyChange(false);
      onCreated();
    }
  }

  return (
    <div style={{ maxHeight: 500, overflowY: "auto" }}>
      <p>
        Edit each requirement before saving. Unchecked rows remain in this
        review; nothing is silently discarded.
      </p>
      {saved.size > 0 && (
        <p role="status">
          {saved.size} requirements created. Saved rows will not be submitted
          again.
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--ember)" }}>
          {error} Saved rows stay locked. If the connection dropped, check the
          requirements list before retrying an uncertain row.
        </p>
      )}
      {editableDrafts.map((d, i) => (
        <div
          key={i}
          className="panel"
          style={{ marginBottom: 10, padding: 10 }}
        >
          <div style={{ display: "grid", gap: 8 }}>
            <label>
              <input
                type="checkbox"
                disabled={creating || saved.has(i)}
                checked={selected.has(i)}
                onChange={() => toggle(i)}
                style={{ marginTop: 4 }}
              />
              {saved.has(i) ? "Created" : `Include requirement ${i + 1}`}
            </label>
            <label>
              Title
              <input
                value={d.title}
                disabled={creating || saved.has(i)}
                aria-invalid={selected.has(i) && !d.title.trim()}
                onChange={(event) =>
                  setEditableDrafts((rows) =>
                    rows.map((row, index) =>
                      index === i ? { ...row, title: event.target.value } : row,
                    ),
                  )
                }
              />
            </label>
            <label>
              Description and acceptance expectations
              <textarea
                value={d.description}
                rows={3}
                disabled={creating || saved.has(i)}
                onChange={(event) =>
                  setEditableDrafts((rows) =>
                    rows.map((row, index) =>
                      index === i
                        ? { ...row, description: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </label>
            {d.sourceFile && (
              <span className="text-muted" style={{ fontSize: 12 }}>
                ({d.sourceFile})
              </span>
            )}
          </div>
        </div>
      ))}
      {drafts.length === 0 && (
        <p className="text-muted">No requirements found in the source.</p>
      )}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "flex-end",
          marginTop: 10,
        }}
      >
        <button className="btn-secondary" onClick={onClose} disabled={creating}>
          Close review
        </button>
        <button
          className="btn-primary"
          onClick={createSelected}
          disabled={
            creating ||
            selected.size === 0 ||
            [...selected].some((i) => !editableDrafts[i]?.title.trim())
          }
        >
          {creating ? "Creating…" : `Create ${selected.size} selected`}
        </button>
      </div>
    </div>
  );
}

// P9-02: per-requirement Linear link/sync control. The org-level API key
// and webhook secret are configured once on the org settings page - this
// just needs the Linear issue's own identifier.
function LinearLinkControl({
  requirement,
  onChanged,
}: {
  requirement: {
    id: string;
    linearIssueId: string | null;
    linearStatusName: string | null;
    linearSyncedAt: string | Date | null;
  };
  onChanged: () => void;
}) {
  const [issueId, setIssueId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const linkMutation = trpcReact.requirements.linkLinearIssue.useMutation();
  const unlinkMutation = trpcReact.requirements.unlinkLinearIssue.useMutation();
  const syncMutation = trpcReact.requirements.syncLinearStatus.useMutation();

  async function link() {
    if (!issueId.trim()) return;
    setError(null);
    try {
      await linkMutation.mutateAsync({
        requirementId: requirement.id,
        linearIssueId: issueId.trim(),
      });
      setIssueId("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function unlink() {
    await unlinkMutation.mutateAsync({ requirementId: requirement.id });
    onChanged();
  }

  async function sync() {
    setError(null);
    try {
      await syncMutation.mutateAsync({ requirementId: requirement.id });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (requirement.linearIssueId) {
    return (
      <div style={{ fontSize: 12, marginTop: 4 }}>
        <span className="text-muted">
          Linear {requirement.linearIssueId}
          {requirement.linearStatusName && (
            <> · {requirement.linearStatusName}</>
          )}
        </span>{" "}
        <button
          style={{ fontSize: 11 }}
          onClick={sync}
          disabled={syncMutation.isPending}
        >
          {syncMutation.isPending ? "Syncing…" : "Sync"}
        </button>{" "}
        <button
          className="btn-secondary"
          style={{ fontSize: 11 }}
          onClick={unlink}
        >
          Unlink
        </button>
        {error && <span style={{ color: "var(--ember)" }}> {error}</span>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
      <input
        value={issueId}
        onChange={(e) => setIssueId(e.target.value)}
        placeholder="Linear issue, e.g. ENG-123"
        style={{ fontSize: 12, width: 160 }}
      />
      <button
        style={{ fontSize: 11 }}
        onClick={link}
        disabled={linkMutation.isPending || !issueId.trim()}
      >
        {linkMutation.isPending ? "Linking…" : "Link"}
      </button>
      {error && (
        <span style={{ color: "var(--ember)", fontSize: 12 }}>{error}</span>
      )}
    </div>
  );
}

// P9-01: same shape as LinearLinkControl above, against Jira instead.
function JiraLinkControl({
  requirement,
  onChanged,
}: {
  requirement: {
    id: string;
    jiraIssueKey: string | null;
    jiraStatusName: string | null;
    jiraSyncedAt: string | Date | null;
  };
  onChanged: () => void;
}) {
  const [issueKey, setIssueKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const linkMutation = trpcReact.requirements.linkJiraIssue.useMutation();
  const unlinkMutation = trpcReact.requirements.unlinkJiraIssue.useMutation();
  const syncMutation = trpcReact.requirements.syncJiraStatus.useMutation();

  async function link() {
    if (!issueKey.trim()) return;
    setError(null);
    try {
      await linkMutation.mutateAsync({
        requirementId: requirement.id,
        jiraIssueKey: issueKey.trim(),
      });
      setIssueKey("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function unlink() {
    await unlinkMutation.mutateAsync({ requirementId: requirement.id });
    onChanged();
  }

  async function sync() {
    setError(null);
    try {
      await syncMutation.mutateAsync({ requirementId: requirement.id });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (requirement.jiraIssueKey) {
    return (
      <div style={{ fontSize: 12, marginTop: 4 }}>
        <span className="text-muted">
          Jira {requirement.jiraIssueKey}
          {requirement.jiraStatusName && <> · {requirement.jiraStatusName}</>}
        </span>{" "}
        <button
          style={{ fontSize: 11 }}
          onClick={sync}
          disabled={syncMutation.isPending}
        >
          {syncMutation.isPending ? "Syncing…" : "Sync"}
        </button>{" "}
        <button
          className="btn-secondary"
          style={{ fontSize: 11 }}
          onClick={unlink}
        >
          Unlink
        </button>
        {error && <span style={{ color: "var(--ember)" }}> {error}</span>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
      <input
        value={issueKey}
        onChange={(e) => setIssueKey(e.target.value)}
        placeholder="Jira issue, e.g. PROJ-123"
        style={{ fontSize: 12, width: 160 }}
      />
      <button
        style={{ fontSize: 11 }}
        onClick={link}
        disabled={linkMutation.isPending || !issueKey.trim()}
      >
        {linkMutation.isPending ? "Linking…" : "Link"}
      </button>
      {error && (
        <span style={{ color: "var(--ember)", fontSize: 12 }}>{error}</span>
      )}
    </div>
  );
}

// Direct request: make the Jira/Linear side of this integration genuinely
// informative, not just a status-name sync - a shareable link renders a
// rich Open Graph preview when pasted into a Jira or Linear issue (see
// apps/web/app/share/requirements/[token]/page.tsx), no app installation
// required. Opt-in only: nothing is generated until this button is
// clicked.
function ShareLinkControl({
  requirement,
  onChanged,
}: {
  requirement: { id: string; shareToken: string | null };
  onChanged: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createMutation = trpcReact.requirements.createShareLink.useMutation();
  const revokeMutation = trpcReact.requirements.revokeShareLink.useMutation();

  async function create() {
    setError(null);
    try {
      await createMutation.mutateAsync({ requirementId: requirement.id });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function revoke() {
    if (
      !confirm(
        "Revoke this share link? Anywhere it was pasted will stop showing live test status.",
      )
    )
      return;
    await revokeMutation.mutateAsync({ requirementId: requirement.id });
    onChanged();
  }

  function copyLink() {
    if (!requirement.shareToken || typeof window === "undefined") return;
    const url = `${window.location.origin}/share/requirements/${requirement.shareToken}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (requirement.shareToken) {
    return (
      <div style={{ fontSize: 12, marginTop: 4 }}>
        <button style={{ fontSize: 11 }} onClick={copyLink}>
          {copied ? "Copied!" : "Copy share link"}
        </button>{" "}
        <button
          className="btn-secondary"
          style={{ fontSize: 11 }}
          onClick={revoke}
        >
          Revoke
        </button>
        {error && <span style={{ color: "var(--ember)" }}> {error}</span>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 4 }}>
      <button
        style={{ fontSize: 11 }}
        onClick={create}
        disabled={createMutation.isPending}
      >
        {createMutation.isPending ? "Generating…" : "Share test status"}
      </button>
      {error && (
        <span style={{ color: "var(--ember)", fontSize: 12 }}> {error}</span>
      )}
    </div>
  );
}

// 2026-08-28: paste/upload a markdown spec doc, extract candidate
// requirements from it. Two-step: paste content, then Extract fires the
// real AI call and swaps into the same review list every extraction path
// uses.
function ExtractFromMarkdownModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const extractMutation =
    trpcReact.requirements.extractFromMarkdown.useMutation();
  const [fileName, setFileName] = useState("requirements.md");
  const [savingDrafts, setSavingDrafts] = useState(false);
  const [content, setContent] = useState("");
  const [drafts, setDrafts] = useState<DraftRequirement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const extracting = extractMutation.isPending;

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setContent(await file.text());
  }

  async function extract() {
    if (!content.trim()) return;
    setError(null);
    try {
      const result = await extractMutation.mutateAsync({
        projectId,
        fileName,
        markdownContent: content,
      });
      setDrafts(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Extract requirements from a markdown file"
      dismissible={!extracting && !savingDrafts}
    >
      {!drafts && (
        <div style={{ display: "grid", gap: 10 }}>
          <input
            type="file"
            accept=".md,.mdx,text/markdown"
            onChange={handleFile}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste markdown content here, or choose a file above…"
            rows={10}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
          />
          {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={extract}
              disabled={extracting || !content.trim()}
            >
              {extracting ? "Extracting…" : "Extract"}
            </button>
          </div>
        </div>
      )}
      {drafts && (
        <DraftRequirementReview
          drafts={drafts}
          projectId={projectId}
          onClose={onClose}
          onCreated={onCreated}
          onBusyChange={setSavingDrafts}
        />
      )}
    </Modal>
  );
}

// 2026-08-28: scans the project's connected repo for likely requirements/
// spec docs after explicit confirmation. Opening a dialog must not spend credits.
function ExtractFromRepoModal({
  projectId,
  repoUrl,
  onClose,
  onCreated,
}: {
  projectId: string;
  repoUrl: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const utils = trpcReact.useUtils();
  const [drafts, setDrafts] = useState<DraftRequirement[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [savingDrafts, setSavingDrafts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    if (scanning) return;
    setScanning(true);
    setError(null);
    try {
      setDrafts(
        await utils.client.requirements.extractFromRepo.mutate({
          projectId,
          repoUrl,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Extract requirements from ${repoUrl}`}
      dismissible={!scanning && !savingDrafts}
    >
      {!drafts && !scanning && (
        <div>
          <p>
            Scan the connected repository for specification documents, then edit
            and select the proposed requirements. No requirements are saved
            until you confirm them.
          </p>
          <p className="text-muted">
            This uses AI credits. Review the operation costs in Billing before
            starting.
          </p>
          <button className="btn-primary" onClick={scan}>
            Scan repository and draft requirements
          </button>
        </div>
      )}
      {scanning && <p>Scanning repo for requirements/spec docs…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      {drafts && (
        <DraftRequirementReview
          drafts={drafts}
          projectId={projectId}
          onClose={onClose}
          onCreated={onCreated}
          onBusyChange={setSavingDrafts}
        />
      )}
    </Modal>
  );
}

// P1-15
export default function RequirementsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit } = useProjectPermissions(projectId);
  const utils = trpcReact.useUtils();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [generatingForId, setGeneratingForId] = useState<string | null>(null);
  const [markdownModalOpen, setMarkdownModalOpen] = useState(false);
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [creationStep, setCreationStep] = useState<number | null>(null);
  const [creationSource, setCreationSource] = useState("Write a requirement");

  const listQuery = trpcReact.requirements.list.useQuery({ projectId });
  const requirements = listQuery.data ?? [];
  const loading = listQuery.isPending;
  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const repoUrl = projectQuery.data?.repoUrl ?? null;

  const updateMutation = trpcReact.requirements.update.useMutation();
  const createMutation = trpcReact.requirements.create.useMutation();
  const deleteMutation = trpcReact.requirements.delete.useMutation();

  function reload() {
    void utils.requirements.list.invalidate({ projectId });
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setExternalRef("");
    setEditingId(null);
  }

  function startEdit(r: {
    id: string;
    title: string;
    description: string | null;
    externalRef: string | null;
  }) {
    setEditingId(r.id);
    setTitle(r.title);
    setDescription(r.description ?? "");
    setExternalRef(r.externalRef ?? "");
  }

  async function submit() {
    if (!title) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateMutation.mutateAsync({
          id: editingId,
          title,
          description: description || undefined,
          externalRef: externalRef || undefined,
        });
      } else {
        await createMutation.mutateAsync({
          projectId,
          title,
          description: description || undefined,
          externalRef: externalRef || undefined,
        });
      }
      resetForm();
      setCreationStep(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await deleteMutation.mutateAsync({ id });
    if (editingId === id) resetForm();
    reload();
  }

  const visibleRequirements = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requirements;
    return requirements.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.externalRef?.toLowerCase().includes(q),
    );
  }, [requirements, search]);

  const displayError =
    error ?? (listQuery.error ? String(listQuery.error.message) : null);

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Requirements</h1>

      {canEdit && (
        <div style={{ display: "flex", gap: 8, margin: "8px 0 16px" }}>
          <button
            className="btn-primary"
            onClick={() => {
              resetForm();
              setCreationStep(0);
            }}
          >
            Add requirements
          </button>
        </div>
      )}

      {canEdit && creationStep !== null && (
        <Modal
          open
          title="Add requirements"
          onClose={() => setCreationStep(null)}
          dismissible={!saving}
        >
          <CreationWizard
            step={creationStep}
            steps={["Source", "Describe", "Review"]}
            title={
              creationStep === 0
                ? "Where should we start?"
                : creationStep === 1
                  ? "Describe the behavior you need"
                  : "Review your requirement"
            }
            description="Capture the outcome first. You can connect test cases and acceptance criteria afterwards."
            busy={saving}
            submitLabel="Create requirement"
            canContinue={
              creationStep === 0
                ? creationSource !== "Connected repository" || !!repoUrl
                : !!title.trim()
            }
            onCancel={() => setCreationStep(null)}
            onSubmit={submit}
            onStepChange={(next) => {
              if (
                creationStep === 0 &&
                next === 1 &&
                creationSource !== "Write a requirement"
              ) {
                setCreationStep(null);
                if (creationSource === "Markdown document")
                  setMarkdownModalOpen(true);
                else setRepoModalOpen(true);
              } else setCreationStep(next);
            }}
          >
            {creationStep === 0 && (
              <>
                <WizardChoices
                  title="Requirement source"
                  single
                  options={[
                    "Write a requirement",
                    "Markdown document",
                    "Connected repository",
                  ]}
                  selected={[creationSource]}
                  onToggle={setCreationSource}
                />
                <p className="text-muted">
                  Write one requirement, upload or paste a specification, or
                  draft from repository documents. Extracted rows can be edited
                  before saving.
                </p>
                {creationSource === "Connected repository" && !repoUrl && (
                  <ConnectionLink href={`/projects/${projectId}#project-connections`} provider="github" label="GitHub" status="Connect repository" />
                )}
                <SourceConnectionChips only={["drive", "jira", "linear"]} />
              </>
            )}
            {creationStep === 1 && (
              <div style={{ display: "grid", gap: 12 }}>
                <label>
                  Requirement title
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="For example: alert the operator when supply voltage is outside limits"
                  />
                </label>
                <label>
                  Expected behavior and acceptance conditions
                  <textarea
                    rows={5}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Who needs this? Under what conditions? What measurable outcome confirms it works?"
                  />
                </label>
                <label>
                  Source reference (optional)
                  <input
                    value={externalRef}
                    onChange={(event) => setExternalRef(event.target.value)}
                    placeholder="Specification section, ticket ID or document URL"
                  />
                </label>
              </div>
            )}
            {creationStep === 2 && (
              <div>
                <h4>{title}</h4>
                <p style={{ whiteSpace: "pre-wrap" }}>
                  {description || "No additional acceptance details supplied."}
                </p>
                {externalRef && <p>Source: {externalRef}</p>}
                <p className="text-muted">
                  This creates a requirement only. It does not claim that any
                  tests have passed.
                </p>
              </div>
            )}
            {error && (
              <p role="alert" style={{ color: "var(--ember)" }}>
                {error}
              </p>
            )}
          </CreationWizard>
        </Modal>
      )}

      {canEdit && editingId && (
        <div
          style={{ display: "grid", gap: 8, margin: "16px 0", maxWidth: 420 }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
          />
          <input
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="External ref, e.g. JIRA-123 (optional)"
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} disabled={saving || !title}>
              {saving
                ? "Saving…"
                : editingId
                  ? "Save changes"
                  : "+ New requirement"}
            </button>
            {editingId && <button onClick={resetForm}>Cancel</button>}
          </div>
        </div>
      )}

      {loading && <p>Loading…</p>}
      {displayError && <p style={{ color: "var(--ember)" }}>{displayError}</p>}

      {requirements.length > 0 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search requirements…"
          style={{ maxWidth: 300, marginBottom: 10 }}
        />
      )}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {visibleRequirements.map((r) => (
          <li
            key={r.id}
            style={{
              marginBottom: 10,
              borderBottom: "1px solid var(--line)",
              paddingBottom: 8,
            }}
          >
            <strong>{r.title}</strong>{" "}
            {r.externalRef && (
              <span style={{ color: "var(--muted-dim)" }}>
                [{r.externalRef}]
              </span>
            )}
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              {r.description}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted-dim)" }}>
              {r.acceptanceCriteriaCount} linked acceptance criteria
            </div>
            {canEdit && (
              <LinearLinkControl requirement={r} onChanged={reload} />
            )}
            {canEdit && <JiraLinkControl requirement={r} onChanged={reload} />}
            {canEdit && <ShareLinkControl requirement={r} onChanged={reload} />}
            {canEdit && (
              <>
                <button
                  onClick={() => startEdit(r)}
                  style={{ marginRight: 8, marginTop: 6 }}
                >
                  Edit
                </button>
                <button onClick={() => remove(r.id)} style={{ marginRight: 8 }}>
                  Delete
                </button>
                <button onClick={() => setGeneratingForId(r.id)}>
                  Generate test cases with AI
                </button>
              </>
            )}
          </li>
        ))}
        {!loading && requirements.length === 0 && (
          <p style={{ color: "var(--muted)" }}>No requirements yet.</p>
        )}
        {!loading &&
          requirements.length > 0 &&
          visibleRequirements.length === 0 && (
            <p style={{ color: "var(--muted)" }}>No requirements match.</p>
          )}
      </ul>

      {canEdit && generatingForId && (
        <GenerateTestCasesModal
          requirementId={generatingForId}
          projectId={projectId}
          onClose={() => setGeneratingForId(null)}
          onCreated={reload}
        />
      )}
      {canEdit && markdownModalOpen && (
        <ExtractFromMarkdownModal
          projectId={projectId}
          onClose={() => setMarkdownModalOpen(false)}
          onCreated={reload}
        />
      )}
      {canEdit && repoModalOpen && repoUrl && (
        <ExtractFromRepoModal
          projectId={projectId}
          repoUrl={repoUrl}
          onClose={() => setRepoModalOpen(false)}
          onCreated={reload}
        />
      )}
    </div>
  );
}
