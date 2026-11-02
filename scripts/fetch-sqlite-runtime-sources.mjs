import {createHash} from 'node:crypto';
import {mkdir, open, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const manifest = JSON.parse(await readFile(new URL('./sqlite-runtime-sources.json', import.meta.url), 'utf8'));
export const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');

export function verifySourceBytes(bytes, source) {
  if (bytes.length !== source.size || digest(bytes) !== source.sha256 || digest(bytes, 'sha3-256') !== source.sha3_256) {
    throw Error('SQLite source size or digest mismatch');
  }
}

export async function downloadSource(source, fetchImpl = fetch) {
  const allowed = manifest.sources.find(row => row.file === source.file);
  if (!allowed || JSON.stringify(allowed) !== JSON.stringify(source) ||
      source.url !== `https://sqlite.org/2026/${source.file}` || source.size > 15000000) {
    throw Error('Source is outside the pinned SQLite manifest');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  let reader;
  try {
    const response = await fetchImpl(source.url, {redirect: 'error', signal: controller.signal, headers:{'accept-encoding':'identity'}});
    if (!response.ok || response.status !== 200 || response.redirected || response.url !== source.url || !response.body) {
      throw Error('Unexpected SQLite source response');
    }
    const length = response.headers.get('content-length');
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') throw Error('Unexpected SQLite transport encoding');
    if (length !== null && Number(length) !== source.size) throw Error('SQLite content length mismatch');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > source.size) throw Error('SQLite source exceeds pinned size');
      chunks.push(Buffer.from(part.value));
    }
    const bytes = Buffer.concat(chunks);
    verifySourceBytes(bytes, source);
    return bytes;
  } finally {
    controller.abort();
    if (reader) await reader.cancel().catch(() => {});
    clearTimeout(timer);
  }
}

export async function fetchSources(destination, fetchImpl = fetch) {
  // Fresh, exclusive destination: a failed admission is retained for diagnosis.
  // Never overwrite or automatically retry a partial attempt.
  await mkdir(destination, {recursive: false, mode: 0o700});
  for (const source of manifest.sources) {
    const bytes = await downloadSource(source, fetchImpl);
    const file = await open(join(destination, source.file), 'wx', 0o600);
    try { await file.writeFile(bytes); } finally { await file.close(); }
  }
  const receipt = await open(join(destination, 'source-manifest.json'), 'wx', 0o600);
  try { await receipt.writeFile(`${JSON.stringify(manifest, null, 2)}\n`); } finally { await receipt.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || resolve(process.argv[2]) !== process.argv[2]) throw Error('Supply one absolute fresh destination');
  await fetchSources(process.argv[2]);
}
