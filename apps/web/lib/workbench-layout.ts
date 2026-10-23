/** Browser preferences contain presentation only, never project permissions. */
export const DEFAULT_SIDEBAR = { collapsed: false, width: 184 };
export function sidebarPreference(raw: unknown): typeof DEFAULT_SIDEBAR {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return { collapsed: value.collapsed === true, width: typeof value.width === "number" && Number.isFinite(value.width) ? Math.round(Math.max(152, Math.min(320, value.width))) : 184 };
}
export type PanelPreference = { order: string[]; collapsed: string[]; wide: string[] };
export function panelPreference(raw: unknown, ids: string[], wide: string[] = []): PanelPreference {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const known = (input: unknown) => Array.isArray(input) ? [...new Set(input.filter((id): id is string => typeof id === "string" && ids.includes(id)))] : [];
  const order = known(value.order);
  return { order: [...order, ...ids.filter(id => !order.includes(id))], collapsed: known(value.collapsed), wide: Array.isArray(value.wide) ? known(value.wide) : wide.filter(id => ids.includes(id)) };
}
