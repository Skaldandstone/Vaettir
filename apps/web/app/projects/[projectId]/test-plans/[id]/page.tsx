"use client";

import { useParams } from "next/navigation";
import { TestPlanDetailContent } from "@/components/TestPlanDetailContent";
import { useReadOnlySeat } from "@/lib/trpcReact";

// Kept for deep links/bookmarks -- the primary way to view a plan from the
// list itself is the drawer (see the test-plans list page), not this page.
// P1-15
export default function TestPlanDetailPage() {
  const params = useParams<{ projectId: string; id: string }>();
  const readOnly = useReadOnlySeat(params.projectId);

  return (
    <div style={{ maxWidth: 640 }}>
      <a className="btn-secondary" style={{ fontSize: 13 }} href={`/projects/${params.projectId}/test-plans`}>
        &larr; Test plans
      </a>
      <TestPlanDetailContent id={params.id} readOnly={readOnly} />
    </div>
  );
}
