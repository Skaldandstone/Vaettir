import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import {
  inspectCsv,
  mapCsvRows,
  suggestCsvMapping,
  type MappedRowOverride,
  type TargetField,
} from "./csvFieldMapping.js";

const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const MAX_XML_BYTES = 10 * 1024 * 1024;
const MAX_WORKBOOK_XML_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;
const MAX_SHEETS = 50;
const MAX_ROWS_PER_SHEET = 10_000;
const MAX_WORKBOOK_ROWS = 20_000;
const MAX_COLUMNS = 256;
const MAX_WORKBOOK_CELLS = 200_000;
const MAX_CELL_CHARACTERS = 16_384;
const MAX_CSV_BYTES = 20 * 1024 * 1024;
const XML_ESCAPES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXmlEscapes(text: string): string {
  if (text.length > MAX_CELL_CHARACTERS) throw new Error("Excel cell text exceeds the supported limit");
  return text.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]{1,6}|#[0-9]{1,7});/g, (_match, entity: string) => {
    if (!entity.startsWith("#")) return XML_ESCAPES[entity]!;
    const code = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!(code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff)))
      throw new Error("Excel XML character reference is invalid");
    return String.fromCodePoint(code);
  });
}
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: false,
  // Preserve ordinary Excel XML escapes. zipText rejects custom declaration
  // syntax before parsing; only built-in/numeric XML escapes are supported.
  processEntities: true,
  entityDecoder: {
    decode: decodeXmlEscapes,
    reset() {},
    setXmlVersion(version) { if (version !== "1.0") throw new Error("Excel XML version is not supported"); },
    setExternalEntities(entities) { if (Object.keys(entities).length) throw new Error("Excel XML declarations are not supported"); },
    addInputEntities() { throw new Error("Excel XML declarations are not supported"); },
  },
});

type CellValue = string | number | boolean | null;
type XmlRecord = Record<string, unknown>;

export interface ParsedWorkbookSheet {
  name: string;
  headerRow: number | null;
  csvText: string | null;
  headers: string[];
  rowCount: number;
  suggestedMapping: Partial<Record<TargetField, string>>;
  warning?: string;
}

function arrayOf<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function recordOf(value: unknown): XmlRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlRecord)
    : {};
}

function textOf(value: unknown): string {
  const pending = [value];
  const parts: string[] = [];
  let visited = 0;
  let length = 0;
  while (pending.length) {
    if (++visited > 512) throw new Error("Excel cell structure exceeds the supported limit");
    const next = pending.pop();
    if (next === null || next === undefined) continue;
    if (typeof next === "string" || typeof next === "number" || typeof next === "boolean") {
      const part = String(next);
      length += part.length;
      if (length > MAX_CELL_CHARACTERS) throw new Error("Excel cell text exceeds the supported limit");
      parts.push(part);
    } else if (Array.isArray(next)) {
      if (pending.length + next.length > 512) throw new Error("Excel cell structure exceeds the supported limit");
      for (let index = next.length - 1; index >= 0; index--) pending.push(next[index]);
    } else if (typeof next === "object") {
      const record = next as Record<string, unknown>;
      pending.push(record["#text"] ?? record.t ?? record.r);
    }
  }
  return parts.join("");
}

function columnIndex(reference: string): number {
  const match = reference.match(/^([A-Z]{1,3})[1-9]\d{0,6}$/i);
  if (!match) throw new Error("Excel cell reference is invalid");
  const letters = match[1]!.toUpperCase();
  const index = (
    [...letters].reduce(
      (index, letter) => index * 26 + letter.charCodeAt(0) - 64,
      0,
    ) - 1
  );
  if (index >= MAX_COLUMNS) throw new Error("Excel worksheet exceeds the 256 column limit");
  return index;
}

function csvField(value: CellValue): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function zipText(zip: AdmZip, path: string): string {
  const entry = zip.getEntry(path);
  if (!entry) throw new Error(`Invalid XLSX workbook: missing ${path}`);
  const data = entry.getData();
  if (data.byteLength > MAX_XML_BYTES) throw new Error("Excel archive entry exceeds the 10 MB expanded limit");
  const text = data.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("Excel XML declarations are not supported");
  return text;
}

function validateWorkbookArchive(zip: AdmZip): void {
  const entries = zip.getEntries();
  if (entries.length > MAX_ARCHIVE_ENTRIES)
    throw new Error("Excel archive has too many entries");
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const size = entry.header.size;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_XML_BYTES)
      throw new Error("Excel archive entry exceeds the 10 MB expanded limit");
    // Zero-size deflated entries cannot contain meaningful workbook XML.
    // Reject before decoding so a false zero never disables the inflate cap.
    if (size === 0 && entry.header.compressedSize > 0 && entry.header.method === 8)
      throw new Error("Excel archive has an invalid zero-size compressed entry");
    total += size;
    if (total > MAX_WORKBOOK_XML_BYTES)
      throw new Error("Excel archive exceeds the 50 MB expanded limit");
  }
}

