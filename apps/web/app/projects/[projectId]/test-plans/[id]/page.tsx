"use client";

import { useParams } from "next/navigation";
import { TestPlanDetailContent } from "@/components/TestPlanDetailContent";

// Kept for deep links/bookmarks -- the primary way to view a plan from the
// list itself is the drawer (see the test-plans list page), not this page.
export default function TestPlanDetailPage() {
  const params = useParams<{ projectId: string; id: string }>();
  return (
    <div style={{ maxWidth: 640 }}>
      <a href={`/projects/${params.projectId}/test-plans`}>&larr; Test plans</a>
      <TestPlanDetailContent id={params.id} />
    </div>
  );
}
