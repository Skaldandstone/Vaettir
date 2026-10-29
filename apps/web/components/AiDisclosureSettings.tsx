"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";

type Scope = {
  projectId: string;
  organizationId: string;
  canConfigure: boolean;
};
type Kind = "classify" | "issue" | "rotate" | "revoke";
type Pending = {
  [K in Kind]: { kind: K; input: RouterInputs["aiDisclosure"][K] };
}[Kind];

export function AiDisclosureSettings(props: Scope) {
  const auth = useAuth();
  return (
    <AiDisclosureControls
      key={[
        props.projectId,
        props.organizationId,
        auth.userId,
        auth.sessionId,
        auth.isSignedIn,
        props.canConfigure,
      ].join(":")}
      {...props}
    />
  );
}

function AiDisclosureControls({
  projectId,
  organizationId,
  canConfigure,
}: Scope) {
  const classificationHelpId = useId();
  const { userId, isLoaded, isSignedIn } = useAuth();
  const query = trpcReact.aiDisclosure.settings.useQuery(
    { projectId, organizationId },
    {
      enabled: canConfigure && isLoaded && isSignedIn,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
  );
  // Use the provider's account/session-bound transport directly: credentials
  // never enter React Query's mutation cache. No automatic mutation retries.
  const rpc = trpcReact.useUtils().client.aiDisclosure;
  const [classification, setClassification] =
    useState<RouterInputs["aiDisclosure"]["classify"]["classification"]>(
      "UNCLASSIFIED",
    );
  const [attest, setAttest] = useState(false),
    [approve, setApprove] = useState(false),
    [days, setDays] = useState(7);
  const [message, setMessage] = useState(""),
    [token, setToken] = useState<string | null>(null),
    [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const pending = useRef<Pending | null>(null),
    active = useRef(true),
    allowed = useRef(canConfigure),
    inFlight = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    allowed.current = Boolean(canConfigure && isSignedIn);
    return () => {
      active.current = false;
      allowed.current = false;
    };
  }, [canConfigure, isSignedIn]);
  const data =
    canConfigure &&
    isLoaded &&
    isSignedIn &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.projectId === projectId &&
    query.data.organizationId === organizationId &&
    query.data.actorClerkUserId === userId
      ? query.data
      : null;

  async function perform(next: Pending) {
    if (!data || inFlight.current || !allowed.current) return;
    inFlight.current = true;
    pending.current ??= next;
    const work = pending.current;
    setBusy(true);
    setUncertain(true);
    setToken(null);
    setRevealed(false);
    setMessage("");
    try {
      const ack =
        work.kind === "classify"
          ? await rpc.classify.mutate(work.input)
          : work.kind === "issue"
            ? await rpc.issue.mutate(work.input)
            : work.kind === "rotate"
              ? await rpc.rotate.mutate(work.input)
              : await rpc.revoke.mutate(work.input);
      if (!active.current || !allowed.current) return;
      pending.current = null;
      setUncertain(false);
      setApprove(false);
      setAttest(false);
      const refreshed = await query.refetch();
      if (
        !active.current ||
        !allowed.current ||
        refreshed.error ||
        refreshed.data?.actorClerkUserId !== userId ||
        refreshed.data?.projectId !== projectId ||
        refreshed.data?.organizationId !== organizationId
      )
        return;
      // Never reveal a credential after another admin revoked or reclassified it.
      const current = refreshed.data.grants.find((g) => g.id === ack.grantId);
      const validCredential =
        ack.token &&
        current &&
        current.version === ack.grantVersion &&
        current.enabled &&
        !current.revokedAt &&
        current.classificationVersion === refreshed.data.version;
      setToken(validCredential ? ack.token : null);
      setMessage(
        ack.token && !validCredential
          ? "Approval changed before the credential could be shown. Review the connection."
          : ack.replayed && (work.kind === "issue" || work.kind === "rotate")
            ? "This request was already recorded. Its credential cannot be recovered; review the connection and rotate it to obtain a new one."
            : work.kind === "classify"
              ? "Classification saved. Earlier grants are revoked."
              : work.kind === "revoke"
                ? "Connection revoked. New reads are blocked."
                : "Connection approved. Save its credential in your local connection settings; it is shown only once.",
      );
    } catch (error) {
      if (!active.current || !allowed.current) return;
      const code = (error as { data?: { code?: string } }).data?.code;
      if (
        [
          "BAD_REQUEST",
          "CONFLICT",
          "FORBIDDEN",
          "UNAUTHORIZED",
          "TOO_MANY_REQUESTS",
          "PRECONDITION_FAILED",
        ].includes(code ?? "")
      ) {
        pending.current = null;
        setUncertain(false);
        setMessage(
          "The action was refused. Refresh and review the current access and connection state.",
        );
      } else
        setMessage(
          "The outcome is unconfirmed. Retry this same request to recover its receipt before changing scope. A previously issued credential cannot be recovered.",
        );
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }
  const scope = { projectId, organizationId };
  const locked = !data || busy || uncertain;
  if (!canConfigure) return null;
  return (
    <section className="panel" aria-label="External AI access">
      <h2>External AI access</h2>
      <p>
        Human access and AI disclosure are separate permissions. Customer test
        content stays blocked. This preview shares only aggregate counts from a
        project you have reviewed as synthetic.
      </p>
      {!data && (
        <p role={query.error ? "alert" : "status"}>
          Administrator access could not yet be verified.{" "}
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh access
          </button>
        </p>
      )}
      {data && (
        <>
          {!data.enabled && (
            <p role="status">
              This project is not enabled for plugin connections in this
              deployment. Saved approvals cannot connect until it is enabled.
            </p>
          )}
          <p>
            Current classification:{" "}
            <strong>
              {data.classification.replaceAll("_", " ").toLowerCase()}
            </strong>
            . Only synthetic projects can be approved.
          </p>
        </>
      )}
      <fieldset disabled={locked} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <legend>1. Review project classification</legend>
        <label>
          Classification{" "}
          <select
            aria-describedby={classificationHelpId}
            style={{ maxWidth: "100%", minWidth: 0, width: "100%" }}
            value={classification}
            onChange={(e) => {
              setClassification(e.target.value as typeof classification);
              setAttest(false);
            }}
          >
            <option value="UNCLASSIFIED">
              Unclassified: data not yet reviewed
            </option>
            <option value="CUSTOMER_PROPRIETARY">
              Customer proprietary: confidential business or customer data
            </option>
            <option value="REGULATED">
              Regulated: protected health, personal, or other regulated data
            </option>
            <option value="SYNTHETIC">
              Synthetic only: fabricated data with no real customer information
            </option>
          </select>
        </label>
        <div id={classificationHelpId}>
          <p>
            {classification === "UNCLASSIFIED"
              ? "Choose Unclassified when the project has not been reviewed or its data sensitivity is uncertain."
              : classification === "CUSTOMER_PROPRIETARY"
                ? "Choose Customer proprietary for confidential customer or business information, such as internal requirements, test procedures, or unreleased product details. If regulated information is also present, choose Regulated."
                : classification === "REGULATED"
                  ? "Choose Regulated when tests, attachments, or results contain information subject to regulatory protections, such as patient health information or personal data."
                  : "Choose Synthetic only when all project data is fabricated for testing, with no real people, customer information, confidential business content, or regulated information. Anonymized or redacted customer data is not automatically synthetic."}
          </p>
          <p role="status">
            <strong>Plugin access:</strong>{" "}
            {classification === "SYNTHETIC"
              ? "Eligible for a separately approved, expiring counts-only connection after saving the classification and attestation. Selecting this option does not grant access."
              : "Blocked for this classification. Project data remains unavailable to the plugin."}
          </p>
        </div>
        {classification === "SYNTHETIC" && (
          <label style={{ display: "block", marginTop: 10 }}>
            <input
              type="checkbox"
              checked={attest}
              onChange={(e) => setAttest(e.target.checked)}
            />{" "}
            I reviewed this project and confirm it contains only synthetic data,
            with no customer or regulated information.
          </label>
        )}
        <p>
          Saving classification revokes all earlier grants, including when the
          classification stays the same. A label does not scan or sanitize
          project data.
        </p>
        <ActionButton
          type="button"
          disabled={locked || (classification === "SYNTHETIC" && !attest)}
          onClick={() =>
            data &&
            void perform({
              kind: "classify",
              input: {
                ...scope,
                requestId: crypto.randomUUID(),
                expectedVersion: data.version,
                classification,
                attestSynthetic: attest,
              },
            })
          }
         tooltip={<>
          Save classification and revoke earlier grants
         </>}>
           Save/revoke </ActionButton>
      </fieldset>
      <fieldset
        disabled={locked || data?.classification !== "SYNTHETIC"}
        style={{ border: 0, padding: 0, marginTop: 20 }}
      >
        <legend>2. Approve a Codex connection</legend>
        <p>
          Allowed: active test-case count, total test-plan count, and total
          test-run count. Small counts are withheld. Titles, steps, source,
          logs, attachments, personal information, and customer IP are excluded.
          The credential cannot use the general Vaettir API.
        </p>
        <label>
          Expires after{" "}
          <select
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setApprove(false);
            }}
          >
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
          </select>
        </label>
        <label style={{ display: "block", marginTop: 10 }}>
          <input
            type="checkbox"
            checked={approve}
            onChange={(e) => setApprove(e.target.checked)}
          />{" "}
          I approve these synthetic aggregate counts for this project and Codex
          connection. I understand a bearer credential can be used by anyone who
          holds it.
        </label>
        <ActionButton
          type="button"
          disabled={
            locked ||
            !approve ||
            data?.classification !== "SYNTHETIC" ||
            data.grantLimitReached
          }
          onClick={() =>
            data &&
            void perform({
              kind: "issue",
              input: {
                ...scope,
                requestId: crypto.randomUUID(),
                expectedPolicyVersion: data.version,
                recipient: "codex",
                scope: "aggregate_counts",
                lifetimeDays: days,
                approveDisclosure: true,
              },
            })
          }
         tooltip={<>
          Approve and issue credential
         </>}>
           Issue credential </ActionButton>
      </fieldset>
      {uncertain && !busy && (
        <ActionButton
          type="button"
          className="btn-secondary"
          disabled={!data}
          onClick={() => pending.current && void perform(pending.current)}
         tooltip={<>
          Recover pending request
         </>}>
           Recover </ActionButton>
      )}
      {message && <p role="status">{message}</p>}
      {data && token && (
        <div
          data-sentry-mask="true"
          data-private="true"
          style={{ marginTop: 12 }}
        >
          <label>
            One-time credential{" "}
            <input
              aria-label="One-time AI credential"
              type={revealed ? "text" : "password"}
              readOnly
              value={token}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setRevealed(!revealed)}
          >
            {revealed ? "Hide credential" : "Reveal credential"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setToken(null);
              setRevealed(false);
            }}
          >
            Dismiss credential
          </button>
          <p>
            Save it directly in your local plugin settings. Do not paste it into
            chat, a test, or a support ticket. Closing this view discards it. If
            lost, rotate the connection.
          </p>
        </div>
      )}
      {data && (
        <>
          <h3>Connections</h3>
          {data.grants.length === 0 && (
            <p>No AI access has been approved for this project.</p>
          )}
          {data.grants.map((grant) => (
            <div
              key={grant.id}
              style={{
                paddingBlock: 10,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <p>
                <strong>Codex</strong> · <code>{grant.keyHint}</code> ·{" "}
                {grant.revokedAt || !grant.enabled
                  ? "Revoked"
                  : grant.classificationVersion !== data.version
                    ? "Approval required"
                    : new Date(grant.expiresAt).getTime() <=
                        new Date(data.observedAt).getTime()
                      ? "Expired"
                      : "Approved"}{" "}
                · expires {new Date(grant.expiresAt).toLocaleDateString()}
              </p>
              <ActionButton
                type="button"
                className="btn-secondary"
                disabled={
                  locked ||
                  !approve ||
                  grant.revokedAt !== null ||
                  !grant.enabled ||
                  data.classification !== "SYNTHETIC"
                }
                onClick={() =>
                  void perform({
                    kind: "rotate",
                    input: {
                      ...scope,
                      requestId: crypto.randomUUID(),
                      grantId: grant.id,
                      expectedVersion: grant.version,
                      expectedPolicyVersion: data.version,
                      lifetimeDays: days,
                      approveDisclosure: true,
                    },
                  })
                }
               tooltip={<>
                Approve replacement credential
               </>}>
                 Issue replacement </ActionButton>{" "}
              <button
                type="button"
                className="btn-secondary"
                disabled={locked || grant.revokedAt !== null || !grant.enabled}
                onClick={() =>
                  void perform({
                    kind: "revoke",
                    input: {
                      ...scope,
                      requestId: crypto.randomUUID(),
                      grantId: grant.id,
                      expectedVersion: grant.version,
                    },
                  })
                }
              >
                Revoke connection
              </button>
            </div>
          ))}
          <h3>Recent access decisions</h3>
          {data.audit.length === 0 ? (
            <p>No access decisions recorded.</p>
          ) : (
            <ul>
              {data.audit.map((event) => (
                <li key={event.id}>
                  {event.event.replaceAll("_", " ").toLowerCase()} ·{" "}
                  {new Date(event.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
