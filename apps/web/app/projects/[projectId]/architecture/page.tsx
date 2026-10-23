"use client";
import { useParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { ArchitectureWorkbench } from "@/components/ArchitectureWorkbench";

export default function ArchitecturePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { userId, isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <p role="status">Loading architecture workspace…</p>;
  if (!isSignedIn || !userId)
    return <p>Sign in to review this project’s architecture.</p>;
  return (
    <ArchitectureWorkbench
      key={`${projectId}:${userId}`}
      projectId={projectId}
      actorClerkUserId={userId}
    />
  );
}
