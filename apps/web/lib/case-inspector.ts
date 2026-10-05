export const INSPECTOR_SECTIONS = [
  "Procedure",
  "Intelligence",
  "Evidence",
  "History",
] as const;
export type InspectorSection = (typeof INSPECTOR_SECTIONS)[number];

export function inspectorLabel(value: string): string {
  const names: Record<string, string> = {
    E2E: "End-to-end",
    AI_REVERSE_ENGINEERED: "AI reverse-engineered",
    HIL: "Hardware-in-the-loop",
    SYSTEMS_INTEGRATION: "Systems integration",
    PENDING_REVIEW: "Pending review",
    API: "API",
    UI: "UI",
  };
  return (
    names[value] ??
    value
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^./, (character) => character.toUpperCase())
  );
}

export function inspectorSectionForKey(
  section: InspectorSection,
  key: string,
): InspectorSection | null {
  const index = INSPECTOR_SECTIONS.indexOf(section);
  if (key === "Home") return INSPECTOR_SECTIONS[0];
  if (key === "End") return "History";
  if (key === "ArrowRight")
    return INSPECTOR_SECTIONS[(index + 1) % INSPECTOR_SECTIONS.length] ?? null;
  if (key === "ArrowLeft")
    return (
      INSPECTOR_SECTIONS[
        (index + INSPECTOR_SECTIONS.length - 1) % INSPECTOR_SECTIONS.length
      ] ?? null
    );
  return null;
}

export function prerequisitePage<
  T extends {
    id: string;
    title: string;
    archived: boolean;
    displayId?: string | null;
  },
>(
  cases: T[],
  caseId: string,
  selected: string[],
  search: string,
  page: number,
  sort: "inventory" | "case-id" | "title" = "inventory",
): { items: T[]; page: number; pageCount: number; total: number } {
  const query = search.trim().toLocaleLowerCase();
  const matches = cases.filter(
    (item) =>
      !item.archived &&
      item.id !== caseId &&
      !selected.includes(item.id) &&
      (!query ||
        `${item.title} ${item.displayId ?? ""} ${item.id}`
          .toLocaleLowerCase()
          .includes(query)),
  );
  if (sort !== "inventory")
    matches.sort((left, right) => {
      const titleOrder = left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
        numeric: true,
      });
      const keyOrder = (left.displayId ?? left.id).localeCompare(
        right.displayId ?? right.id,
        undefined,
        { sensitivity: "base", numeric: true },
      );
      return (
        (sort === "case-id"
          ? keyOrder || titleOrder
          : titleOrder || keyOrder) || left.id.localeCompare(right.id)
      );
    });
  const pageCount = Math.max(1, Math.ceil(matches.length / 20));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  return {
    items: matches.slice(safePage * 20, safePage * 20 + 20),
    page: safePage,
    pageCount,
    total: matches.length,
  };
}
