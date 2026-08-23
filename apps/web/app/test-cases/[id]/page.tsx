"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "../../../lib/trpc";

export default function TestCaseDetailPage() {
  const params = useParams<{ id: string }>();
  const [tc, setTc] = useState<RouterOutputs["testCases"]["byId"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trpc.testCases.byId
      .query({ id: params.id })
      .then(setTc)
      .catch((e) => setError(String(e)));
  }, [params.id]);

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!tc) return <p>Loading…</p>;

  return (
    <div>
      <h1>{tc.title}</h1>
      <p>
        <strong>Type:</strong> {tc.testType} &nbsp; <strong>Priority:</strong> {tc.priority} &nbsp;
        <strong>Origin:</strong> {tc.origin}
        {tc.confidence != null && ` (confidence ${(tc.confidence * 100).toFixed(0)}%)`}
      </p>
      {tc.source && (
        <p>
          <strong>Source:</strong> {tc.source.filePath}
          {tc.source.functionName && ` :: ${tc.source.functionName}`} ({tc.source.framework})
        </p>
      )}
      {tc.background && <p><strong>Background:</strong> {tc.background}</p>}
      <h3>Given</h3>
      <ul>{tc.given.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <h3>When</h3>
      <ul>{tc.when.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <h3>Then</h3>
      <ul>{tc.then.map((s, i) => <li key={i}>{s}</li>)}</ul>
      {tc.tags.length > 0 && (
        <p>
          <strong>Tags:</strong> {tc.tags.join(", ")}
        </p>
      )}
    </div>
  );
}
