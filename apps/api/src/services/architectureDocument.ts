import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export type ArchitectureElement = { id: string; label: string; kind: "COMPONENT" | "INTERACTION" | "TEXT"; quote: string; line: number; from?: string; to?: string };
export type ArchitectureDocument = { fileName: string; hash: string; format: "PLANTUML" | "SVG"; elements: ArchitectureElement[]; warnings: string[] };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Data extraction only. Never invokes PlantUML, a browser, includes, URLs or XML entities. */
export function readArchitectureDocument(fileName: string, content: string): ArchitectureDocument {
  if (!/\.(puml|plantuml|pu|svg)$/i.test(fileName)) throw new Error("Choose a PlantUML (.puml, .plantuml, .pu) or SVG document.");
  const hasControl = Array.from(content).some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)));
  if (!content.trim() || Buffer.byteLength(content, "utf8") > 1_000_000 || hasControl) throw new Error("Choose a non-empty UTF-8 diagram within the 1 MB analysis capacity.");
  const elements: ArchitectureElement[] = [], warnings: string[] = [];
  if (!/\.svg$/i.test(fileName)) {
    if (!/@start(?:uml|mindmap|wbs)\b/i.test(content) || !/@end(?:uml|mindmap|wbs)\b/i.test(content)) throw new Error("PlantUML source needs matching start and end markers.");
    const aliases = new Map<string, string>();
    const name = (s: string) => s.trim().replace(/^(?:\[|")|(?:\]|")$/g, "");
    const addComponent = (label: string, alias: string, quote: string, line: number) => {
      if (aliases.has(alias)) return;
      const id = `node:${line}:${elements.length}`; aliases.set(alias, id);
      elements.push({ id, label: name(label).replace(/\\n/g, " "), kind: "COMPONENT", quote, line });
    };
    let blockComment = false;
    const lines = content.split(/\r?\n/).map(raw => {
      if (raw.trim().startsWith("/'")) { blockComment = !raw.includes("'/", raw.indexOf("/'") + 2); return ""; }
      if (blockComment) { if (raw.includes("'/")) blockComment = false; return ""; }
      return raw.trim().startsWith("'") ? "" : raw;
    });
    for (const [i, raw] of lines.entries()) {
      const text = raw.trim();
      if (!text || text.startsWith("'") || /^@(?:start|end)/i.test(text)) continue;
      if (text.startsWith("!")) { warnings.push(`Line ${i + 1}: preprocessor directive retained as data only; includes and macros are not executed.`); continue; }
      const c4 = text.match(/^(?:Person|System(?:_Ext)?|Container(?:Db|Queue|_Ext)?|Component(?:Db|Queue|_Ext)?)\s*\(\s*([\w.$-]+)\s*,\s*"([^"]+)"/i);
      const declaration = text.match(/^(?:actor|participant|component|database|queue|class|interface|state|entity|node|rectangle|boundary|control|usecase|cloud|storage|package)\s+("[^"]+"|\[[^\]]+\]|[\w.$-]+)(?:\s+as\s+([\w.$-]+))?/i);
      const bracket = text.match(/^\[([^\]]+)\](?:\s+as\s+([\w.$-]+))?\s*$/);
      if (c4) addComponent(c4[2]!, c4[1]!, raw, i + 1);
      else if (declaration) addComponent(declaration[1]!, declaration[2] ?? name(declaration[1]!), raw, i + 1);
      else if (bracket) addComponent(bracket[1]!, bracket[2] ?? bracket[1]!, raw, i + 1);
    }
    for (const [i, raw] of lines.entries()) {
      const c4 = raw.trim().match(/^Rel(?:_[A-Za-z]+)?\s*\(\s*([\w.$-]+)\s*,\s*([\w.$-]+)\s*,\s*"([^"]+)"/);
      const edge = raw.trim().match(/^(\[[^\]]+\]|"[^"]+"|[\w.$-]+)\s+([<o*|]*[-.=]+(?:left|right|up|down)?[-.=]*[>o*|]*)\s+(\[[^\]]+\]|"[^"]+"|[\w.$-]+)(?:\s*:\s*(.*))?\s*$/);
      if (c4 || edge) {
        let from = name(c4?.[1] ?? edge![1]!), to = name(c4?.[2] ?? edge![3]!);
        if (edge?.[2]?.startsWith("<") && !edge[2].endsWith(">")) [from, to] = [to, from];
        addComponent(from, from, raw, i + 1); addComponent(to, to, raw, i + 1);
        elements.push({ id: `edge:${i + 1}`, label: c4?.[3] ?? edge?.[4] ?? `${from} → ${to}`, kind: "INTERACTION", quote: raw, line: i + 1, from: aliases.get(from), to: aliases.get(to) });
      } else if (/^\s*:.+;\s*$/.test(raw)) elements.push({ id: `activity:${i + 1}`, label: raw.trim().slice(1, -1), kind: "COMPONENT", quote: raw, line: i + 1 });
    }
    warnings.push("Static extraction supports declarations, ordinary links, sequence messages, C4 declarations/relations and activity labels. Layout, macro expansion and implicit control-flow semantics are not inferred. Review the extracted scope.");
    return finish("PLANTUML");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error("SVG DTDs and entity declarations are not accepted. Export a standalone SVG without them.");
  if (/<\s*(?:[\w-]+:)?(?:script|foreignObject|iframe)\b|\bon[a-z]+\s*=/i.test(content)) throw new Error("SVG active content is not accepted. Export a static SVG.");
  let depth = 0, tags = 0;
  for (const m of content.matchAll(/<\/?[A-Za-z][^>]*>/g)) {
    if (++tags > 20_000) throw new Error("SVG has too many elements for this analysis.");
    if (m[0].startsWith("</")) depth--; else if (!m[0].endsWith("/>")) depth++;
    if (depth > 128) throw new Error("SVG nesting exceeds the supported depth.");
  }
  if (XMLValidator.validate(content) !== true) throw new Error("SVG XML is malformed.");
  const parsed = new XMLParser({ ignoreAttributes: false, preserveOrder: true, trimValues: false, parseTagValue: false, processEntities: true }).parse(content) as Array<Record<string, unknown>>;
  const roots = parsed.filter(n => Object.keys(n).some(k => !k.startsWith("?") && k !== ":@"));
  if (roots.length !== 1 || !Object.keys(roots[0]!).some(k => /^(?:[\w-]+:)?svg$/.test(k))) throw new Error("The document root must be SVG.");
  const pendingEdges: Array<{ from: string; to: string; label: string; quote: string }> = [];
  const ids = new Map<string, string>();
  const textOf = (value: unknown): string => Array.isArray(value) ? value.map(n => Object.entries(n as Record<string, unknown>).filter(([k]) => k !== ":@").map(([k, v]) => k === "#text" ? String(v) : textOf(v)).join("")).join("") : "";
  const walk = (nodes: Array<Record<string, unknown>>, inheritedEntity?: string) => {
    for (const item of nodes) {
      const attrs = (item[":@"] ?? {}) as Record<string, string>;
      const entity = attrs["@_data-entity"] ?? inheritedEntity;
      for (const [tag, children] of Object.entries(item)) {
        if (tag === ":@" || !Array.isArray(children)) continue;
        const local = tag.split(":").at(-1)!;
        if (["metadata", "style", "defs", "symbol"].includes(local)) continue;
        if (["text", "title", "desc"].includes(local)) {
          const quote = textOf(children).trim();
          if (quote) { const id = `svg:${elements.length + 1}`; elements.push({ id, label: quote, kind: entity ? "COMPONENT" : "TEXT", quote, line: 0 }); if (entity && !ids.has(entity)) ids.set(entity, id); }
        } else walk(children as Array<Record<string, unknown>>, entity);
      }
      if (attrs["@_data-entity-1"] && attrs["@_data-entity-2"]) pendingEdges.push({ from: attrs["@_data-entity-1"], to: attrs["@_data-entity-2"], label: `${attrs["@_data-entity-1"]} → ${attrs["@_data-entity-2"]}`, quote: `data-entity-1="${attrs["@_data-entity-1"]}" data-entity-2="${attrs["@_data-entity-2"]}"` });
    }
  };
  walk(parsed);
  for (const edge of pendingEdges) if (ids.has(edge.from) && ids.has(edge.to)) elements.push({ id: `svg-edge:${elements.length + 1}`, kind: "INTERACTION", label: edge.label, quote: edge.quote, line: 0, from: ids.get(edge.from), to: ids.get(edge.to) });
  warnings.push("SVG text and explicit PlantUML connection metadata only. Geometry-only arrows and text converted to paths are not interpreted. No URLs, images, scripts or embedded resources are loaded.");
  return finish("SVG");

  function finish(format: ArchitectureDocument["format"]): ArchitectureDocument {
    if (!elements.length) throw new Error("No readable architecture labels were found. Supply PlantUML source or an SVG with text labels, not only outlined paths.");
    if (elements.length > 1500 || JSON.stringify(elements).length > 200_000) throw new Error("The extracted diagram exceeds this analysis capacity. Select a focused architecture view.");
    return { fileName, hash: hash(content), format, elements, warnings: [...new Set(warnings)] };
  }
}
