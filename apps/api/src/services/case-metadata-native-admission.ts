import { createHash } from "node:crypto";
import { z } from "zod";
import { assertOwnedTestDatabase } from "../testOnlyDatabaseSafety.js";

export const metadataFixturePath =
  "apps/api/src/services/case-metadata-reviewed.integration.test.ts";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sourceEntry = z
  .object({
    path: z.string().min(1).max(500),
    hash: digest,
    bytes: z.number().int().nonnegative().max(20_000_000),
  })
  .strict();
export const metadataNativeManifestSchema = z
  .object({
    kind: z.literal("VaettirReviewedMetadataNative/v1"),
    owner: z.literal("Codex root Vaettir"),
    route: z.literal("LOCAL_DISPOSABLE"),
    database: z.string().regex(/^vaettir_day_test_[0-9]{13}$/),
    fixture: z.literal(metadataFixturePath),
    createdAt: z.string().datetime(),
    snapshotHash: digest,
    executionTokenHash: digest,
    sources: z.array(sourceEntry).min(1).max(10_000),
    coherence: z
      .object({
        schemaHash: digest,
        generatedSchemaHash: digest,
        clientBuildHash: digest,
        workspaceBuildHash: digest,
        migrationsHash: digest,
        driverHash: digest,
        generatedAndBuilt: z.literal(true),
        migratedAndSeeded: z.literal(true),
      })
      .strict(),
    retained: z.literal(true),
    cloud: z.literal(false),
    customerData: z.literal(false),
  })
  .strict();
export type MetadataNativeManifest = z.infer<
  typeof metadataNativeManifestSchema
>;
export const metadataSha = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const metadataMigrationsFingerprint = (
  entries: MetadataNativeManifest["sources"],
) =>
  metadataSha(
    JSON.stringify(
      [...entries]
        .filter((entry) =>
          entry.path.startsWith("packages/db/prisma/migrations/"),
        )
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    ),
  );
export function metadataSourceFingerprint(
  entries: ReadonlyArray<z.infer<typeof sourceEntry>>,
) {
  const sorted = [...entries].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  let bytes = 0;
  for (const entry of sorted) {
    sourceEntry.parse(entry);
    if (
      !/^(?:apps\/api\/|packages\/(?:db|core|ai-agent)\/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|tsconfig\.base\.json$)/.test(
        entry.path,
      ) ||
      entry.path.includes("..") ||
      entry.path.includes("\\") ||
      /(?:^|\/)\.env/.test(entry.path) ||
      /(?:^|\/)(?:node_modules|dist|\.local)(?:\/|$)/.test(entry.path)
    )
      throw Error("Unsupported source inventory path");
    bytes += entry.bytes;
  }
  if (
    sorted.length > 10_000 ||
    bytes > 200_000_000 ||
    new Set(sorted.map((entry) => entry.path)).size !== sorted.length ||
    !sorted.some((entry) => entry.path === metadataFixturePath)
  )
    throw Error("Complete bounded fixture source inventory required");
  return metadataSha(JSON.stringify(sorted));
}
/** Pure guard. No DB imports, connection, credential return or disposal authority. */
export function admitReviewedMetadataFixture(
  env: Record<string, string | undefined>,
  rawManifest: unknown,
  actualSources: MetadataNativeManifest["sources"],
  now = Date.now(),
) {
  if (
    env.VAETTIR_CASE_METADATA_NATIVE_FIXTURE !== "yes" ||
    !env.VAETTIR_CASE_METADATA_NATIVE_TOKEN
  )
    throw Error("Explicit reviewed metadata fixture admission required");
  const admitted = assertOwnedTestDatabase(env.DATABASE_URL, env);
  const manifest = metadataNativeManifestSchema.parse(rawManifest);
  const age = now - Date.parse(manifest.createdAt);
  if (
    admitted.route !== "LOCAL_DISPOSABLE" ||
    admitted.database !== manifest.database ||
    age < 0 ||
    age > 3_600_000 ||
    metadataSha(env.VAETTIR_CASE_METADATA_NATIVE_TOKEN) !==
      manifest.executionTokenHash ||
    manifest.coherence.schemaHash !== manifest.coherence.generatedSchemaHash ||
    metadataSourceFingerprint(actualSources) !== manifest.snapshotHash ||
    metadataSourceFingerprint(manifest.sources) !== manifest.snapshotHash ||
    metadataMigrationsFingerprint(manifest.sources) !==
      manifest.coherence.migrationsHash
  )
    throw Error("Fresh exact owned source/database admission required");
  return {
    database: admitted.database,
    snapshotHash: manifest.snapshotHash,
    retained: true as const,
  };
}
