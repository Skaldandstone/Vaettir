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
  const [organizationName, setOrganizationName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.organization.mine
      .query()
      .then((orgs) => {
        if (orgs.length > 0) {
          router.push("/test-cases");
        } else {
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
      router.push("/test-cases");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (checking) return <p>Loading…</p>;

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
        <button onClick={submit} disabled={loading || !organizationName}>
          {loading ? "Creating…" : "Create organization"}
        </button>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </div>
    </div>
  );
}
