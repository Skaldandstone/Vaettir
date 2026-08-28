"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TestPlanDetailContent } from "@/components/TestPlanDetailContent";
import { trpc } from "@/lib/trpc";
import { isReadOnlySeat } from "@/lib/membership";

// Kept for deep links/bookmarks -- the primary way to view a plan from the
// list itself is the drawer (see the test-plans list page), not this page.
export default function TestPlanDetailPage() {
  const params = useParams<{ projectId: string; id: string }>();
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    Promise.all([trpc.project.byId.query({ id: params.projectId }), trpc.organization.mine.query()])
      .then(([proj, orgs]) => {
        const org = orgs.find((o) => o.id === proj.organizationId);
        setReadOnly(isReadOnlySeat(org?.seatType));
      })
      .catch(() => undefined);
  }, [params.projectId]);

  return (
    <div style={{ maxWidth: 640 }}>
      <a className="btn-secondary" style={{ fontSize: 13 }} href={`/projects/${params.projectId}/test-plans`}>
        &larr; Test plans
      </a>
      <TestPlanDetailContent id={params.id} readOnly={readOnly} />
    </div>
  );
}
