import { createHash } from "node:crypto";

export function normalizeRequirement(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

// Literal candidate extraction, not AI or semantic completeness. Code fences are
// excluded, and every candidate retains its exact source line for human review.
export function documentRequirements(content: string) {
  const found = new Map<
    string,
    { key: string; title: string; quote: string; line: number }
  >();
  let fence: string | null = null;
  for (const [index, raw] of content.split(/\r?\n/).entries()) {
    const marker = raw.trim().match(/^(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1]![0]!;
      else if (marker[1]![0] === fence) fence = null;
      continue;
    }
    if (fence || raw.length > 500 || !/\b(must|shall|required to)\b/i.test(raw))
      continue;
    const title = raw
      .replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s*)/, "")
      .trim();
    if (!title || title.startsWith("#") || title.startsWith(">")) continue;
    const key = createHash("sha256")
      .update(normalizeRequirement(title))
      .digest("hex");
    if (!found.has(key))
      found.set(key, { key, title, quote: raw, line: index + 1 });
    if (found.size >= 100) break;
  }
  return [...found.values()];
}
