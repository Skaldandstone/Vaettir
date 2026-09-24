import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import {
  inspectCsv,
  mapCsvRows,
  suggestCsvMapping,
  type TargetField,
} from "./csvFieldMapping.js";

const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const MAX_SHEETS = 50;
const MAX_ROWS_PER_SHEET = 10_000;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: false,
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
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return textOf(record["#text"] ?? record.t ?? record.r);
  }
  return "";
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  return (
    [...letters].reduce(
      (index, letter) => index * 26 + letter.charCodeAt(0) - 64,
      0,
    ) - 1
  );
}

function csvField(value: CellValue): string {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function zipText(zip: AdmZip, path: string): string {
  const entry = zip.getEntry(path);
  if (!entry) throw new Error(`Invalid XLSX workbook: missing ${path}`);
  return entry.getData().toString("utf8");
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
    ? recordOf(parser.parse(sharedEntry.getData().toString("utf8")))
    : {};
  const sharedStrings = sharedEntry
    ? arrayOf(recordOf(sharedRoot.sst).si).map(textOf)
    : [];

  const workbookRoot = recordOf(workbook.workbook);
  const sheetsRoot = recordOf(workbookRoot.sheets);
  return arrayOf(sheetsRoot.sheet)
    .slice(0, MAX_SHEETS)
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
      const sourceRows = arrayOf(sheetData.row).slice(0, MAX_ROWS_PER_SHEET);
      const rows = sourceRows.map((rowValue) => {
        const row = recordOf(rowValue);
        const cells: CellValue[] = [];
        for (const cellValue of arrayOf(row.c)) {
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
) {
  if (!sheet.csvText) return { rows: [], skipped: [] };
  return mapCsvRows(sheet.csvText, mapping ?? sheet.suggestedMapping, 10);
}
