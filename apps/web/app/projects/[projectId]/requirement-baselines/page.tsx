"use client";
import { useParams } from "next/navigation";
import { RequirementBaselines } from "@/components/RequirementBaselines";
export default function RequirementBaselinesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <RequirementBaselines projectId={projectId} />;
}
