"use client";

import { useParams } from "next/navigation";
import DefectMapPanel from "@/components/DefectMapPanel";

export default function ProjectDefectMapPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <DefectMapPanel key={projectId} projectId={projectId} />;
}
