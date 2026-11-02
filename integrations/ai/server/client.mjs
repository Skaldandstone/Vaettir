import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const counts = z
  .object({ testCases: count, testPlans: count, testRuns: count })
  .strict();
export const summarySchema = z
  .object({
    policyVersion: z.literal(1),
    disclosure: z.literal("aggregate_counts"),
    classification: z.literal("SYNTHETIC"),
    suppressed: z.boolean(),
    counts: counts.nullable(),
  })
  .strict()
  .refine((v) => v.suppressed === (v.counts === null))
  .refine(
    (v) =>
      v.counts === null ||
      Object.values(v.counts).every((n) => n === 0 || n >= 10),
  );

export const projectIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);

const field = z.enum(["title", "given", "when", "then"]);
const caseText = z.string().max(8000);
export const approvedCasesSchema = z.object({
  policyVersion: z.literal(1),
  disclosure: z.literal("approved_case_snapshot"),
  snapshot: z.object({
    version: z.literal(1), organizationId: projectIdSchema, projectId: projectIdSchema,
    classificationVersion: z.number().int().positive(), fields: z.array(field).min(1).max(4),
    cases: z.array(z.object({ id: projectIdSchema, title: caseText.optional(), given: z.array(caseText).max(100).optional(), when: z.array(caseText).max(100).optional(), then: z.array(caseText).max(100).optional() }).strict()).min(1).max(20),
  }).strict(),
}).strict().refine(v => {
  const s = v.snapshot;
  return Buffer.byteLength(JSON.stringify(s), "utf8") <= 128 * 1024 &&
    new Set(s.fields).size === s.fields.length && new Set(s.cases.map(c => c.id)).size === s.cases.length &&
    s.cases.every(c => field.options.every(f => s.fields.includes(f) === (c[f] !== undefined)));
});

export async function readApprovedCases(config, projectId, fetchImpl = fetch) {
  if (!config) throw new Error("Vaettir AI read unavailable or not permitted.");
  projectIdSchema.parse(projectId);
  const url = new URL("/api/integrations/ai/v1/approved-cases", config.origin);
  url.searchParams.set("projectId", projectId);
  try {
    const response = await fetchImpl(url, { method: "GET", headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !/^application\/json\b/i.test(response.headers.get("content-type") ?? "")) throw new Error();
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 140 * 1024) throw new Error(); chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const result = approvedCasesSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (result.snapshot.projectId !== projectId) throw new Error();
    return result;
  } catch { throw new Error("Vaettir AI read unavailable or not permitted."); }
}

export function readConfig(env = process.env) {
  // Configuration is operator-provided, never a tool argument. No API key or
  // session-token reuse and no credential file reads, browser storage, or .env.
  if (
    !env.VAETTIR_AI_BASE_URL ||
    !/^vai_[a-f0-9]{64}$/.test(env.VAETTIR_AI_TOKEN ?? "")
  )
    return null;
  try {
    const base = new URL(env.VAETTIR_AI_BASE_URL);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/"
    )
      return null;
    return { origin: base.origin, token: env.VAETTIR_AI_TOKEN };
  } catch {
    return null;
  }
}

export async function readSummary(config, projectId, fetchImpl = fetch) {
  if (!config) throw new Error("Vaettir AI connection is not configured.");
  projectIdSchema.parse(projectId);
  const url = new URL("/api/integrations/ai/v1/project-summary", config.origin);
  url.searchParams.set("projectId", projectId);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/json",
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 403 || response.status === 401)
      throw new Error("AI disclosure is not permitted.");
    if (
      !response.ok ||
      !/^application\/json\b/i.test(response.headers.get("content-type") ?? "")
    )
      throw new Error("Vaettir AI gateway is unavailable.");
    // Never release a response body until bounded and strictly validated. Do
    // not surface server error bodies, response URLs, or validation issues.
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Vaettir AI gateway is unavailable.");
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) throw new Error("Vaettir AI gateway is unavailable.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const result = summarySchema.safeParse(JSON.parse(raw));
    if (!result.success) throw new Error("Vaettir AI gateway is unavailable.");
    return result.data;
  } catch {
    // A transport exception can contain URLs, tokens, or unexpected content.
    // Denials and outages intentionally have the same generic model message.
    throw new Error("Vaettir AI read unavailable or not permitted.");
  }
}
