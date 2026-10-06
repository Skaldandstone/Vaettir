export type ReviewCandidate = { id: string; displayId: string; title: string; confidence: number | null; sourceFilePath: string | null };
export function reviewQueuePage<T extends ReviewCandidate>(queue: readonly T[], search: string, sort: "confidence" | "case-id" | "title", page: number) {
  const query = search.trim().toLocaleLowerCase();
  const filtered = queue.filter(item => !query || `${item.displayId} ${item.title} ${item.sourceFilePath ?? ""}`.toLocaleLowerCase().includes(query));
  const compareText = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
  filtered.sort((left, right) => (sort === "confidence"
    ? (left.confidence ?? 2) - (right.confidence ?? 2)
    : compareText(sort === "case-id" ? left.displayId : left.title, sort === "case-id" ? right.displayId : right.title)) || compareText(left.displayId, right.displayId) || compareText(left.id, right.id));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(Math.max(Number.isSafeInteger(page) ? page : 0, 0), pageCount - 1);
  return { items: filtered.slice(currentPage * 25, currentPage * 25 + 25), total: filtered.length, page: currentPage, pageCount };
}
