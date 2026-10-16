"use client";
import { useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";

type Publish = RouterInputs["atlassianQuality"]["publish"];
export function AtlassianQualitySettings({
  projectId,
  organizationId,
  canConfigure,
}: {
  projectId: string;
  organizationId: string;
  canConfigure: boolean;
}) {
  const { userId, isLoaded, isSignedIn } = useAuth();
  const query = trpcReact.atlassianQuality.settings.useQuery(
    { projectId, organizationId },
    {
      enabled: canConfigure && isLoaded && isSignedIn,
      staleTime: 0,
      retry: false,
    },
  );
  const publish = trpcReact.atlassianQuality.publish.useMutation(),
    revoke = trpcReact.atlassianQuality.revoke.useMutation();
  const [bindingText, setBindingText] = useState(""),
    [snapshots, setSnapshots] = useState<string[]>([]),
    [tickets, setTickets] = useState(false),
    [releaseLinks, setReleaseLinks] = useState<Publish["releaseLinks"]>([]),
    [closureIds, setClosureIds] = useState<string[]>([]),
    [approved, setApproved] = useState(false),
    [connectionId, setConnectionId] = useState<string | null>(null),
    [baselineVersion, setBaselineVersion] = useState(0),
    [message, setMessage] = useState("");
  const pending = useRef<Publish | null>(null),
    pendingRevoke = useRef<Parameters<typeof revoke.mutateAsync>[0] | null>(
      null,
    );
  const [publishRetained, setPublishRetained] = useState(false),
    [revokeRetained, setRevokeRetained] = useState(false);
  const data =
    canConfigure &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.organizationId === organizationId &&
    query.data.actorClerkUserId === userId
      ? query.data
      : null;
  let binding: Publish["binding"] | null = null;
  try {
    const candidate = JSON.parse(bindingText) as Publish["binding"];
    if (
      candidate &&
      typeof candidate.siteOrigin === "string" &&
      typeof candidate.targetId === "string" &&
      ["jira", "confluence"].includes(candidate.product)
    )
      binding = candidate;
  } catch {
    /* incomplete pasted metadata is not a command */
  }
  const busy = publish.isPending || revoke.isPending,
    retained = publishRetained || revokeRetained;
  async function save() {
    if (!data || !binding || !approved) return;
    pending.current ??= {
      projectId,
      organizationId,
      binding,
      connectionId: connectionId ?? crypto.randomUUID(),
      expectedVersion: baselineVersion,
      requestId: crypto.randomUUID(),
      snapshotIds: snapshots,
      shareTicketTests: tickets && binding.product === "jira",
      releaseLinks: binding.product === "jira" ? releaseLinks : [],
      closureSnapshotIds: closureIds,
      approveTargetSharing: true,
    };
    setPublishRetained(true);
    try {
      setMessage("");
      const acknowledgement = await publish.mutateAsync(pending.current);
      setConnectionId(pending.current.connectionId);
      setBaselineVersion(acknowledgement.version);
      pending.current = null;
      setPublishRetained(false);
      setApproved(false);
      setMessage(
        acknowledgement.state === "APPROVED"
          ? "Quality sharing approval recorded for this target. Architecture sources and mappings remain in Vaettir."
          : "Your earlier approval was recorded, but sharing has since stopped. Review the current connection state.",
      );
      await query.refetch();
    } catch (e) {
      if (
        ["BAD_REQUEST", "CONFLICT"].includes(
          (e as { data?: { code?: string } }).data?.code ?? "",
        )
      ) {
        pending.current = null;
        setPublishRetained(false);
      }
      setMessage(
        e instanceof Error
          ? e.message
          : "Save unconfirmed. Recover this request before changing scope.",
      );
    }
  }
  async function stopSharing(id: string) {
    if (!data || pending.current) return;
    pendingRevoke.current ??= {
      projectId,
      organizationId,
      id,
      requestId: crypto.randomUUID(),
    };
    setRevokeRetained(true);
    try {
      setMessage("");
      const acknowledgement = await revoke.mutateAsync(pendingRevoke.current);
      pendingRevoke.current = null;
      setRevokeRetained(false);
      setMessage(
        acknowledgement.state === "REVOKED"
          ? "Sharing stopped. Vaettir records and existing captures were not deleted."
          : "Your earlier stop-sharing request was recorded, but a later approval is active. Review the current connection before taking another action.",
      );
      await query.refetch();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Revocation unconfirmed. Recover this request.",
      );
    }
  }
  if (!canConfigure) return null;
  return (
    <section
      className="panel"
      style={{ marginBlock: 24, padding: 24 }}
      aria-labelledby="atlassian-quality-settings"
    >
      <h2 id="atlassian-quality-settings">
        Jira &amp; Confluence quality sharing
      </h2>
      <p>
        Publish selected quality captures to a specific Jira project or
        Confluence space. Jira ticket panels can separately show explicitly
        linked tests and recorded results. Architecture analysis and mappings
        stay in Vaettir.
      </p>
      {message && <p role="status">{message}</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      {!data && !query.error && (
        <p role="status">Checking current sharing permissions…</p>
      )}
      {data && (!data.appId || !data.environmentId) && (
        <p role="note">
          The company-owned Atlassian app has not been enabled on this Vaettir
          deployment yet. No sharing can be approved until setup is verified.
        </p>
      )}
      {data && (
        <>
          {!!data.connections.length && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Atlassian target</th>
                    <th>Access</th>
                    <th>Shared evidence</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.connections.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {c.binding.siteOrigin}
                        <br />
                        {c.binding.product === "jira"
                          ? "Jira project"
                          : "Confluence space"}{" "}
                        {c.binding.targetId}
                        <br />
                        <small>
                          Connection key: <code>{c.id}</code>
                        </small>
                      </td>
                      <td>
                        {c.state === "APPROVED"
                          ? "Sharing enabled"
                          : "Sharing stopped"}
                      </td>
                      <td>
                        {c.snapshotIds.length} approved captures
                        {c.shareTicketTests ? " · Linked ticket tests" : ""}
                        {c.releaseLinks.length
                          ? ` · ${c.releaseLinks.length} linked releases`
                          : ""}
                        {c.closureSnapshotIds.length
                          ? ` · ${c.closureSnapshotIds.length} closure captures`
                          : ""}
                      </td>
                      <td>
                        <div
                          style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
                        >
                          <button
                            type="button"
                            disabled={busy || retained}
                            onClick={() => {
                              setConnectionId(c.connectionId);
                              setBaselineVersion(c.version);
                              setBindingText(
                                JSON.stringify(c.binding, null, 2),
                              );
                              setSnapshots(c.snapshotIds);
                              setTickets(c.shareTicketTests);
                              setReleaseLinks(c.releaseLinks);
                              setClosureIds(c.closureSnapshotIds);
                              setApproved(false);
                            }}
                          >
                            Edit sharing
                          </button>
                          <button
                            type="button"
                            disabled={busy || retained || c.state === "REVOKED"}
                            onClick={() => void stopSharing(c.id)}
                          >
                            Stop sharing
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            style={{ display: "grid", gap: 16, marginTop: 24 }}
          >
            <fieldset
              disabled={busy || retained || !data.appId || !data.environmentId}
              style={{ border: 0, padding: 0 }}
            >
              <legend>
                {connectionId
                  ? "Update this connection"
                  : "Approve a connection"}
              </legend>
              <label style={{ display: "grid", gap: 8, marginBlock: 12 }}>
                Verified target metadata
                <textarea
                  rows={6}
                  value={bindingText}
                  onChange={(e) => {
                    setBindingText(e.target.value);
                    setApproved(false);
                  }}
                  placeholder="Paste the non-secret connection metadata shown by the Vaettir app in Jira or Confluence"
                />
              </label>
              {binding && (
                <p>
                  Audience: people who can view{" "}
                  {binding.product === "jira"
                    ? "Jira project"
                    : "Confluence space"}{" "}
                  {binding.targetId} at {binding.siteOrigin}. They do not need a
                  Vaettir account to see the evidence approved below; private
                  source, architecture and attachments are excluded.
                </p>
              )}
              <h3>Approved captures to share</h3>
              {!data.snapshots.length && (
                <p>
                  Create and approve a report capture first, or enable linked
                  ticket verification without sharing a report.
                </p>
              )}
              <div
                style={{
                  maxHeight: 300,
                  overflowY: "auto",
                  display: "grid",
                  gap: 10,
                }}
              >
                {data.snapshots.map((s) => (
                  <label
                    key={s.id}
                    style={{ display: "flex", gap: 10, alignItems: "start" }}
                  >
                    <input
                      type="checkbox"
                      checked={snapshots.includes(s.id)}
                      onChange={(e) => {
                        setSnapshots((current) =>
                          e.target.checked
                            ? [...current, s.id]
                            : current.filter((id) => id !== s.id),
                        );
                        setApproved(false);
                      }}
                    />
                    <span>
                      {s.title} · {new Date(s.asOf).toLocaleString()}
                      <br />
                      <small>
                        Frozen snapshot ID: <code>{s.id}</code>
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              {binding?.product === "jira" && (
                <section style={{ display: "grid", gap: 12, marginBlock: 20 }}>
                  <h3>Release tracking</h3>
                  <p>
                    Link a Jira version to a Vaettir release and choose the runs
                    that validate it. Show live metrics before release. The
                    first successful capture following Jira marking the version
                    Released is retained permanently; reopening or editing runs
                    does not overwrite it. Capture time may lag the Jira
                    transition. This does not approve release readiness.
                  </p>
                  {releaseLinks.map((link, index) => (
                    <div
                      key={index}
                      style={{
                        display: "grid",
                        gap: 12,
                        border: "1px solid var(--line)",
                        padding: 16,
                      }}
                    >
                      <label style={{ display: "grid", gap: 6 }}>
                        Jira version ID
                        <input
                          inputMode="numeric"
                          value={link.jiraVersionId}
                          onChange={(e) => {
                            setReleaseLinks((current) =>
                              current.map((l, i) =>
                                i === index
                                  ? { ...l, jiraVersionId: e.target.value }
                                  : l,
                              ),
                            );
                            setApproved(false);
                          }}
                          placeholder="Numeric ID from the Jira version URL"
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        Vaettir release
                        <select
                          value={link.releaseId}
                          onChange={(e) => {
                            setReleaseLinks((current) =>
                              current.map((l, i) =>
                                i === index
                                  ? { ...l, releaseId: e.target.value }
                                  : l,
                              ),
                            );
                            setApproved(false);
                          }}
                        >
                          <option value="">Choose a release</option>
                          {link.releaseId &&
                            !data.releases.some(
                              (r) => r.id === link.releaseId,
                            ) && (
                              <option value={link.releaseId}>
                                Previously selected · {link.releaseId}
                              </option>
                            )}
                          {data.releases.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <fieldset style={{ maxHeight: 240, overflowY: "auto" }}>
                        <legend>
                          Validation runs · {link.runIds.length} selected
                        </legend>
                        {!link.runIds.length && (
                          <p>
                            No runs selected. Planned cases will appear as
                            unrun, not passed.
                          </p>
                        )}
                        {link.runIds
                          .filter((id) => !data.runs.some((r) => r.id === id))
                          .map((id) => (
                            <label
                              key={id}
                              style={{
                                display: "flex",
                                gap: 8,
                                marginBlock: 8,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked
                                onChange={() => {
                                  setReleaseLinks((current) =>
                                    current.map((l, i) =>
                                      i === index
                                        ? {
                                            ...l,
                                            runIds: l.runIds.filter(
                                              (r) => r !== id,
                                            ),
                                          }
                                        : l,
                                    ),
                                  );
                                  setApproved(false);
                                }}
                              />
                              Retained selection · {id}
                            </label>
                          ))}
                        {data.runs.map((run) => (
                          <label
                            key={run.id}
                            style={{ display: "flex", gap: 8, marginBlock: 10 }}
                          >
                            <input
                              type="checkbox"
                              checked={link.runIds.includes(run.id)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setReleaseLinks((current) =>
                                  current.map((l, i) =>
                                    i === index
                                      ? {
                                          ...l,
                                          runIds: checked
                                            ? [...l.runIds, run.id]
                                            : l.runIds.filter(
                                                (id) => id !== run.id,
                                              ),
                                        }
                                      : l,
                                  ),
                                );
                                setApproved(false);
                              }}
                            />
                            <span>
                              {new Date(run.startedAt).toLocaleString()} ·{" "}
                              {run.status} · {run.branch || "No branch"} ·{" "}
                              {run.commitSha || "No recorded revision"}
                              <br />
                              <small>{run.id}</small>
                            </span>
                          </label>
                        ))}
                      </fieldset>
                      <button
                        type="button"
                        onClick={() => {
                          setReleaseLinks((current) =>
                            current.filter((_, i) => i !== index),
                          );
                          setApproved(false);
                        }}
                      >
                        Remove this release link
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={releaseLinks.length >= 50}
                    onClick={() => {
                      setReleaseLinks((current) => [
                        ...current,
                        { jiraVersionId: "", releaseId: "", runIds: [] },
                      ]);
                      setApproved(false);
                    }}
                  >
                    Link a release
                  </button>
                </section>
              )}
              {!!data.closures.length && (
                <section style={{ display: "grid", gap: 10, marginBlock: 20 }}>
                  <h3>Historical release captures</h3>
                  <p>
                    Approve these separately for this audience. A Jira project
                    approval never grants a Confluence space access.
                  </p>
                  {data.closures.map((c) => (
                    <label key={c.id} style={{ display: "flex", gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={closureIds.includes(c.id)}
                        onChange={(e) => {
                          setClosureIds((current) =>
                            e.target.checked
                              ? [...current, c.id]
                              : current.filter((id) => id !== c.id),
                          );
                          setApproved(false);
                        }}
                      />
                      <span>
                        {c.releaseName} · {c.jiraVersionName} ·{" "}
                        {new Date(c.capturedAt).toLocaleString()}
                        <br />
                        <small>
                          Closure capture ID: <code>{c.id}</code>
                        </small>
                      </span>
                    </label>
                  ))}
                </section>
              )}
              {data.catalogLimited && (
                <p role="note">
                  Showing the latest 500 items in each evidence catalog.
                  Existing selections are retained; no older evidence was
                  substituted.
                </p>
              )}
              {binding?.product === "jira" && (
                <label style={{ display: "flex", gap: 10, marginBlock: 16 }}>
                  <input
                    type="checkbox"
                    checked={tickets}
                    onChange={(e) => {
                      setTickets(e.target.checked);
                      setApproved(false);
                    }}
                  />
                  Share names, references, review status, recorded outcomes and
                  run links for tests explicitly linked to tickets in this Jira
                  project. This updates as Vaettir records change; it does not
                  expose procedure text or attachments.
                </label>
              )}
              <label style={{ display: "flex", gap: 10, marginBlock: 16 }}>
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                I approve sharing this selected evidence with the target
                audience above. Jira access does not grant Confluence access.
              </label>
            </fieldset>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <button
                type="submit"
                disabled={
                  busy ||
                  revokeRetained ||
                  !approved ||
                  !binding ||
                  (!snapshots.length &&
                    !closureIds.length &&
                    !(releaseLinks.length && binding.product === "jira") &&
                    !(tickets && binding.product === "jira"))
                }
              >
                {publishRetained
                  ? "Recover this save"
                  : "Save sharing approval"}
              </button>
              {!retained && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConnectionId(null);
                    setBaselineVersion(0);
                    setBindingText("");
                    setSnapshots([]);
                    setTickets(false);
                    setReleaseLinks([]);
                    setClosureIds([]);
                    setApproved(false);
                  }}
                >
                  Clear form
                </button>
              )}
              {revokeRetained && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void stopSharing(pendingRevoke.current!.id)}
                >
                  Recover stop-sharing request
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
