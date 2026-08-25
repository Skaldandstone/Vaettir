"use client";

import { useParams } from "next/navigation";
import { TestCaseDetailContent } from "@/components/TestCaseDetailContent";

// Kept for deep links, bookmarks, and browser back/forward -- the primary
// way to view a case from the list itself is the drawer (see
// components/TestCaseDrawer.tsx), not this page.
export default function TestCaseDetailPage() {
  const params = useParams<{ projectId: string; id: string }>();
  return <TestCaseDetailContent id={params.id} projectId={params.projectId} />;
}
