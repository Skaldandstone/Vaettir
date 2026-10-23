export const MAX_DOCUMENT_BYTES = 200_000;
export const MAX_DOCUMENT_CHARACTERS = 50_000;

type DocumentFile = Pick<File, "name" | "size" | "arrayBuffer">;

/** Local decoding only: no upload, execution, URL resolution or AI processing. */
export async function readDocumentFile(file: DocumentFile): Promise<string> {
  if (!/\.(md|markdown|txt)$/i.test(file.name) && !/^readme$/i.test(file.name))
    throw new Error("Choose a Markdown (.md, .markdown), text (.txt), or README file. Archives and binary documents are not supported.");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_DOCUMENT_BYTES)
    throw new Error("Choose a non-empty file no larger than 200 KB.");
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size || bytes.byteLength > MAX_DOCUMENT_BYTES)
    throw new Error("File size changed while reading. Select it again.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("This file is not valid UTF-8 text. Export it as UTF-8 and try again.");
  }
  if (!text.trim()) throw new Error("The file has no text to review.");
  if (text.length > MAX_DOCUMENT_CHARACTERS)
    throw new Error("This document exceeds 50,000 characters. Select a smaller section to review.");
  if (Array.from(text).some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
  }))
    throw new Error("The file contains binary or unsupported control characters. Choose plain text.");
  return text;
}
