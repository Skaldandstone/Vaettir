"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpcReact } from "../../lib/trpcReact";
import { Icon } from "../../components/ui/Workspace";

// Clerk only knows the signed-in person, not our org/seat model. A brand
// new user has zero Organizations until they create one (here) or accept
// an invite (P12-02, not yet built).
// P1-15
export default function OnboardingPage() {
  const router = useRouter();
  const orgsQuery = trpcReact.organization.mine.useQuery();
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (orgsQuery.data && orgsQuery.data.length > 0) router.push("/projects");
  }, [orgsQuery.data, router]);

  const bootstrapMutation = trpcReact.organization.bootstrap.useMutation({
    onSuccess: () => router.push("/projects"),
    onError: (e) => setError(e.message),
  });

  function submit() {
    setError(null);
    bootstrapMutation.mutate({ organizationName });
  }

  const checking = orgsQuery.isLoading || Boolean(orgsQuery.data && orgsQuery.data.length > 0);
  if (checking) return <div className="workspace-loading" role="status"><span className="loading-indicator" aria-hidden="true" /><p>Checking your invitation…</p></div>;
  if (orgsQuery.error) return <div className="workspace-alert workspace-alert-error" role="alert"><Icon name="alert" /><div><strong>We could not verify your access</strong><p>{orgsQuery.error.message}</p></div></div>;

  return (
    <div className="auth-workspace onboarding-workspace">
      <section className="auth-introduction">
        <p className="workspace-breadcrumb">PRIVATE BETA / WORKSPACE SETUP</p>
        <h1>Give your invited team a home.</h1>
        <p>Your workspace connects projects, cases, CI evidence, and release sign-offs without mixing data between organizations.</p>
      </section>
      <section className="workspace-panel onboarding-card" aria-labelledby="onboarding-title">
        <span className="onboarding-icon"><Icon name="people" size={22} /></span>
        <h2 id="onboarding-title">Set up your workspace</h2>
        <p className="text-muted">Use the name your team will recognize. You can refine organization settings later.</p>
        <div className="form-stack">
        <label>
          Organization name
          <input
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            placeholder="Acme Quality Engineering"
            autoComplete="organization"
            autoFocus
          />
        </label>
        <button className="btn-primary" onClick={submit} disabled={bootstrapMutation.isPending || !organizationName.trim()}>
          {bootstrapMutation.isPending ? "Creating workspace…" : "Create workspace"}
        </button>
        {error && <p className="text-error" role="alert">{error}</p>}
        </div>
        <p className="onboarding-footnote">Workspace creation is restricted to approved private-beta enrollment.</p>
      </section>
      </div>
  );
}
