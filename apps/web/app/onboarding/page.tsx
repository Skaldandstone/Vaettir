"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RecoveryMessage } from "../../components/RecoveryMessage";
import { Icon } from "../../components/ui/Workspace";
import { trpcReact } from "../../lib/trpcReact";

type AccessStatus = "NOT_ENROLLED" | "REVOKED" | "CLAIMED" | "ELIGIBLE";

function OnboardingSteps({ status }: { status: AccessStatus }) {
  const accessReady = status === "ELIGIBLE";
  return (
    <ol className="onboarding-steps" aria-label="Onboarding progress">
      <li className={accessReady ? "is-complete" : "is-current"}>
        <span>{accessReady ? <Icon name="check" size={15} /> : "1"}</span>
        <div><strong>Access</strong><small>{accessReady ? "Verified" : "Confirm invitation"}</small></div>
      </li>
      <li className={accessReady ? "is-current" : ""}>
        <span>2</span>
        <div><strong>Workspace</strong><small>Name your team</small></div>
      </li>
      <li>
        <span>3</span>
        <div><strong>Ready</strong><small>Select a project</small></div>
      </li>
    </ol>
  );
}

function AccessPanel({
  status,
  email,
  canManageEnrollments,
  onEnroll,
  enrolling,
  error,
}: {
  status: Exclude<AccessStatus, "ELIGIBLE">;
  email: string;
  canManageEnrollments: boolean;
  onEnroll: () => void;
  enrolling: boolean;
  error: string | null;
}) {
  const content = status === "REVOKED"
    ? {
        icon: "alert" as const,
        title: "This beta invitation is no longer active",
        body: "Workspace creation is paused for this account. Ask the person who invited you to review the enrollment before trying again.",
      }
    : status === "CLAIMED"
      ? {
          icon: "alert" as const,
          title: "This invitation has already been used",
          body: "The owner invitation is linked to a workspace, but this account does not currently have workspace access. Beta support can restore the correct membership without creating a duplicate organization.",
        }
      : {
          icon: "people" as const,
          title: canManageEnrollments ? "Reserve your owner workspace" : "Your demo account is ready",
          body: canManageEnrollments
            ? "This is the approved full-access owner account. Reserve the private workspace before creating it."
            : "You can explore Vaettir's sales demo now. Customer workspaces, AI actions, integrations, imports, and administrative controls require explicit access.",
        };

  return (
    <section className="workspace-panel onboarding-card" aria-labelledby="access-title">
      <span className={`onboarding-icon${content.icon === "alert" ? " is-warning" : ""}`}>
        <Icon name={content.icon} size={22} />
      </span>
      <p className="onboarding-account">Signed in as <strong>{email}</strong></p>
      <h2 id="access-title">{content.title}</h2>
      <p className="text-muted">{content.body}</p>
      {status === "NOT_ENROLLED" && canManageEnrollments && (
        <button className="btn-primary onboarding-primary-action" type="button" onClick={onEnroll} disabled={enrolling}>
          {enrolling ? "Reserving access…" : "Reserve beta workspace"}
        </button>
      )}
      {status === "NOT_ENROLLED" && !canManageEnrollments && (
        <Link className="btn-primary onboarding-primary-action" href="/">
          Explore the sales demo
        </Link>
      )}
      {error && <p className="text-error onboarding-action-error" role="alert">{error}</p>}
      <div className="onboarding-paths">
        <div>
          <strong>Joining an existing team?</strong>
          <p>Open the invitation link sent to this exact email address.</p>
        </div>
        <div>
          <strong>Wrong account or invitation?</strong>
          <p><Link href="/sign-in">Switch accounts</Link> or review the <Link href="/beta-guide">beta access guide</Link>.</p>
        </div>
      </div>
    </section>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const orgsQuery = trpcReact.organization.mine.useQuery(undefined, { retry: false });
  const needsAccessCheck = orgsQuery.data?.length === 0;
  const eligibilityQuery = trpcReact.beta.eligibility.useQuery(undefined, {
    enabled: needsAccessCheck,
    retry: false,
  });
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (orgsQuery.data && orgsQuery.data.length > 0) router.replace("/projects");
  }, [orgsQuery.data, router]);

  const bootstrapMutation = trpcReact.organization.bootstrap.useMutation({
    onSuccess: () => router.replace("/projects"),
    onError: (mutationError) => setError(mutationError.message),
  });
  const enrollMutation = trpcReact.beta.enroll.useMutation({
    onSuccess: async () => {
      setError(null);
      await eligibilityQuery.refetch();
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = organizationName.trim();
    if (!trimmedName) return;
    setError(null);
    bootstrapMutation.mutate({ organizationName: trimmedName });
  }

  function retry() {
    setError(null);
    void Promise.all([orgsQuery.refetch(), eligibilityQuery.refetch()]);
  }

  const checking = orgsQuery.isLoading
    || Boolean(orgsQuery.data && orgsQuery.data.length > 0)
    || (needsAccessCheck && eligibilityQuery.isLoading);
  if (checking) {
    return <div className="workspace-loading onboarding-loading" role="status"><span className="loading-indicator" aria-hidden="true" /><p>Checking your workspace and invitation…</p></div>;
  }

  const queryError = orgsQuery.error ?? eligibilityQuery.error;
  if (queryError) return <RecoveryMessage error={queryError.message} onRetry={retry} />;
  if (!eligibilityQuery.data) return null;

  const eligibility = eligibilityQuery.data;
  const status = eligibility.status;

  return (
    <div className="auth-workspace onboarding-workspace">
      <section className="auth-introduction">
        <p className="workspace-breadcrumb">DEMO ACCESS / GET STARTED</p>
        <h1>Explore safely, then unlock the workspace your team needs.</h1>
        <p>Every account can use the sales demo. Vaettir keeps customer workspaces isolated and unlocks protected capabilities only after explicit access is granted.</p>
        <OnboardingSteps status={status} />
        <aside className="onboarding-safety-note">
          <Icon name="alert" size={17} />
          <p><strong>Beta data boundary</strong><br />Use non-regulated project data and test code only. Do not add secrets or regulated personal data.</p>
        </aside>
      </section>

      {status !== "ELIGIBLE" ? (
        <AccessPanel
          status={status}
          email={eligibility.email}
          canManageEnrollments={eligibility.canManageEnrollments}
          enrolling={enrollMutation.isPending}
          error={error}
          onEnroll={() => {
            setError(null);
            enrollMutation.mutate({ email: eligibility.email, reason: "Staff dogfood onboarding" });
          }}
        />
      ) : (
        <section className="workspace-panel onboarding-card" aria-labelledby="onboarding-title">
          <span className="onboarding-icon"><Icon name="people" size={22} /></span>
          <p className="onboarding-account"><span className="status-dot" /> Access verified for <strong>{eligibility.email}</strong></p>
          <h2 id="onboarding-title">Name your workspace</h2>
          <p className="text-muted">Use the company or team name people will recognize. You can refine organization settings later.</p>
          <form className="form-stack" onSubmit={submit}>
            <label>
              Organization name
              <input
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Acme Quality Engineering"
                autoComplete="organization"
                autoFocus
                maxLength={120}
                required
              />
            </label>
            <button className="btn-primary" type="submit" disabled={bootstrapMutation.isPending || !organizationName.trim()}>
              {bootstrapMutation.isPending ? "Creating workspace…" : "Create workspace and continue"}
              {!bootstrapMutation.isPending && <Icon name="arrow" size={16} />}
            </button>
            {error && <p className="text-error onboarding-action-error" role="alert">{error}</p>}
          </form>
          <p className="onboarding-footnote">Creates one private-beta organization with 5 full seats, 2 read-only seats, and 500 non-rolling AI credits per month. No automatic overage.</p>
        </section>
      )}
    </div>
  );
}
