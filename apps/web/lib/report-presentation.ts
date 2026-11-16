/** Portable styling only. Never accepts report text, identities, URLs or code. */
export const PRESENTATION_PALETTES = {
  evergreen: {
    label: "Evergreen",
    ink: "16302D",
    muted: "526764",
    accent: "167D70",
    paper: "F7FAF8",
  },
  navy: {
    label: "Navy",
    ink: "182B49",
    muted: "52627A",
    accent: "2459A6",
    paper: "F6F8FC",
  },
  plum: {
    label: "Plum",
    ink: "38263F",
    muted: "6B5671",
    accent: "82458D",
    paper: "FAF7FB",
  },
} as const;
export const PRESENTATION_FONTS = {
  aptos: { label: "Aptos", heading: "Aptos Display", body: "Aptos" },
  arial: { label: "Arial", heading: "Arial", body: "Arial" },
  georgia: { label: "Georgia", heading: "Georgia", body: "Georgia" },
} as const;
export type ReportPresentation = Readonly<{
  version: 1;
  palette: keyof typeof PRESENTATION_PALETTES;
  font: keyof typeof PRESENTATION_FONTS;
}>;
export const DEFAULT_REPORT_PRESENTATION: ReportPresentation = Object.freeze({
  version: 1,
  palette: "evergreen",
  font: "aptos",
});
export const MAX_PRESENTATION_PRESET_BYTES = 512;
const invalid = () =>
  new Error(
    "Choose a Vaettir presentation preset (version 1, palette and font only; maximum 512 bytes).",
  );

export function normalizeReportPresentation(
  value: unknown,
): ReportPresentation {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw invalid();
  const fields = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== 3 ||
    !["version", "palette", "font"].every(
      (key) =>
        Object.hasOwn(fields, key) && Object.hasOwn(fields[key]!, "value"),
    )
  )
    throw invalid();
  const { version, palette, font } = value as Record<string, unknown>;
  if (
    version !== 1 ||
    typeof palette !== "string" ||
    typeof font !== "string" ||
    !Object.hasOwn(PRESENTATION_PALETTES, palette) ||
    !Object.hasOwn(PRESENTATION_FONTS, font)
  )
    throw invalid();
  return Object.freeze({ version: 1, palette, font }) as ReportPresentation;
}

export function parseReportPresentation(text: string): ReportPresentation {
  if (
    typeof text !== "string" ||
    text.length > MAX_PRESENTATION_PRESET_BYTES ||
    new TextEncoder().encode(text).length > MAX_PRESENTATION_PRESET_BYTES
  )
    throw invalid();
  try {
    const value = normalizeReportPresentation(JSON.parse(text));
    // Valid values contain no JSON syntax. Three keys also rules out duplicate keys.
    if ((text.match(/"(?:[^"\\]|\\.)*"\s*:/g) ?? []).length !== 3)
      throw invalid();
    return value;
  } catch {
    throw invalid();
  }
}

export function serializeReportPresentation(value: ReportPresentation): string {
  return JSON.stringify(normalizeReportPresentation(value));
}

export function reportPresentationStyle(
  value: ReportPresentation = DEFAULT_REPORT_PRESENTATION,
) {
  const options = normalizeReportPresentation(value);
  return {
    ...PRESENTATION_PALETTES[options.palette],
    ...PRESENTATION_FONTS[options.font],
  };
}
