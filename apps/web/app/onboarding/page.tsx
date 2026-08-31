"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "../../lib/trpc";
import { RecoveryMessage } from "../../components/RecoveryMessage";

// Clerk only knows the signed-in person, not our org/seat model. A brand
// new user has zero Organizations until they create one (here) or accept
// an invitation. Eligibility is checked server-side before organization creation.
export default function OnboardingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [eligible, setEligible] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setChecking(true);
    setError(null);
    trpc.organization.mine
      .query()
      .then(async (orgs) => {
        if (!active) return;
        if (orgs.length > 0) {
          router.push("/projects");
        } else {
          const eligibility = await trpc.beta.eligibility.query();
          if (!active) return;
          setEligible(eligibility.eligible);
          setChecking(false);
        }
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
        setChecking(false);
      });
    return () => { active = false; };
  }, [router, attempt]);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await trpc.organization.bootstrap.mutate({ organizationName: organizationName.trim() });
      router.push("/projects");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (checking) return <p>Loading…</p>;
  if (error && !eligible) return <div><h1>Check your beta invitation</h1><RecoveryMessage error={error} onRetry={() => setAttempt((value) => value + 1)} /></div>;

  if (!eligible) return (
    <div style={{ maxWidth: 520 }}>
      <h1>Vaettir private beta</h1>
      <p>Access is by invitation. Open your team invitation link while signed in with the invited email address.</p>
      <p>Starting a new team? Ask your beta contact for an owner invitation.</p>
      {error && <p role="alert">{error}</p>}
      <button onClick={() => setAttempt((value) => value + 1)}>Check invitation again</button>
      <p><a href="/beta-guide">Read the beta onboarding guide</a></p>
    </div>
  );

  return (
    <div style={{ maxWidth: 360 }}>
      <h1>Create your organization</h1>
      <p>This is the workspace your projects, test cases, and teammates will live in.</p>
      <p>Private beta includes 5 full seats, 2 read-only seats, and 500 AI credits per month at no charge. Unused credits do not roll over.</p>
      <p>Use non-regulated project data only. Do not upload secrets or sensitive personal data. AI actions send the selected source code or text to Anthropic for processing.</p>
      <div style={{ display: "grid", gap: 8 }}>
        <label>
          Organization name
          <input
            value={organizationName}
            maxLength={120}
            onChange={(e) => setOrganizationName(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <button onClick={submit} disabled={loading || !organizationName.trim()}>
          {loading ? "Creating…" : "Create organization"}
        </button>
        {error && <RecoveryMessage error={error} />}
      </div>
    </div>
  );
}
