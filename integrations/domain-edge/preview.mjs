// Static-only local rendering preview. The deployed Worker is tested separately.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("./public/", import.meta.url));
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png" };
createServer(async (request, reply) => {
  const url = new URL(request.url, "http://127.0.0.1:8898");
  const target = path.resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!target.startsWith(root)) { reply.writeHead(403).end(); return; }
  try { reply.writeHead(200, { "Content-Type": types[path.extname(target)] ?? "text/plain", "Cache-Control": "no-store" }).end(await readFile(target)); }
  catch { reply.writeHead(404).end(); }
}).listen(8898, "127.0.0.1", () => console.log("Static marketing preview on http://127.0.0.1:8898"));
