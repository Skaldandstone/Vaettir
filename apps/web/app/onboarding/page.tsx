"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpcReact } from "../../lib/trpcReact";

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
  if (checking) return <p>Loading…</p>;
  if (orgsQuery.error) return <p style={{ color: "var(--ember)" }}>{orgsQuery.error.message}</p>;

  return (
    <div style={{ maxWidth: 360 }}>
      <h1>Create your organization</h1>
      <p>This is the workspace your projects, test cases, and teammates will live in.</p>
      <div style={{ display: "grid", gap: 8 }}>
        <label>
          Organization name
          <input
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <button onClick={submit} disabled={bootstrapMutation.isPending || !organizationName}>
          {bootstrapMutation.isPending ? "Creating…" : "Create organization"}
        </button>
        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      </div>
    </div>
  );
}
