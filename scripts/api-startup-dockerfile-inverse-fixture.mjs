// TEST FIXTURE ONLY. Never use this inverse for runtime or source admission.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const API_DIRECT_PRISMA_DOCKERFILE_SHA256 =
  "d15d3ecbecc3ea49f1af7f30805ef56815bac98a73b47a75a71357ea4495d3c0";
export const PRE_API_DIRECT_PRISMA_DOCKERFILE_SHA256 =
  "450e99bfc2599f642f4bb6fd247db60f5f67c4beed6f99fbea9d8f614ef837e9";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const current = String.raw`# Keep assignment separate from export so resolver failures stop startup.
# Invoke the packaged CLI directly: pnpm exec can run install before the command.
CMD ["sh", "-c", "DATABASE_URL=$(node apps/api/dist/printDatabaseUrl.js) && test -n \"$DATABASE_URL\" && export DATABASE_URL && node packages/db/node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma && exec node apps/api/dist/server.js"]
`;
const previous = `CMD ["sh", "-c", "export DATABASE_URL=$(node apps/api/dist/printDatabaseUrl.js) && pnpm --filter @vaettir/db exec prisma migrate deploy && node apps/api/dist/server.js"]
`;

export function restorePreApiDirectPrismaDockerfileFixture(raw) {
  assert.equal(arguments.length, 1);
  assert.ok(Buffer.isBuffer(raw));
  const text = raw.toString("utf8");
  assert.deepEqual(Buffer.from(text), raw);
  assert.equal(text.includes("\r"), false, "Only exact known LF input");
  assert.equal(sha(raw), API_DIRECT_PRISMA_DOCKERFILE_SHA256,
    "Unknown complete API startup Dockerfile edit");
  assert.equal(text.split(current).length, 2);
  assert.ok(text.endsWith(current));
  const prior = Buffer.from(text.slice(0, -current.length) + previous);
  assert.equal(sha(prior), PRE_API_DIRECT_PRISMA_DOCKERFILE_SHA256,
    "Pre-startup Dockerfile baseline differs");
  return prior;
}
