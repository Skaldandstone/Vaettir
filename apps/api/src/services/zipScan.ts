import AdmZip from "adm-zip";
import { isLikelyTestFile } from "@vaettir/core";
import { hashFileContent, type ScannedTestFile } from "./repoScan.js";

// P2-11: the zip-upload counterpart to repoScan.ts's git-based scanning --
// same walk-and-hash shape (MAX_FILES/MAX_FILE_BYTES caps, knownHashes skip
// so an unchanged already-tracked file doesn't eat into the cap), just
// reading entries out of an in-memory zip instead of a cloned working tree.
// No git history exists for an upload, so there's no diff-aware path here
// (P2-05's equivalent) -- every upload is effectively a "first scan" of
// whatever's in the archive.
const MAX_FILES = 25;
// P2-09: see repoScan.ts's identical comment -- reverseEngineerTestFile now
// chunks large files by evaluator-extracted test block, so this only guards
// against a pathological single entry, not an ordinary large real file.
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_BYTES = 10 * 1024 * 1024;

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "vendor", "venv", ".venv"]);

export function scanZipForTestFiles(zipBuffer: Buffer, knownHashes: Map<string, string> = new Map()): ScannedTestFile[] {
  if (zipBuffer.byteLength > MAX_ZIP_BYTES) {
    throw new Error(`Zip file is too large (max ${MAX_ZIP_BYTES / (1024 * 1024)}MB)`);
  }

  const zip = new AdmZip(zipBuffer);
  const files: ScannedTestFile[] = [];

  for (const entry of zip.getEntries()) {
    if (files.length >= MAX_FILES) break;
    if (entry.isDirectory) continue;

    const relativePath = entry.entryName.split("\\").join("/");
    if (relativePath.split("/").some((segment) => IGNORED_DIRS.has(segment))) continue;
    const fileName = relativePath.split("/").pop() ?? relativePath;
    if (!isLikelyTestFile(fileName)) continue;
    if (entry.header.size > MAX_FILE_BYTES) continue;

    const content = entry.getData().toString("utf-8");
    const contentHash = hashFileContent(content);
    if (knownHashes.get(relativePath) === contentHash) continue;
    files.push({ relativePath, content, contentHash });
  }

  return files;
}
