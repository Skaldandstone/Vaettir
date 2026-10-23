"use client";
import { useParams } from "next/navigation";
import { QualityRiskRegister } from "@/components/QualityRiskRegister";
export default function QualityRisksPage() {
  const { projectId } = useParams<{ projectId: string }>();
  return <QualityRiskRegister projectId={projectId} />;
}
