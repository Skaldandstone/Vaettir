/** Tags are exact native strings, not trimmed search text or comma lists. */
export function projectTagHref(projectId: string, tag: string): string {
  return `/projects/${encodeURIComponent(projectId)}/tags?tag=${encodeURIComponent(tag)}`;
}

export function selectedProjectTag(params: Pick<URLSearchParams, "getAll">):
  | { selected: false }
  | { selected: true; tag: string } {
  const values = params.getAll("tag");
  if (values.length > 1) throw Error("Choose one exact tag. Multiple tag parameters are not an all-tags search.");
  return values.length === 0 ? { selected: false } : { selected: true, tag: values[0]! };
}

export function projectTagLabel(tag: string): string {
  return tag === "" ? "Empty retained tag" : /^\s+$/.test(tag) ? `Whitespace-only tag (${tag.length} characters)` : tag;
}

export function matchesExactTag(tags: readonly string[], filter: string | null): boolean {
  return filter === null || tags.includes(filter);
}

export type TagSection = "CASES" | "PLANS" | "RELEASES" | "REQUIREMENTS";
export type TagSelection = { projectId: string; originalOrganizationId: string; expectedClerkActorId: string; requestId: string; tag: string; section: TagSection; archive: string; review: string; cursor?: { scopeHash: string } };
/** A new completed read must echo its own request and current native reader.
 * A cached body for another session/page/scope is never attached to this view. */
export function projectTagPageMatches(value: unknown, input: TagSelection, nativeActorId: string): boolean {
  if (!value || typeof value !== "object" || !nativeActorId) return false;
  const row = value as Record<string, unknown>, scope = row.readScope as Record<string, unknown> | undefined;
  return row.projectId === input.projectId && row.organizationId === input.originalOrganizationId && row.clerkActorId === input.expectedClerkActorId && row.requestId === input.requestId && row.tag === input.tag && row.section === input.section && row.archive === input.archive && row.review === input.review && !!scope && scope.projectId === input.projectId && scope.organizationId === input.originalOrganizationId && scope.actorId === nativeActorId && scope.actorClerkUserId === input.expectedClerkActorId && typeof row.scopeHash === "string" && /^[a-f0-9]{64}$/.test(row.scopeHash) && (!input.cursor || input.cursor.scopeHash === row.scopeHash);
}

export function projectTagItemHref(projectId: string, section: TagSection, id: string): string {
  const project = encodeURIComponent(projectId), entity = encodeURIComponent(id);
  return section === "REQUIREMENTS" ? `/projects/${project}/requirements#requirement-${entity}` : `/projects/${project}/${section === "CASES" ? "test-cases" : section === "PLANS" ? "test-plans" : "releases"}/${entity}`;
}
