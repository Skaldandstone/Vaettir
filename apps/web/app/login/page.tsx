"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setStoredToken } from "../../lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const body =
        mode === "login" ? { email, password } : { email, password, name: name || undefined, organizationName };

      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Something went wrong");
      }
      setStoredToken(data.token);
      router.push("/test-cases");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 360 }}>
      <h1>{mode === "login" ? "Log in" : "Create your organization"}</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setMode("login")} disabled={mode === "login"}>
          Log in
        </button>
        <button onClick={() => setMode("register")} disabled={mode === "register"}>
          Register
        </button>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {mode === "register" && (
          <>
            <label>
              Your name
              <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
            </label>
            <label>
              Organization name
              <input
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                style={{ width: "100%" }}
              />
            </label>
          </>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <button onClick={submit} disabled={loading || !email || !password}>
          {loading ? "Working…" : mode === "login" ? "Log in" : "Create account"}
        </button>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </div>
    </div>
  );
}
