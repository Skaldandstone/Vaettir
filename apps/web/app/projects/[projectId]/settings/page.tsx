import { redirect } from "next/navigation";

/** Scoped index only; project reads and integration writes retain native access. */
export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/projects/${encodeURIComponent(projectId)}/settings/integrations`);
}
