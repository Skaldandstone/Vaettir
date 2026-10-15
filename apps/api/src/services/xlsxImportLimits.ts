// Upload capacity is separate from expanded XML/parser memory protection.
// Pictures and other unused package parts are never inflated by the importer.
export const XLSX_MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
export const XLSX_MAX_BASE64_CHARACTERS =
  4 * Math.ceil(XLSX_MAX_UPLOAD_BYTES / 3);
export const XLSX_HTTP_BODY_BYTES = XLSX_MAX_BASE64_CHARACTERS + 1024 * 1024;
