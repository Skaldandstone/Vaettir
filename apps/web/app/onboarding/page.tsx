"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "../../lib/trpc";

// Clerk only knows the signed-in person, not our org/seat model. A brand
// new user has zero Organizations until they create one (here) or accept
// an invite (P12-02, not yet built).
export default function OnboardingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [eligible, setEligible] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.organization.mine
      .query()
      .then(async (orgs) => {
        if (orgs.length > 0) {
          router.push("/projects");
        } else {
          const eligibility = await trpc.beta.eligibility.query();
          setEligible(eligibility.eligible);
          setChecking(false);
        }
      })
      .catch((e) => {
        setError(String(e));
        setChecking(false);
      });
  }, [router]);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await trpc.organization.bootstrap.mutate({ organizationName });
      router.push("/projects");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (checking) return <p>Loading…</p>;

  if (!eligible) return (
    <div style={{ maxWidth: 520 }}>
      <h1>Vaettir private beta</h1>
      <p>Access is by invitation. Open your team invitation link while signed in with the invited email address.</p>
      <p>Starting a new team? Ask your beta contact for an owner invitation.</p>
      {error && <p role="alert">{error}</p>}
      <button onClick={() => window.location.reload()}>Check invitation again</button>
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
            onChange={(e) => setOrganizationName(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <button onClick={submit} disabled={loading || !organizationName}>
          {loading ? "Creating…" : "Create organization"}
        </button>
        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      </div>
    </div>
  );
}
