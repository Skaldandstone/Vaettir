"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { RecoveryMessage } from "../../../components/RecoveryMessage";
import { Icon } from "../../../components/ui/Workspace";
import { trpcReact } from "../../../lib/trpcReact";

function InvitationUnavailable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="workspace-panel onboarding-card" aria-labelledby="invitation-state-title">
      <span className="onboarding-icon is-warning"><Icon name="alert" size={22} /></span>
      <h2 id="invitation-state-title">{title}</h2>
      <p className="text-muted">{children}</p>
      <div className="guide-actions">
        <Link className="btn-secondary" href="/beta-guide">Review beta access</Link>
        <Link href="/projects">Go to projects</Link>
      </div>
    </section>
  );
}

export default function AcceptInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const previewQuery = trpcReact.organization.previewInvitation.useQuery({ token: params.token }, { retry: false });
  const acceptMutation = trpcReact.organization.acceptInvitation.useMutation({
    onSuccess: () => router.replace("/projects"),
  });

  if (previewQuery.isLoading) {
    return <div className="workspace-loading onboarding-loading" role="status"><span className="loading-indicator" aria-hidden="true" /><p>Checking your team invitation…</p></div>;
  }
  if (previewQuery.error) {
    return <RecoveryMessage error={previewQuery.error.message} onRetry={() => void previewQuery.refetch()} />;
  }
  if (!previewQuery.data) return null;

  const preview = previewQuery.data;
  let unavailable: { title: string; body: string } | null = null;
  if (preview.status !== "PENDING") {
    unavailable = {
      title: preview.status === "ACCEPTED" ? "This invitation has already been accepted" : "This invitation is no longer available",
      body: preview.status === "ACCEPTED"
        ? "Open Projects to continue with the workspace. If it is missing, ask the workspace owner to review your membership."
        : "Ask the workspace owner to send a new invitation before trying again.",
    };
  } else if (preview.expired) {
    unavailable = { title: "This invitation has expired", body: "Ask the workspace owner to send a new invitation. Old links cannot be reactivated." };
  } else if (!preview.emailMatches) {
    unavailable = { title: "This invitation belongs to another account", body: "Switch accounts and sign in with the exact email address that received the invitation." };
  }

  return (
    <div className="auth-workspace onboarding-workspace">
      <section className="auth-introduction">
        <p className="workspace-breadcrumb">PRIVATE BETA / TEAM INVITATION</p>
        <h1>Join {preview.organizationName} with the access your team selected.</h1>
        <p>Review the assigned role and seat before joining. Vaettir keeps this workspace separate from every other organization.</p>
        <ol className="onboarding-steps" aria-label="Invitation progress">
          <li className="is-complete"><span><Icon name="check" size={15} /></span><div><strong>Invitation</strong><small>Link verified</small></div></li>
          <li className={!unavailable ? "is-current" : ""}><span>2</span><div><strong>Access</strong><small>Review role and seat</small></div></li>
          <li><span>3</span><div><strong>Ready</strong><small>Select a project</small></div></li>
        </ol>
        <aside className="onboarding-safety-note">
          <Icon name="alert" size={17} />
          <p><strong>Beta data boundary</strong><br />Use non-regulated project data and test code only. Do not add secrets or regulated personal data.</p>
        </aside>
      </section>

      {unavailable ? (
        <InvitationUnavailable title={unavailable.title}>{unavailable.body}</InvitationUnavailable>
      ) : (
        <section className="workspace-panel onboarding-card" aria-labelledby="accept-invitation-title">
          <span className="onboarding-icon"><Icon name="people" size={22} /></span>
          <p className="onboarding-account"><span className="status-dot" /> Invitation verified</p>
          <h2 id="accept-invitation-title">Your access to {preview.organizationName}</h2>
          <dl className="invitation-summary">
            <div><dt>Role</dt><dd>{preview.role.replaceAll("_", " ").toLowerCase()}</dd></div>
            <div><dt>Seat</dt><dd>{preview.seatType.replaceAll("_", " ").toLowerCase()}</dd></div>
          </dl>
          <button className="btn-primary onboarding-primary-action" type="button" onClick={() => acceptMutation.mutate({ token: params.token })} disabled={acceptMutation.isPending}>
            {acceptMutation.isPending ? "Joining workspace…" : "Accept and continue"}
            {!acceptMutation.isPending && <Icon name="arrow" size={16} />}
          </button>
          {acceptMutation.error && <p className="text-error onboarding-action-error" role="alert">{acceptMutation.error.message}</p>}
          <p className="onboarding-footnote">Only accept invitations you expected. Ask the workspace owner if the role or seat is incorrect.</p>
        </section>
      )}
    </div>
  );
}