function normalizeTarget(target: string): string {
  const clean = target.replaceAll("\\", "/").replace(/^\//, "");
  return clean.startsWith("xl/") ? clean : `xl/${clean.replace(/^\.\.\//, "")}`;
}

function findHeaderRow(rows: CellValue[][]): number | null {
  let best: { index: number; score: number } | null = null;
  for (const [index, row] of rows.slice(0, 25).entries()) {
    const headers = row.map((value) => String(value ?? "").trim());
    const mapping = suggestCsvMapping(headers);
    const score =
      Object.keys(mapping).length +
      (mapping.title ? 4 : 0) +
      (mapping.externalId ? 1 : 0);
    if (mapping.title && (!best || score > best.score)) best = { index, score };
  }
  return best?.index ?? null;
}

export function parseXlsxWorkbook(buffer: Buffer): ParsedWorkbookSheet[] {
  if (buffer.byteLength > MAX_XLSX_BYTES)
    throw new Error("Excel file is too large (maximum 10 MB)");
  if (buffer.subarray(0, 2).toString("hex") !== "504b")
    throw new Error("File is not a valid .xlsx workbook");

  const zip = new AdmZip(buffer);
  validateWorkbookArchive(zip);
  const workbook = recordOf(parser.parse(zipText(zip, "xl/workbook.xml")));
  const relationships = recordOf(
    parser.parse(zipText(zip, "xl/_rels/workbook.xml.rels")),
  );
  const relById = new Map<string, string>();
  const relationshipRoot = recordOf(relationships.Relationships);
  for (const relationshipValue of arrayOf(relationshipRoot.Relationship)) {
    const relationship = recordOf(relationshipValue);
    const id = textOf(relationship["@_Id"]);
    const target = textOf(relationship["@_Target"]);
    if (id && target) relById.set(id, normalizeTarget(target));
  }

  const sharedEntry = zip.getEntry("xl/sharedStrings.xml");
  const sharedRoot = sharedEntry
    ? recordOf(parser.parse(zipText(zip, "xl/sharedStrings.xml")))
    : {};
  const sharedValues = arrayOf(recordOf(sharedRoot.sst).si);
  if (sharedValues.length > MAX_WORKBOOK_CELLS) throw new Error("Excel shared strings exceed the supported limit");
  const sharedStrings = sharedEntry
    ? sharedValues.map(textOf)
    : [];

  const workbookRoot = recordOf(workbook.workbook);
  const sheetsRoot = recordOf(workbookRoot.sheets);
  const sourceSheets = arrayOf(sheetsRoot.sheet);
  if (sourceSheets.length > MAX_SHEETS) throw new Error("Excel workbook exceeds the 50 worksheet limit");
  let totalRows = 0;
  let totalCells = 0;
  let totalCsvBytes = 0;
  return sourceSheets
    .map((sheetValue) => {
      const sheet = recordOf(sheetValue);
      const name = textOf(sheet["@_name"]) || "Sheet";
      const relationshipId = textOf(sheet["@_r:id"]);
      const target = relationshipId ? relById.get(relationshipId) : undefined;
      if (!target)
        return {
          name,
          headerRow: null,
          csvText: null,
          headers: [],
          rowCount: 0,
          suggestedMapping: {},
          warning: "Worksheet data is missing",
        };

      const document = recordOf(parser.parse(zipText(zip, target)));
      const worksheet = recordOf(document.worksheet);
      const sheetData = recordOf(worksheet.sheetData);
      const sourceRows = arrayOf(sheetData.row);
      totalRows += sourceRows.length;
      if (sourceRows.length > MAX_ROWS_PER_SHEET || totalRows > MAX_WORKBOOK_ROWS)
        throw new Error("Excel workbook exceeds the supported row limit");
      const rows = sourceRows.map((rowValue) => {
        const row = recordOf(rowValue);
        const cells: CellValue[] = [];
        const sourceCells = arrayOf(row.c);
        totalCells += sourceCells.length;
        if (sourceCells.length > MAX_COLUMNS || totalCells > MAX_WORKBOOK_CELLS)
          throw new Error("Excel workbook exceeds the supported cell limit");
        for (const cellValue of sourceCells) {
          const cell = recordOf(cellValue);
          const index = columnIndex(String(cell["@_r"] ?? "A1"));
          const type = cell["@_t"];
          const inlineString = recordOf(cell.is);
          const raw = cell.v ?? inlineString.t ?? inlineString.r;
          let value: CellValue = textOf(raw);
          if (type === "s") value = sharedStrings[Number(value)] ?? "";
          else if (type === "b") value = value === "1";
          else if (!type && value !== "" && Number.isFinite(Number(value)))
            value = Number(value);
          cells[index] = value;
        }
        return cells;
      });

      const headerIndex = findHeaderRow(rows);
      if (headerIndex === null) {
        return {
          name,
          headerRow: null,
          csvText: null,
          headers: [],
          rowCount: 0,
          suggestedMapping: {},
          warning: "No recognizable test-case header row found",
        };
      }
      const width = Math.max(
        ...rows.slice(headerIndex).map((row) => row.length),
        0,
      );
      const normalized = rows
        .slice(headerIndex)
        .map((row) =>
          Array.from({ length: width }, (_, index) => row[index] ?? null),
        );
      const csvText = normalized
        .map((row) => row.map(csvField).join(","))
        .join("\r\n");
      totalCsvBytes += Buffer.byteLength(csvText, "utf8");
      if (totalCsvBytes > MAX_CSV_BYTES) throw new Error("Excel workbook exceeds the 20 MB converted limit");
      const inspected = inspectCsv(csvText);
      return {
        name,
        headerRow: headerIndex + 1,
        csvText,
        headers: inspected.headers,
        rowCount: inspected.rowCount,
        suggestedMapping: inspected.suggestedMapping,
      };
    });
}

export function previewXlsxSheet(
  sheet: ParsedWorkbookSheet,
  mapping?: Partial<Record<TargetField, string>>,
  overrides: MappedRowOverride[] = [],
) {
  if (!sheet.csvText) return { rows: [], skipped: [], incompleteRows: [] };
  const preview = mapCsvRows(
    sheet.csvText,
    mapping ?? sheet.suggestedMapping,
    undefined,
    overrides,
  );
  return { ...preview, rows: preview.rows.slice(0, 10) };
}
