"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { CSSProperties } from "react";
import { trpc, type RouterOutputs } from "../../../lib/trpc";

const cellStyle: CSSProperties = { border: "1px solid #e5e5e5", padding: "6px 10px", textAlign: "left" };

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

      {(tc.given.length > 0 || tc.when.length > 0 || tc.then.length > 0) && (
        <>
          <h3>Given</h3>
          <ul>{tc.given.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <h3>When</h3>
          <ul>{tc.when.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <h3>Then</h3>
          <ul>{tc.then.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}

      {tc.steps.length > 0 && (
        <>
          <h3>Steps</h3>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={cellStyle}>#</th>
                <th style={cellStyle}>{tc.stepFieldLabels.action}</th>
                <th style={cellStyle}>{tc.stepFieldLabels.expectedActionOrData}</th>
                <th style={cellStyle}>{tc.stepFieldLabels.expectedResult}</th>
                <th style={cellStyle}>{tc.stepFieldLabels.expectedResponse}</th>
              </tr>
            </thead>
            <tbody>
              {tc.steps.map((s) => (
                <tr key={s.order}>
                  <td style={cellStyle}>{s.order + 1}</td>
                  <td style={cellStyle}>{s.action}</td>
                  <td style={cellStyle}>{s.expectedActionOrData ?? "—"}</td>
                  <td style={cellStyle}>{s.expectedResult ?? "—"}</td>
                  <td style={cellStyle}>{s.expectedResponse ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tc.tags.length > 0 && (
        <p>
          <strong>Tags:</strong> {tc.tags.join(", ")}
        </p>
      )}
    </div>
  );
}
