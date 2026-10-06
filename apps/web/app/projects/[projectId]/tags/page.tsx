"use client";
import { useParams, useSearchParams } from "next/navigation";
import { ProjectTagHub } from "@/components/ProjectTagHub";
import { selectedProjectTag } from "@/lib/project-tag-navigation";
export default function ProjectTagsPage() {
  const { projectId } = useParams<{ projectId: string }>(), params = useSearchParams();
  let selection: ReturnType<typeof selectedProjectTag> | undefined, problem: string | undefined;
  try {
    selection = selectedProjectTag(params);
  } catch (cause) {
    problem = cause instanceof Error ? cause.message : "The tag selection is unavailable.";
  }
  if (problem || !selection) return <main><h1>Tag associations</h1><p role="alert">{problem ?? "The tag selection is unavailable."}</p><a href={`/projects/${encodeURIComponent(projectId)}/tags`}>Start one exact tag selection</a></main>;
  return <ProjectTagHub projectId={projectId} tag={selection.selected ? selection.tag : null} />;
}
